package api

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"strconv"
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
	//
	// Applies only before the pair is complete. It used to apply
	// always, and was pushed forward on every join and never again —
	// so a room with two happy pilots in it was swept ten minutes
	// after the second one arrived, both sockets closed underneath
	// them, mid-run. Any co-op game that lasted longer than ten
	// minutes ended this way.
	coopOpenTTL = 10 * time.Minute
	// How long a slot is held for a pilot whose connection dropped
	// without them saying they were leaving.
	//
	// A dropped socket is not a decision. A tab suspended on a phone,
	// a train going into a tunnel, a laptop lid: the pilot wants to
	// come back, and ending the run for both of them is the wrong
	// answer to a bad network. So the room holds the empty slot and
	// the other pilot waits. Long enough for a reconnect to actually
	// happen, short enough that the pilot still there is not stuck
	// staring at a held run for minutes.
	coopResumeTTL = 45 * time.Second
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
	// Said they were going, rather than simply stopped answering.
	//
	// The difference is the whole of what the other pilot is told. A
	// socket closing looks identical either way from here, so the
	// client says so before it goes, and this is where that is
	// remembered until leave() can act on it.
	quit bool
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

	mu      sync.Mutex
	host    *coopPeer
	guest   *coopPeer
	closed  bool
	expires time.Time

	// Who is in it, as accounts rather than as sockets.
	//
	// Separate from the peers because the two have different
	// lifetimes and the board needs the slower one: a socket comes and
	// goes, but who flew the run has to still be answerable when the
	// run ends. The host's identity arrives with the room; the guest's
	// arrives at /join, which is why that route is authenticated.
	hostID    string
	hostName  string
	guestID   string
	guestName string

	// How long the two have actually been connected to each other.
	//
	// Recorded, not assumed. A co-op score credits two pilots, and a
	// guest who dropped out at the first hull did not fly the run the
	// board would say they did. paired accumulates closed intervals;
	// pairedSince is the open one, zero when the pair is not currently
	// complete. See pairedFor.
	paired      time.Duration
	pairedSince time.Time

	// Has the pair ever been complete?
	//
	// What a room is for changes once it has: before, it is a code
	// waiting to be used and the open deadline applies; after, it is a
	// game in progress and the only things that should end it are the
	// pilots leaving.
	started bool

	// When one side's socket dropped without saying goodbye, and which
	// side it was. Zero when both are here, and zeroed again when they
	// come back. The slot is held until coopResumeTTL past this.
	gone     time.Time
	goneSide coopSide

	// When the room last became completely empty. The idle deadline
	// runs from here rather than from Created, which is what it used
	// to run from — so a long game whose players both dropped was
	// reaped on the next sweep instead of after the idle window, and
	// neither of them could rejoin.
	emptySince time.Time

	// The registry's clock, carried so leave() can close an interval
	// without reaching for the wall clock. A room that times itself
	// off time.Now while every other path is on an injected clock is a
	// test that cannot be written.
	now func() time.Time
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

func (reg *coopRegistry) open(seed int64, hull int, hostID, hostName string) (*coopRoom, error) {
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
			hostID: hostID, hostName: hostName,
			now: reg.now,
			// Empty from birth: a room nobody ever connects to is idle
			// from the moment it is made, and the idle deadline is
			// what reaps it.
			emptySince: reg.now(),
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
		// Four ways a room dies, and they are not interchangeable.
		//
		// The open deadline applies only before the pair is complete.
		// It used to apply always: it was pushed forward on each join
		// and never again, so a room with two pilots happily flying it
		// was swept ten minutes after the second one joined and both
		// sockets were closed underneath them, mid-run. Every co-op
		// game longer than ten minutes ended that way.
		//
		// The idle deadline runs from when the room actually emptied,
		// not from when it was created — from Created it had always
		// passed by the time a real game ended, so a room both pilots
		// dropped out of was reaped on the next sweep and neither
		// could rejoin it.
		dead := r.closed ||
			(!r.started && now.After(r.expires)) ||
			(!r.emptySince.IsZero() && now.After(r.emptySince.Add(coopIdleTTL))) ||
			(!r.gone.IsZero() && now.After(r.gone.Add(coopResumeTTL)))
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
//
// The second return says whether this filled a slot the same side had
// dropped out of mid-game, rather than arriving for the first time.
// The two are very different things to the pilot already in the room:
// one is "your partner is here, launch when ready" and the other is
// "carry on, they are back".
func (r *coopRoom) join(c coopConn, want coopSide, now time.Time) (*coopPeer, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil, false, errors.New("that game has ended")
	}
	slot := &r.host
	if want == sideGuest {
		slot = &r.guest
	}
	if *slot != nil {
		return nil, false, errRoomFull
	}
	resumed := r.started && !r.gone.IsZero() && r.goneSide == want
	p := &coopPeer{conn: c, side: want, tokens: coopRateBurst, last: now}
	*slot = p
	if resumed {
		// They made it back inside the window; the slot stops being
		// held and the deadline stops running.
		r.gone = time.Time{}
		r.goneSide = sideHost
	}
	r.emptySince = time.Time{}
	// Once somebody is in, the room lives as long as they do rather
	// than until the open-room deadline.
	r.expires = now.Add(coopOpenTTL)
	// The pair is complete: start counting the time they fly together.
	if r.host != nil && r.guest != nil {
		r.started = true
		if r.pairedSince.IsZero() {
			r.pairedSince = now
		}
	}
	return p, resumed, nil
}

// markQuit records that this peer is leaving on purpose. Called when
// the client says so, before its socket goes.
func (r *coopRoom) markQuit(p *coopPeer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p.quit = true
}

// heldFor is how long the room has been holding a dropped pilot's
// slot, and whether it is holding one at all.
func (r *coopRoom) heldFor(now time.Time) (time.Duration, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.gone.IsZero() {
		return 0, false
	}
	return now.Sub(r.gone), true
}

// pairedFor is how long the two have been connected to each other,
// counting the interval that is still open. Caller must NOT hold r.mu.
func (r *coopRoom) pairedFor(now time.Time) time.Duration {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.pairedForLocked(now)
}

// clock is the room's time source, defaulting to the wall clock so a
// room built by hand in a test is still usable.
func (r *coopRoom) clock() time.Time {
	if r.now == nil {
		return time.Now()
	}
	return r.now()
}

func (r *coopRoom) pairedForLocked(now time.Time) time.Duration {
	d := r.paired
	if !r.pairedSince.IsZero() && now.After(r.pairedSince) {
		d += now.Sub(r.pairedSince)
	}
	return d
}

// setGuest records who is about to join as the guest.
//
// Called from the authenticated /join route, before the socket. It
// refuses a pilot trying to be their own partner: two browsers and one
// account is a thing people will try, and a board row naming the same
// pilot twice is not a pair.
func (r *coopRoom) setGuest(id, name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return errors.New("that game has ended")
	}
	if r.guest != nil {
		return errRoomFull
	}
	if id != "" && id == r.hostID {
		return errors.New("you are already hosting that game")
	}
	// A second pilot claiming the slot before the first one's socket
	// arrives takes it: the claim is not a reservation, and the socket
	// is what actually fills the room. Recording the later one keeps
	// the identity and the socket in step.
	r.guestID = id
	r.guestName = name
	return nil
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
	// The pair is no longer complete, so the open interval closes here
	// rather than running on while one of them flies alone.
	if !r.pairedSince.IsZero() {
		r.paired = r.pairedForLocked(r.clock())
		r.pairedSince = time.Time{}
	}
	now := r.clock()
	// Said they were going, or simply stopped answering? Everything
	// below turns on that, and it is the only thing this file has ever
	// been unable to tell apart.
	quit := p.quit
	// Read under the lock and used after it: the switch below runs
	// with r.mu released, because writing to a socket while holding a
	// room's lock is how one slow peer stalls the other.
	started := r.started
	// A deliberate departure by the host ends the game: it was running
	// the simulation, and without it the guest is drawing a world
	// nobody is advancing. Saying so beats leaving them flying a
	// frozen hull.
	//
	// A dropped host does NOT end it. That used to be the same branch,
	// which is why a host whose wifi blinked ended their partner's run
	// as surely as one who pressed Y.
	if quit && p.side == sideHost {
		r.closed = true
	}
	if !quit && r.started && other != nil {
		// Hold their slot and start the clock on it. The pilot still
		// here waits; see coopResumeTTL.
		r.gone = now
		r.goneSide = p.side
	}
	if r.host == nil && r.guest == nil && r.emptySince.IsZero() {
		r.emptySince = now
	}
	r.mu.Unlock()
	if other == nil {
		return
	}
	switch {
	case quit:
		// Named, because what the other pilot should do about it
		// differs: a guest whose host quit is going back to the title
		// whatever it does, and a host whose guest quit can carry on
		// flying the run they are in.
		_ = other.conn.WriteText(`{"t":"peer-quit","side":"` + sideName(p.side) + `"}`)
		if p.side == sideHost {
			other.conn.Close()
		}
	case started:
		_ = other.conn.WriteText(`{"t":"peer-gone","side":"` + sideName(p.side) +
			`","resumeSec":` + strconv.Itoa(int(coopResumeTTL/time.Second)) + `}`)
	default:
		// Never actually paired, so there is no run to hold: whoever
		// is left is still sitting on the code.
		_ = other.conn.WriteText(`{"t":"peer-left"}`)
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

// didQuit reports whether this peer said it was leaving.
func (r *coopRoom) didQuit(p *coopPeer) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return p.quit
}

// rateOK charges one message to this peer's bucket. Used for the
// messages that are handled here rather than relayed, so that a flood
// of those is limited exactly as a flood of snapshots is.
func (r *coopRoom) rateOK(from *coopPeer, now time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return from.allow(now)
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
	room, err := s.coop.open(req.Seed, req.Hull, p.ID, p.Name)
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

// coopJoin claims the guest slot for a signed-in pilot.
//
// Authenticated, and separate from the socket, for one reason: the
// co-op board credits two pilots, so the server has to know who the
// second one is, and a WebSocket cannot carry an Authorization header
// from a browser. Doing it as a POST before the socket keeps the
// credential out of the URL -- a token in a query string ends up in
// access logs -- without inventing a ticket to swap for it.
//
// The room code is still the only thing that lets you in. This route
// does not change that; it records who walked through.
//
// A pilot who is not signed in gets a 401 rather than a silent anonymous
// game, because co-op now records what it is for: hosting already
// required an account, and a run the board cannot name both pilots of
// is a run the board cannot take.
func (s *Server) coopJoin(w http.ResponseWriter, r *http.Request) {
	p := s.bearer(r)
	if p == nil {
		writeErr(w, http.StatusUnauthorized, "sign in to join a co-op game")
		return
	}
	room := s.coop.find(normaliseCode(r.PathValue("code")))
	if room == nil {
		writeErr(w, http.StatusNotFound, "no game with that code")
		return
	}
	if err := room.setGuest(p.ID, p.Name); err != nil {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	room.mu.Lock()
	host := room.hostName
	room.mu.Unlock()
	s.log.Info("co-op guest claimed a slot", "code", room.Code, "guest", p.Name, "host", host)
	writeJSON(w, http.StatusOK, map[string]any{
		"code": room.Code, "seed": room.Seed, "hull": room.Hull,
		"host": host, "full": false,
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
		peer, resumed, err := room.join(conn, side, s.now())
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
			// Only a host who said they were leaving takes the room
			// with them. This used to be unconditional, so a host
			// whose connection dropped for a second destroyed the room
			// and with it any chance of either pilot getting back into
			// the run. The sweeper reaps a room nobody returns to; see
			// coopResumeTTL.
			if side == sideHost && room.didQuit(peer) {
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
			// Back into a run already in progress, rather than at the
			// start of one. The client has to know: one means "launch
			// when ready" and the other means "you are already flying".
			"resumed": resumed,
			// How long a dropped pilot's slot is held. Sent now rather
			// than only in peer-gone, because the side that needs it
			// most is the one whose own socket dropped — and that side
			// is not here to be told anything when it happens. It
			// stops the client having its own copy of this number,
			// which is the kind of pair that drifts.
			"resumeSec": int(coopResumeTTL / time.Second),
		})
		_ = conn.WriteText(string(hello))
		if other != nil {
			if resumed {
				_ = other.conn.WriteText(`{"t":"peer-back","side":"` + sideName(side) + `"}`)
			} else {
				_ = other.conn.WriteText(`{"t":"peer-joined"}`)
			}
		}

		for {
			op, data, err := conn.Read()
			if err != nil {
				return
			}
			if len(data) > coopMaxMessage {
				return
			}
			// Text from a client is addressed to this end and is never
			// passed on.
			//
			// It used to be relayed like anything else, and no client
			// has ever sent any — which meant a peer could put
			// {"t":"refused"} or a {"t":"joined"} with a seed of its
			// choosing on the far side's socket, and the far side could
			// not tell it from the server. Only the server speaks to a
			// client in text now, and the only thing a client says back
			// is that it is leaving.
			if op == 1 {
				if !room.rateOK(peer, s.now()) {
					continue
				}
				if clientQuit(data) {
					room.markQuit(peer)
					return
				}
				continue
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

// clientQuit recognises the one thing a client says to this server.
//
// Deliberately narrow: anything else a client sends in text is
// dropped, so this is the whole of the client-to-server vocabulary.
func clientQuit(data []byte) bool {
	var msg struct {
		T string `json:"t"`
	}
	if err := json.Unmarshal(data, &msg); err != nil {
		return false
	}
	return msg.T == "quit"
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
