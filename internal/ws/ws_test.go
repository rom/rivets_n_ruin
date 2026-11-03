package ws

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// A client, written here rather than imported, because importing one
// would be importing somebody else's idea of what the protocol is —
// and then the test and the server could be wrong together.

// dial does the handshake against a running test server.
func dial(t *testing.T, srv *httptest.Server, hdr map[string]string) (net.Conn, *http.Response) {
	t.Helper()
	u := strings.TrimPrefix(srv.URL, "http://")
	c, err := net.Dial("tcp", u)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { c.Close() })

	req := "GET / HTTP/1.1\r\nHost: x\r\n"
	h := map[string]string{
		"Upgrade":               "websocket",
		"Connection":            "Upgrade",
		"Sec-WebSocket-Key":     "dGhlIHNhbXBsZSBub25jZQ==",
		"Sec-WebSocket-Version": "13",
	}
	for k, v := range hdr {
		if v == "" {
			delete(h, k)
			continue
		}
		h[k] = v
	}
	for k, v := range h {
		req += k + ": " + v + "\r\n"
	}
	req += "\r\n"
	if _, err := c.Write([]byte(req)); err != nil {
		t.Fatalf("write request: %v", err)
	}
	_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))
	resp, err := http.ReadResponse(bufio.NewReader(c), nil)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	return c, resp
}

// frame builds a client frame: masked, as the RFC requires of a client.
func frame(opcode byte, payload []byte, fin bool) []byte {
	var head []byte
	n := len(payload)
	first := opcode
	if fin {
		first |= 0x80
	}
	switch {
	case n < 126:
		head = []byte{first, 0x80 | byte(n)}
	case n < 1<<16:
		head = []byte{first, 0x80 | 126, 0, 0}
		binary.BigEndian.PutUint16(head[2:], uint16(n))
	default:
		head = make([]byte, 10)
		head[0], head[1] = first, 0x80|127
		binary.BigEndian.PutUint64(head[2:], uint64(n))
	}
	var mask [4]byte
	_, _ = rand.Read(mask[:])
	out := append(head, mask[:]...)
	masked := make([]byte, n)
	copy(masked, payload)
	for i := range masked {
		masked[i] ^= mask[i&3]
	}
	return append(out, masked...)
}

// readFrameRaw reads one server frame off the wire. Server frames are
// never masked.
func readFrameRaw(t *testing.T, c net.Conn) (opcode byte, payload []byte) {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))
	var head [2]byte
	if _, err := io.ReadFull(c, head[:]); err != nil {
		t.Fatalf("read head: %v", err)
	}
	opcode = head[0] & 0x0F
	if head[1]&0x80 != 0 {
		t.Fatal("the server masked a frame; only clients do that")
	}
	n := int64(head[1] & 0x7F)
	switch n {
	case 126:
		var ext [2]byte
		if _, err := io.ReadFull(c, ext[:]); err != nil {
			t.Fatalf("read ext16: %v", err)
		}
		n = int64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err := io.ReadFull(c, ext[:]); err != nil {
			t.Fatalf("read ext64: %v", err)
		}
		n = int64(binary.BigEndian.Uint64(ext[:]))
	}
	payload = make([]byte, n)
	if _, err := io.ReadFull(c, payload); err != nil {
		t.Fatalf("read payload: %v", err)
	}
	return opcode, payload
}

// echo is a server that reads messages and sends them straight back,
// and reports what went wrong on a channel.
func echoServer(t *testing.T) (*httptest.Server, chan error) {
	t.Helper()
	errs := make(chan error, 8)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := Accept(w, r)
		if err != nil {
			errs <- err
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		defer conn.Close()
		for {
			op, data, err := conn.Read()
			if err != nil {
				errs <- err
				return
			}
			if op == opText {
				err = conn.WriteText(string(data))
			} else {
				err = conn.WriteBinary(data)
			}
			if err != nil {
				errs <- err
				return
			}
		}
	}))
	t.Cleanup(srv.Close)
	return srv, errs
}

func TestHandshake(t *testing.T) {
	srv, _ := echoServer(t)
	_, resp := dial(t, srv, nil)
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("handshake answered %d, want 101", resp.StatusCode)
	}
	// The accept value from RFC 6455 section 1.3, for the key above.
	// Hardcoded on purpose: computing it the same way the server does
	// would pass whatever the server did.
	if got := resp.Header.Get("Sec-WebSocket-Accept"); got != "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=" {
		t.Fatalf("Sec-WebSocket-Accept = %q, want the value from the RFC", got)
	}
	if !strings.EqualFold(resp.Header.Get("Upgrade"), "websocket") {
		t.Errorf("Upgrade header = %q", resp.Header.Get("Upgrade"))
	}
}

func TestHandshakeRefusals(t *testing.T) {
	srv, _ := echoServer(t)
	for _, c := range []struct {
		name string
		hdr  map[string]string
	}{
		{"no upgrade header", map[string]string{"Upgrade": ""}},
		{"wrong upgrade", map[string]string{"Upgrade": "h2c"}},
		{"no connection header", map[string]string{"Connection": ""}},
		{"wrong version", map[string]string{"Sec-WebSocket-Version": "8"}},
		{"no key", map[string]string{"Sec-WebSocket-Key": ""}},
	} {
		_, resp := dial(t, srv, c.hdr)
		if resp.StatusCode == http.StatusSwitchingProtocols {
			t.Errorf("%s: the handshake succeeded anyway", c.name)
		}
	}
}

// Firefox sends "keep-alive, Upgrade". A server that compares the
// whole header to "Upgrade" refuses it.
func TestConnectionHeaderIsAList(t *testing.T) {
	srv, _ := echoServer(t)
	for _, v := range []string{"Upgrade", "upgrade", "keep-alive, Upgrade", "Upgrade, keep-alive"} {
		_, resp := dial(t, srv, map[string]string{"Connection": v})
		if resp.StatusCode != http.StatusSwitchingProtocols {
			t.Errorf("Connection: %q was refused with %d", v, resp.StatusCode)
		}
	}
}

func TestRoundTripAtEveryLengthClass(t *testing.T) {
	srv, _ := echoServer(t)
	c, _ := dial(t, srv, nil)

	// The three length encodings, and the boundaries between them.
	// 65536 is MaxMessage exactly and must still go through; one byte
	// more is the next test.
	for _, n := range []int{0, 1, 125, 126, 127, 1000, 65535, MaxMessage} {
		payload := make([]byte, n)
		for i := range payload {
			payload[i] = byte(i * 7)
		}
		if _, err := c.Write(frame(opBinary, payload, true)); err != nil {
			t.Fatalf("write %d bytes: %v", n, err)
		}
		op, got := readFrameRaw(t, c)
		if op != opBinary {
			t.Fatalf("%d bytes came back as opcode %#x", n, op)
		}
		if !bytes.Equal(got, payload) {
			t.Fatalf("%d bytes did not survive the round trip", n)
		}
	}
}

// One byte past the cap, with the payload actually sent — the other
// over-size test only claims a length. The limit is inclusive: exactly
// MaxMessage goes through, MaxMessage+1 does not.
func TestOneBytePastTheCapIsRefused(t *testing.T) {
	srv, errs := echoServer(t)
	c, _ := dial(t, srv, nil)
	if _, err := c.Write(frame(opBinary, make([]byte, MaxMessage+1), true)); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-errs:
		if err != ErrTooBig {
			t.Fatalf("server reported %v, want ErrTooBig", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("a %d-byte frame was accepted; the cap is %d", MaxMessage+1, MaxMessage)
	}
}

func TestMaskingIsUndone(t *testing.T) {
	// The whole point of the mask: the bytes on the wire are not the
	// payload, and a server that forgets to unmask returns noise that
	// is the right length.
	srv, _ := echoServer(t)
	c, _ := dial(t, srv, nil)
	want := []byte("the quick brown fox")
	wire := frame(opText, want, true)
	if bytes.Contains(wire, want) {
		t.Fatal("the fixture did not actually mask the payload")
	}
	if _, err := c.Write(wire); err != nil {
		t.Fatal(err)
	}
	op, got := readFrameRaw(t, c)
	if op != opText || string(got) != string(want) {
		t.Fatalf("got opcode %#x %q", op, got)
	}
}

func TestUnmaskedClientFrameIsRefused(t *testing.T) {
	// The RFC requires it, and the reason is practical: an unmasked
	// frame can be smuggled through a caching proxy.
	srv, errs := echoServer(t)
	c, _ := dial(t, srv, nil)
	// Hand-built, unmasked.
	if _, err := c.Write([]byte{0x80 | opBinary, 2, 0xAA, 0xBB}); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-errs:
		if err == nil || !strings.Contains(err.Error(), "not masked") {
			t.Fatalf("server reported %v, want a masking complaint", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the server accepted an unmasked frame")
	}
}

func TestOversizeFrameIsRefusedBeforeItIsAllocated(t *testing.T) {
	srv, errs := echoServer(t)
	c, _ := dial(t, srv, nil)
	// A 64-bit length claiming four gigabytes, with no payload behind
	// it. A server that allocates on the claim dies here; one that
	// checks first just closes.
	head := make([]byte, 10)
	head[0], head[1] = 0x80|opBinary, 0x80|127
	binary.BigEndian.PutUint64(head[2:], 1<<32)
	head = append(head, 0, 0, 0, 0) // mask key
	if _, err := c.Write(head); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-errs:
		if err != ErrTooBig {
			t.Fatalf("server reported %v, want ErrTooBig", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the server did not refuse a 4GB frame")
	}
}

func TestPingIsAnswered(t *testing.T) {
	srv, _ := echoServer(t)
	c, _ := dial(t, srv, nil)
	if _, err := c.Write(frame(opPing, []byte("are you there"), true)); err != nil {
		t.Fatal(err)
	}
	op, got := readFrameRaw(t, c)
	if op != opPong {
		t.Fatalf("a ping got opcode %#x back, want a pong", op)
	}
	// A pong carries the ping's payload back, which is how a peer
	// matches them up.
	if string(got) != "are you there" {
		t.Fatalf("the pong carried %q", got)
	}
}

func TestControlFramesAreNotHandedToTheCaller(t *testing.T) {
	// The echo server would bounce anything it was given. A pong
	// coming back as a data message would show up as an echo.
	srv, _ := echoServer(t)
	c, _ := dial(t, srv, nil)
	if _, err := c.Write(frame(opPong, []byte("unsolicited"), true)); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Write(frame(opBinary, []byte("real"), true)); err != nil {
		t.Fatal(err)
	}
	op, got := readFrameRaw(t, c)
	if op != opBinary || string(got) != "real" {
		t.Fatalf("got opcode %#x %q; a control frame reached the caller", op, got)
	}
}

func TestOversizeControlFrameIsRefused(t *testing.T) {
	// A control frame carries at most 125 bytes. Without the check a
	// peer can make the server hold a large buffer with a ping.
	srv, errs := echoServer(t)
	c, _ := dial(t, srv, nil)
	if _, err := c.Write(frame(opPing, make([]byte, 200), true)); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-errs:
		if err == nil || !strings.Contains(err.Error(), "control frame") {
			t.Fatalf("server reported %v, want a control-frame complaint", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the server accepted a 200-byte ping")
	}
}

func TestFragmentedMessageIsReassembled(t *testing.T) {
	srv, _ := echoServer(t)
	c, _ := dial(t, srv, nil)
	if _, err := c.Write(frame(opText, []byte("one "), false)); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Write(frame(opContinuation, []byte("two "), false)); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Write(frame(opContinuation, []byte("three"), true)); err != nil {
		t.Fatal(err)
	}
	op, got := readFrameRaw(t, c)
	if op != opText || string(got) != "one two three" {
		t.Fatalf("reassembled to opcode %#x %q", op, got)
	}
}

func TestAPingInsideAFragmentedMessageIsAnswered(t *testing.T) {
	// Legal and real: a control frame may be interleaved between the
	// fragments of a message.
	srv, _ := echoServer(t)
	c, _ := dial(t, srv, nil)
	if _, err := c.Write(frame(opText, []byte("be"), false)); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Write(frame(opPing, nil, true)); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Write(frame(opContinuation, []byte("gin"), true)); err != nil {
		t.Fatal(err)
	}
	if op, _ := readFrameRaw(t, c); op != opPong {
		t.Fatalf("the interleaved ping got opcode %#x", op)
	}
	op, got := readFrameRaw(t, c)
	if op != opText || string(got) != "begin" {
		t.Fatalf("the message came back as opcode %#x %q", op, got)
	}
}

func TestFragmentsPastTheLimitAreRefused(t *testing.T) {
	// Each fragment can be under the cap while the message is not.
	//
	// Not the echo server: that one would also report ErrTooBig from
	// its own WriteBinary after Read handed it 120KB, so the test
	// passed with the read-side cap removed. This server reports what
	// Read did, which is the thing under test — the caller must never
	// be handed an oversize message in the first place.
	gotSize := make(chan int, 4)
	errs := make(chan error, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := Accept(w, r)
		if err != nil {
			return
		}
		defer conn.Close()
		_, data, err := conn.Read()
		if err != nil {
			errs <- err
			return
		}
		gotSize <- len(data)
	}))
	defer srv.Close()

	c, _ := dial(t, srv, nil)
	chunk := make([]byte, 60<<10)
	if _, err := c.Write(frame(opBinary, chunk, false)); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Write(frame(opContinuation, chunk, true)); err != nil {
		t.Fatal(err)
	}
	select {
	case n := <-gotSize:
		t.Fatalf("Read handed the caller a %d-byte message; the cap is %d", n, MaxMessage)
	case err := <-errs:
		if err != ErrTooBig {
			t.Fatalf("server reported %v, want ErrTooBig", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("two 60KB fragments neither arrived nor were refused")
	}
}

func TestReservedBitsAreRefused(t *testing.T) {
	// Set with no extension negotiated. The RFC says fail.
	srv, errs := echoServer(t)
	c, _ := dial(t, srv, nil)
	f := frame(opBinary, []byte("x"), true)
	f[0] |= 0x40 // RSV1
	if _, err := c.Write(f); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-errs:
		if err == nil || !strings.Contains(err.Error(), "reserved") {
			t.Fatalf("server reported %v, want a reserved-bits complaint", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("a frame with RSV1 set was accepted")
	}
}

func TestCloseEndsIt(t *testing.T) {
	srv, errs := echoServer(t)
	c, _ := dial(t, srv, nil)
	if _, err := c.Write(frame(opClose, nil, true)); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-errs:
		if err != ErrClosed {
			t.Fatalf("server reported %v, want ErrClosed", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("a close frame did not end the read loop")
	}
	// ...and the server sends one back before it goes.
	if op, _ := readFrameRaw(t, c); op != opClose {
		t.Errorf("the server's parting frame was opcode %#x", op)
	}
}

func TestWritePastTheLimitIsRefused(t *testing.T) {
	// The server's own guard, not the peer's.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := Accept(w, r)
		if err != nil {
			return
		}
		defer conn.Close()
		if err := conn.WriteBinary(make([]byte, MaxMessage+1)); err != ErrTooBig {
			t.Errorf("writing past the cap returned %v, want ErrTooBig", err)
		}
	}))
	defer srv.Close()
	dial(t, srv, nil)
	time.Sleep(200 * time.Millisecond)
}

func TestCloseIsIdempotent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := Accept(w, r)
		if err != nil {
			return
		}
		// Three times, from the handler and from another goroutine.
		conn.Close()
		conn.Close()
		done := make(chan struct{})
		go func() { conn.Close(); close(done) }()
		<-done
	}))
	defer srv.Close()
	dial(t, srv, nil)
	time.Sleep(200 * time.Millisecond)
}
