package api

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/rom/rivets_n_ruin/internal/ws"
)

// Two-player co-op.
//
// One scrolling view, a ship each, two browsers. The shape that makes
// that tractable is host-authoritative: one side runs the whole
// simulation and says what happened, the other sends its input and
// draws what it is told. The alternative — both simulating and
// agreeing — is lockstep, and lockstep desynchronises the first time
// two machines disagree about a float, which in a game with this much
// physics is immediately.
//
// So the server is a relay and a registry, not a simulation. It knows
// who is paired with whom and passes bytes between them; it has no
// opinion about what is in those bytes. That keeps the game's rules in
// one place — the game — and keeps this file small enough to be
// obviously correct.
//
// What it does have an opinion about:
//
//   - Who may join. A room is found by a short code, and the code is
//     the only secret. So it is generated from crypto/rand, it expires,
//     and a room holds exactly two people — the third is refused rather
//     than queued.
//   - How long anything lives. Every room has a deadline and a sweeper,
//     because a browser tab that closes without saying goodbye is the
//     normal case, not the exception.
//   - Size and rate. A relayed message is capped and a flood is
//     dropped: the peer is a browser on the internet, not a friend.

const (
	// How long a room waits for its second player before it is swept.
	// Long enough to send somebody a code, short enough that abandoned
	// rooms do not pile up.
	coopOpenTTL = 10 * time.Minute
	// How long a room survives with nobody connected to it at all.
	coopIdleTTL = 30 * time.Second
	// How often the sweeper runs.
	coopSweepEvery = 15 * time.Second
	// The most rooms that may exist at once. A room is cheap, but
	// "cheap" times "unbounded" is the same bug every time.
	coopMaxRooms = 500
	// The largest relayed message. A snapshot of two ships, the foes
	// and the shots is well under a kilobyte; this is room to grow and
	// still far below what one client could use to hurt another.
	coopMaxMessage = 16 << 10
	// Messages a second, per player, before they start being dropped.
	// The game sends inputs at 60 and snapshots at 20.
	coopRatePerSec = 120
	coopRateBurst  = 240
)

// Codes avoid vowels — so a code is never accidentally a word — and
// the characters that look like each other: no O or 0, no I or 1, and
// no L, which is a 1 in enough fonts to matter. These get read down a
// phone.
const coopAlphabet = "BCDFGHJKMNPQRSTVWXYZ23456789"

const coopCodeLen = 5

var errRoomFull = errors.New("that game already has two pilots")

type coopSide int

const (
	sideHost coopSide = iota
	sideGuest
)

// What a room needs from a connection.
//
// An interface rather than *ws.Conn so the pairing rules — who may
// join, who is told what when somebody leaves — can be tested without
// standing up a socket. Those rules are where the bugs were: the first
// version worked out who to notify after it had already cleared the
// slot, which made the host's departure silent.
type coopConn interface {
	WriteText(string) error
	WriteBinary([]byte) error
	Close()
}

type coopPeer struct {
	conn coopConn
	side coopSide
	// Tokens for the per-peer rate limit, refilled on a clock rather
	// than a timer: a goroutine per player to refill a counter is a
	// goroutine per player too many.
	tokens float64
	last   time.Time
}

// coopRoom is one game: a host, a guest, and the seed they share.
type coopRoom struct {
	Code    string    `json:"code"`
	Seed    int64     `json:"seed"`
	Hull    int       `json:"hull"`
	Created time.Time `json:"created"`

	mu       sync.Mutex
	host     *coopPeer
	guest    *coopPeer
	closed   bool
	expires  time.Time
	hostName string
}

type coopRegistry struct {
	mu    sync.Mutex
	rooms map[string]*coopRoom
	now   func() time.Time
}

func newCoopRegistry(now func() time.Time) *coopRegistry {
	return &coopRegistry{rooms: map[string]*coopRoom{}, now: now}
}

// coopCode makes a room code. crypto/rand, not math/rand: the code is
// the only thing standing between a stranger and somebody else's game,
// and a predictable one is no code at all.
func coopCode() (string, error) {
	b := make([]byte, coopCodeLen)
	max := big.NewInt(int64(len(coopAlphabet)))
	for i := range b {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b[i] = coopAlphabet[n.Int64()]
	}
	return string(b), nil
}

func (reg *coopRegistry) open(seed int64, hull int, hostName string) (*coopRoom, error) {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	reg.sweepLocked()
	if len(reg.rooms) >= coopMaxRooms {
		return nil, errors.New("too many games open; try again in a minute")
	}
	// Retry on a collision rather than trusting five characters to be
	// unique. At 29^5 the odds are small and the cost of being wrong
	// is two strangers in one game.
	for i := 0; i < 8; i++ {
		code, err := coopCode()
		if err != nil {
			return nil, err
		}
		if _, taken := reg.rooms[code]; taken {
			continue
		}
		room := &coopRoom{
			Code: code, Seed: seed, Hull: hull,
			Created: reg.now(), expires: reg.now().Add(coopOpenTTL),
			hostName: hostName,
		}
		reg.rooms[code] = room
		return room, nil
	}
	return nil, errors.New("could not allocate a code")
}

func (reg *coopRegistry) find(code string) *coopRoom {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	return reg.rooms[code]
}

func (reg *coopRegistry) drop(code string) {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	if r, ok := reg.rooms[code]; ok {
		r.shut()
		delete(reg.rooms, code)
	}
}

// sweepLocked removes rooms nobody is coming back to. Caller holds the
// registry lock.
func (reg *coopRegistry) sweepLocked() int {
	now := reg.now()
	n := 0
	for code, r := range reg.rooms {
		r.mu.Lock()
		empty := r.host == nil && r.guest == nil
		dead := r.closed || now.After(r.expires) ||
			(empty && now.After(r.Created.Add(coopIdleTTL)))
		r.mu.Unlock()
		if dead {
			r.shut()
			delete(reg.rooms, code)
			n++
		}
	}
	return n
}

func (reg *coopRegistry) sweep() int {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	return reg.sweepLocked()
}

func (reg *coopRegistry) count() int {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	return len(reg.rooms)
}

// join attaches a connection to a side of the room.
func (r *coopRoom) join(c coopConn, want coopSide, now time.Time) (*coopPeer, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil, errors.New("that game has ended")
	}
	slot := &r.host
	if want == sideGuest {
		slot = &r.guest
	}
	if *slot != nil {
		return nil, errRoomFull
	}
	p := &coopPeer{conn: c, side: want, tokens: coopRateBurst, last: now}
	*slot = p
	// Once somebody is in, the room lives as long as they do rather
	// than until the open-room deadline.
	r.expires = now.Add(coopOpenTTL)
	return p, nil
}

func (r *coopRoom) leave(p *coopPeer) {
	r.mu.Lock()
	// Who to tell, worked out BEFORE the slot is cleared.
	//
	// other() finds the far side by comparing against r.host, so
	// clearing r.host first makes it return nil and the guest is never
	// told the host has gone. It worked for the guest leaving purely
	// by luck — that path compares against a slot it did not clear —
	// which is the kind of half-working that passes one test and
	// fails the other.
	other := r.other(p)
	if r.host == p {
		r.host = nil
	}
	if r.guest == p {
		r.guest = nil
	}
	// The host leaving ends the game: it was running the simulation,
	// and without it the guest is drawing a world nobody is advancing.
	// Saying so beats leaving them flying a frozen hull.
	if p.side == sideHost {
		r.closed = true
	}
	r.mu.Unlock()
	if other != nil {
		_ = other.conn.WriteText(`{"t":"peer-left"}`)
		if p.side == sideHost {
			other.conn.Close()
		}
	}
}

// other is the peer on the far side, or nil. Caller holds r.mu.
func (r *coopRoom) other(p *coopPeer) *coopPeer {
	if p == r.host {
		return r.guest
	}
	return r.host
}

func (r *coopRoom) shut() {
	r.mu.Lock()
	r.closed = true
	h, g := r.host, r.guest
	r.host, r.guest = nil, nil
	r.mu.Unlock()
	for _, p := range []*coopPeer{h, g} {
		if p != nil {
			p.conn.Close()
		}
	}
}

// allow is the per-peer rate limit: a token bucket on the room's
// clock. Caller holds r.mu.
func (p *coopPeer) allow(now time.Time) bool {
	p.tokens += now.Sub(p.last).Seconds() * coopRatePerSec
	if p.tokens > coopRateBurst {
		p.tokens = coopRateBurst
	}
	p.last = now
	if p.tokens < 1 {
		return false
	}
	p.tokens--
	return true
}

// relay passes one message to the far side. Returns false if the
// sender is over its rate.
func (r *coopRoom) relay(from *coopPeer, op byte, data []byte, now time.Time) bool {
	r.mu.Lock()
	ok := from.allow(now)
	other := r.other(from)
	r.mu.Unlock()
	if !ok {
		return false
	}
	if other == nil {
		return true
	}
	var err error
	if op == 1 {
		err = other.conn.WriteText(string(data))
	} else {
		err = other.conn.WriteBinary(data)
	}
	if err != nil {
		other.conn.Close()
	}
	return true
}

// --- HTTP

type coopOpenReq struct {
	Seed int64 `json:"seed"`
	Hull int   `json:"hull"`
}

type coopOpenResp struct {
	Code string `json:"code"`
	Seed int64  `json:"seed"`
	Hull int    `json:"hull"`
}

// coopOpen creates a room and hands back its code.
//
// Authenticated, because a room costs memory and an anonymous caller
// could make five hundred of them. The pilot's name goes with it so
// the other side has something to show.
func (s *Server) coopOpen(w http.ResponseWriter, r *http.Request) {
	p := s.bearer(r)
	if p == nil {
		writeErr(w, http.StatusUnauthorized, "sign in to start a co-op game")
		return
	}
	var req coopOpenReq
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body: "+err.Error())
		return
	}
	if req.Hull < 0 || req.Hull > 200 {
		writeErr(w, http.StatusBadRequest, "no such hull")
		return
	}
	room, err := s.coop.open(req.Seed, req.Hull, p.Name)
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	s.log.Info("co-op room opened", "code", room.Code, "host", p.Name, "hull", room.Hull)
	writeJSON(w, http.StatusOK, coopOpenResp{Code: room.Code, Seed: room.Seed, Hull: room.Hull})
}

// coopPeek tells a would-be guest what they are joining before they
// commit a socket to it: the hull, the seed, and who is hosting.
func (s *Server) coopPeek(w http.ResponseWriter, r *http.Request) {
	room := s.coop.find(normaliseCode(r.PathValue("code")))
	if room == nil {
		writeErr(w, http.StatusNotFound, "no game with that code")
		return
	}
	room.mu.Lock()
	full := room.guest != nil
	closed := room.closed
	host := room.hostName
	room.mu.Unlock()
	if closed {
		writeErr(w, http.StatusNotFound, "that game has ended")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"code": room.Code, "seed": room.Seed, "hull": room.Hull,
		"host": host, "full": full,
	})
}

// normaliseCode makes a typed code match a generated one. People type
// lower case and they type spaces.
func normaliseCode(s string) string {
	out := make([]byte, 0, coopCodeLen)
	for i := 0; i < len(s) && len(out) < 16; i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' {
			c -= 32
		}
		if (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			out = append(out, c)
		}
	}
	return string(out)
}

// coopSocket is the relay itself.
//
// /api/coop/{code}/host and /api/coop/{code}/guest, upgraded to a
// WebSocket. Everything after the handshake is bytes between two
// browsers; this end only counts them.
func (s *Server) coopSocket(side coopSide) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		code := normaliseCode(r.PathValue("code"))
		room := s.coop.find(code)
		if room == nil {
			writeErr(w, http.StatusNotFound, "no game with that code")
			return
		}
		conn, err := ws.Accept(w, r)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		peer, err := room.join(conn, side, s.now())
		if err != nil {
			// Said over the socket rather than as a status, because by
			// now the handshake has already succeeded.
			msg, _ := json.Marshal(map[string]string{"t": "refused", "why": err.Error()})
			_ = conn.WriteText(string(msg))
			conn.Close()
			return
		}
		defer func() {
			room.leave(peer)
			conn.Close()
			if side == sideHost {
				s.coop.drop(code)
			}
		}()

		// Tell both sides who is here. The guest needs the seed and
		// hull to build the same world; the host needs to know to
		// start sending.
		room.mu.Lock()
		other := room.other(peer)
		room.mu.Unlock()
		hello, _ := json.Marshal(map[string]any{
			"t": "joined", "side": sideName(side),
			"seed": room.Seed, "hull": room.Hull, "peer": other != nil,
		})
		_ = conn.WriteText(string(hello))
		if other != nil {
			_ = other.conn.WriteText(`{"t":"peer-joined"}`)
		}

		for {
			op, data, err := conn.Read()
			if err != nil {
				return
			}
			if len(data) > coopMaxMessage {
				return
			}
			if !room.relay(peer, op, data, s.now()) {
				// Over its rate. Dropped rather than disconnected: a
				// burst is far more likely to be a slow frame catching
				// up than an attack, and dropping one snapshot costs
				// nothing while dropping the player costs the game.
				continue
			}
		}
	}
}

func sideName(s coopSide) string {
	if s == sideGuest {
		return "guest"
	}
	return "host"
}

// sweepCoop drops rooms nobody is coming back to. A browser tab that
// closes without saying goodbye is the normal case, not the
// exception, so this is the thing that actually frees them.
func (s *Server) sweepCoop() {
	for range time.Tick(coopSweepEvery) {
		if n := s.coop.sweep(); n > 0 {
			s.log.Info("swept co-op rooms", "rooms", n)
		}
	}
}
