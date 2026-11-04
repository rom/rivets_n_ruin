// Package ws is a small WebSocket server, written to RFC 6455.
//
// Why this exists rather than a dependency: the whole backend is
// standard library, deliberately, and co-op is the first thing that
// needs a socket rather than a request. The alternatives were worse
// than two hundred lines — server-sent events plus a POST per input
// frame doubles the round trips and triples the handshakes, and long
// polling is the same thing with more ways to go wrong.
//
// What it does: the handshake, frames of every length, masking,
// close, ping and pong. What it deliberately does not do:
// extensions, compression, and fragmented messages longer than one
// frame on the write side. The game sends small binary snapshots many
// times a second; none of that is reachable from here.
//
// It is written for a hostile network. Every length is checked before
// it is allocated, every read has a deadline, and a client that sends
// a frame bigger than the limit is closed rather than believed.
package ws

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// The magic string from RFC 6455 section 1.3. It exists so that a
// cached HTTP response cannot be mistaken for a handshake.
const acceptGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// Opcodes. Only these five are legal here.
const (
	opContinuation = 0x0
	opText         = 0x1
	opBinary       = 0x2
	opClose        = 0x8
	opPing         = 0x9
	opPong         = 0xA
)

// MaxMessage is the largest frame payload accepted, in bytes. A co-op
// snapshot is under two kilobytes; this is generous and still small
// enough that a client cannot ask the server to allocate its way out
// of memory.
const MaxMessage = 64 << 10

var (
	// ErrClosed is returned once the peer has gone or we have closed.
	ErrClosed = errors.New("websocket closed")
	// ErrTooBig is a frame past MaxMessage. The connection does not
	// survive it: a peer that sends one is not speaking our protocol.
	ErrTooBig = errors.New("websocket frame too large")
)

// Conn is one connection. Safe for one reader and one writer at a
// time, which is how the game uses it: a read loop and whatever sends.
// Writes take a mutex because pings come from a different goroutine.
type Conn struct {
	raw   net.Conn
	br    *bufio.Reader
	wmu   sync.Mutex
	close sync.Once
	// Read and write deadlines applied per operation. Zero means none,
	// which is only right for a test.
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
}

// Accept performs the handshake and takes the connection over.
//
// After this returns the http.ResponseWriter must not be touched
// again: the connection belongs to the caller, and the HTTP server no
// longer knows about it.
func Accept(w http.ResponseWriter, r *http.Request) (*Conn, error) {
	if !IsUpgrade(r) {
		return nil, errors.New("not a websocket upgrade")
	}
	if r.Header.Get("Sec-WebSocket-Version") != "13" {
		// Tell them which version we speak, as the RFC asks.
		w.Header().Set("Sec-WebSocket-Version", "13")
		return nil, errors.New("unsupported websocket version")
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return nil, errors.New("no Sec-WebSocket-Key")
	}

	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("connection cannot be hijacked")
	}
	raw, brw, err := hj.Hijack()
	if err != nil {
		return nil, fmt.Errorf("hijack: %w", err)
	}

	// Anything the client pipelined after the handshake is still in
	// this reader, so it has to be the one we go on reading from.
	resp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n"
	if _, err := brw.WriteString(resp); err != nil {
		raw.Close()
		return nil, fmt.Errorf("write handshake: %w", err)
	}
	if err := brw.Flush(); err != nil {
		raw.Close()
		return nil, fmt.Errorf("flush handshake: %w", err)
	}
	return &Conn{
		raw: raw, br: brw.Reader,
		ReadTimeout: 70 * time.Second, WriteTimeout: 10 * time.Second,
	}, nil
}

// IsUpgrade reports whether this request is asking for a WebSocket.
// Both header values are lists and both are case-insensitive, which is
// the part everyone gets wrong: Firefox sends "keep-alive, Upgrade".
func IsUpgrade(r *http.Request) bool {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	for _, part := range strings.Split(r.Header.Get("Connection"), ",") {
		if strings.EqualFold(strings.TrimSpace(part), "upgrade") {
			return true
		}
	}
	return false
}

func acceptKey(key string) string {
	h := sha1.New() //nolint:gosec // required by RFC 6455; not a security hash
	_, _ = io.WriteString(h, key+acceptGUID)
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// --- reading

// Read returns the next data message: its opcode and payload.
//
// Control frames are handled here and not returned — a ping is
// answered with a pong, a close ends the connection. The caller sees
// only text and binary, which is all the game has an opinion about.
func (c *Conn) Read() (opcode byte, payload []byte, err error) {
	for {
		if c.ReadTimeout > 0 {
			_ = c.raw.SetReadDeadline(time.Now().Add(c.ReadTimeout))
		}
		fin, op, data, err := c.readFrame()
		if err != nil {
			return 0, nil, err
		}
		switch op {
		case opPing:
			if err := c.write(opPong, data); err != nil {
				return 0, nil, err
			}
			continue
		case opPong:
			continue
		case opClose:
			c.Close()
			return 0, nil, ErrClosed
		case opText, opBinary:
			if fin {
				return op, data, nil
			}
			// A fragmented message. Gather the continuations.
			full := data
			for {
				fin2, op2, more, err := c.readFrame()
				if err != nil {
					return 0, nil, err
				}
				if op2 == opPing {
					if err := c.write(opPong, more); err != nil {
						return 0, nil, err
					}
					continue
				}
				if op2 == opClose {
					c.Close()
					return 0, nil, ErrClosed
				}
				if op2 != opContinuation {
					c.Close()
					return 0, nil, errors.New("interleaved data frame")
				}
				if len(full)+len(more) > MaxMessage {
					c.Close()
					return 0, nil, ErrTooBig
				}
				full = append(full, more...)
				if fin2 {
					return op, full, nil
				}
			}
		default:
			c.Close()
			return 0, nil, fmt.Errorf("unknown opcode %#x", op)
		}
	}
}

func (c *Conn) readFrame() (fin bool, opcode byte, payload []byte, err error) {
	var head [2]byte
	if _, err := io.ReadFull(c.br, head[:]); err != nil {
		return false, 0, nil, err
	}
	fin = head[0]&0x80 != 0
	if head[0]&0x70 != 0 {
		// Reserved bits set with no extension negotiated.
		return false, 0, nil, errors.New("reserved bits set")
	}
	opcode = head[0] & 0x0F
	masked := head[1]&0x80 != 0
	n := int64(head[1] & 0x7F)

	switch n {
	case 126:
		var ext [2]byte
		if _, err := io.ReadFull(c.br, ext[:]); err != nil {
			return false, 0, nil, err
		}
		n = int64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err := io.ReadFull(c.br, ext[:]); err != nil {
			return false, 0, nil, err
		}
		v := binary.BigEndian.Uint64(ext[:])
		// The high bit must be zero, and anything over the limit is
		// refused before a single byte is allocated for it.
		if v > uint64(MaxMessage) {
			return false, 0, nil, ErrTooBig
		}
		n = int64(v)
	}
	// Redundant with the 64-bit check above at today's MaxMessage,
	// which is larger than a 16-bit length can express — so removing
	// either one on its own changes nothing, and removing both is
	// caught. Kept because that redundancy stops the moment anybody
	// lowers the cap, and a size check that silently became
	// unreachable is how a limit turns into a comment.
	if n > MaxMessage {
		return false, 0, nil, ErrTooBig
	}
	// A control frame carries at most 125 bytes and is never
	// fragmented. Both are the RFC's rules and both keep a peer from
	// using a ping to make us hold a large buffer.
	if opcode >= 0x8 {
		if n > 125 || !fin {
			return false, 0, nil, errors.New("bad control frame")
		}
	}

	var mask [4]byte
	if masked {
		if _, err := io.ReadFull(c.br, mask[:]); err != nil {
			return false, 0, nil, err
		}
	} else {
		// Every frame from a client must be masked. An unmasked one is
		// either a broken client or something injecting through a
		// proxy, and the RFC says to fail the connection.
		return false, 0, nil, errors.New("client frame was not masked")
	}

	payload = make([]byte, n)
	if _, err := io.ReadFull(c.br, payload); err != nil {
		return false, 0, nil, err
	}
	for i := range payload {
		payload[i] ^= mask[i&3]
	}
	return fin, opcode, payload, nil
}

// --- writing

// WriteBinary sends one binary message.
func (c *Conn) WriteBinary(b []byte) error { return c.write(opBinary, b) }

// WriteText sends one text message.
func (c *Conn) WriteText(s string) error { return c.write(opText, []byte(s)) }

// Ping sends a ping. The peer's pong is swallowed by Read.
func (c *Conn) Ping() error { return c.write(opPing, nil) }

func (c *Conn) write(opcode byte, payload []byte) error {
	if len(payload) > MaxMessage {
		return ErrTooBig
	}
	var head []byte
	n := len(payload)
	switch {
	case n < 126:
		head = []byte{0x80 | opcode, byte(n)}
	case n < 1<<16:
		head = []byte{0x80 | opcode, 126, 0, 0}
		binary.BigEndian.PutUint16(head[2:], uint16(n))
	default:
		head = make([]byte, 10)
		head[0], head[1] = 0x80|opcode, 127
		binary.BigEndian.PutUint64(head[2:], uint64(n))
	}

	c.wmu.Lock()
	defer c.wmu.Unlock()
	if c.WriteTimeout > 0 {
		_ = c.raw.SetWriteDeadline(time.Now().Add(c.WriteTimeout))
	}
	// One write where possible: two syscalls per snapshot at twenty a
	// second, times every player, is worth avoiding, and a short write
	// between head and payload would corrupt the stream.
	buf := make([]byte, 0, len(head)+n)
	buf = append(buf, head...)
	buf = append(buf, payload...)
	if _, err := c.raw.Write(buf); err != nil {
		return err
	}
	return nil
}

// Close sends a close frame if it can and shuts the socket. Safe to
// call more than once and from anywhere.
func (c *Conn) Close() {
	c.close.Do(func() {
		// Best effort: the peer may already be gone, which is the
		// common case and not worth reporting.
		c.wmu.Lock()
		_ = c.raw.SetWriteDeadline(time.Now().Add(time.Second))
		_, _ = c.raw.Write([]byte{0x80 | opClose, 0})
		c.wmu.Unlock()
		_ = c.raw.Close()
	})
}

// RemoteAddr is the peer, for logging and for the loopback check.
func (c *Conn) RemoteAddr() string { return c.raw.RemoteAddr().String() }
