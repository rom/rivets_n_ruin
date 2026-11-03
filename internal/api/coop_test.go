package api

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rom/rivets_n_ruin/internal/store"
)

// --- a WebSocket client, enough of one to drive the relay.
//
// Written here rather than imported for the same reason internal/ws
// writes its own: a borrowed client would be somebody else's reading
// of the protocol, and then the test and the server could be wrong
// together.

type sock struct {
	c net.Conn
	r *bufio.Reader
}

func wsDial(t *testing.T, base, path string) *sock {
	t.Helper()
	host := strings.TrimPrefix(base, "http://")
	c, err := net.Dial("tcp", host)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { c.Close() })
	req := "GET " + path + " HTTP/1.1\r\nHost: x\r\n" +
		"Upgrade: websocket\r\nConnection: Upgrade\r\n" +
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Sec-WebSocket-Version: 13\r\n\r\n"
	if _, err := c.Write([]byte(req)); err != nil {
		t.Fatalf("handshake write: %v", err)
	}
	br := bufio.NewReader(c)
	_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))
	resp, err := http.ReadResponse(br, nil)
	if err != nil {
		t.Fatalf("handshake read: %v", err)
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("%s answered %d, want 101", path, resp.StatusCode)
	}
	return &sock{c: c, r: br}
}

func (s *sock) send(t *testing.T, opcode byte, payload []byte) {
	t.Helper()
	var head []byte
	n := len(payload)
	switch {
	case n < 126:
		head = []byte{0x80 | opcode, 0x80 | byte(n)}
	case n < 1<<16:
		head = []byte{0x80 | opcode, 0x80 | 126, 0, 0}
		binary.BigEndian.PutUint16(head[2:], uint16(n))
	default:
		head = make([]byte, 10)
		head[0], head[1] = 0x80|opcode, 0x80|127
		binary.BigEndian.PutUint64(head[2:], uint64(n))
	}
	var mask [4]byte
	_, _ = rand.Read(mask[:])
	buf := append(head, mask[:]...)
	body := make([]byte, n)
	copy(body, payload)
	for i := range body {
		body[i] ^= mask[i&3]
	}
	if _, err := s.c.Write(append(buf, body...)); err != nil {
		t.Fatalf("send: %v", err)
	}
}

// recv reads one data frame, swallowing control frames. Returns nil on
// timeout or close, so a test can assert that nothing arrived.
func (s *sock) recv(t *testing.T, within time.Duration) (byte, []byte) {
	t.Helper()
	deadline := time.Now().Add(within)
	for {
		_ = s.c.SetReadDeadline(deadline)
		var head [2]byte
		if _, err := io.ReadFull(s.r, head[:]); err != nil {
			return 0, nil
		}
		op := head[0] & 0x0F
		n := int64(head[1] & 0x7F)
		switch n {
		case 126:
			var ext [2]byte
			if _, err := io.ReadFull(s.r, ext[:]); err != nil {
				return 0, nil
			}
			n = int64(binary.BigEndian.Uint16(ext[:]))
		case 127:
			var ext [8]byte
			if _, err := io.ReadFull(s.r, ext[:]); err != nil {
				return 0, nil
			}
			n = int64(binary.BigEndian.Uint64(ext[:]))
		}
		body := make([]byte, n)
		if _, err := io.ReadFull(s.r, body); err != nil {
			return 0, nil
		}
		if op == 0x8 {
			return 0, nil // closed
		}
		if op == 0x9 || op == 0xA {
			continue
		}
		return op, body
	}
}

// waitFor reads until a text message with this "t" arrives, or gives up.
func (s *sock) waitFor(t *testing.T, kind string, within time.Duration) map[string]any {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		op, body := s.recv(t, time.Until(deadline))
		if body == nil {
			return nil
		}
		if op != 1 {
			continue
		}
		var m map[string]any
		if json.Unmarshal(body, &m) != nil {
			continue
		}
		if m["t"] == kind {
			return m
		}
	}
	return nil
}

// --- the fixture

func coopServer(t *testing.T) (*httptest.Server, *Server, store.Store) {
	t.Helper()
	st := store.NewMemory()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	api := New(st, log, Config{RateLimitPerSec: 1e6, RateBurst: 1e6})
	srv := httptest.NewServer(api.Routes())
	t.Cleanup(srv.Close)
	return srv, api, st
}

// openRoom registers a pilot and opens a room as them.
func openRoom(t *testing.T, srv *httptest.Server, st store.Store, name string) string {
	t.Helper()
	p, err := st.CreatePlayer(name, hashToken("tok-"+name))
	if err != nil {
		t.Fatal(err)
	}
	_ = p
	body := strings.NewReader(`{"seed":12345,"hull":3}`)
	req, _ := http.NewRequest("POST", srv.URL+"/api/coop/open", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer tok-"+name)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("open room: %d %s", res.StatusCode, b)
	}
	var out coopOpenResp
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if len(out.Code) != coopCodeLen {
		t.Fatalf("code %q is %d characters, want %d", out.Code, len(out.Code), coopCodeLen)
	}
	return out.Code
}

func TestOpeningARoomNeedsAnAccount(t *testing.T) {
	// A room costs memory, and an anonymous caller could make five
	// hundred of them.
	srv, _, _ := coopServer(t)
	res, err := http.Post(srv.URL+"/api/coop/open", "application/json",
		strings.NewReader(`{"seed":1,"hull":0}`))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("an anonymous open answered %d, want 401", res.StatusCode)
	}
}

func TestCodesAreDistinctAndReadable(t *testing.T) {
	// They get read down a phone, so no vowels — no accidental words —
	// and none of the characters that look like each other.
	seen := map[string]bool{}
	for i := 0; i < 400; i++ {
		c, err := coopCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(c) != coopCodeLen {
			t.Fatalf("code %q is the wrong length", c)
		}
		for _, r := range c {
			if !strings.ContainsRune(coopAlphabet, r) {
				t.Fatalf("code %q has %q, which is not in the alphabet", c, r)
			}
		}
		if strings.ContainsAny(c, "AEIOU01IL") {
			t.Fatalf("code %q has a vowel or a lookalike", c)
		}
		seen[c] = true
	}
	// Not proof of randomness, but a constant or a short cycle dies here.
	if len(seen) < 380 {
		t.Fatalf("400 codes produced only %d distinct values", len(seen))
	}
}

func TestNormaliseCode(t *testing.T) {
	// People type lower case, and they type spaces and hyphens.
	for in, want := range map[string]string{
		"bcdfg":    "BCDFG",
		"BCDFG":    "BCDFG",
		" bc dfg ": "BCDFG",
		"bc-dfg":   "BCDFG",
		"b.c/d?f":  "BCDF",
		"":         "",
	} {
		if got := normaliseCode(in); got != want {
			t.Errorf("normaliseCode(%q) = %q, want %q", in, got, want)
		}
	}
	// And it is bounded, because it comes off a URL.
	if got := normaliseCode(strings.Repeat("A", 5000)); len(got) > 16 {
		t.Fatalf("a 5000-character code normalised to %d characters", len(got))
	}
}

func TestPeekBeforeJoining(t *testing.T) {
	srv, _, st := coopServer(t)
	code := openRoom(t, srv, st, "rom")

	res, err := http.Get(srv.URL + "/api/coop/" + strings.ToLower(code))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("peek answered %d", res.StatusCode)
	}
	var m map[string]any
	if err := json.NewDecoder(res.Body).Decode(&m); err != nil {
		t.Fatal(err)
	}
	// A guest needs the seed and the hull to build the same world, and
	// a name to know whose game this is.
	if m["seed"].(float64) != 12345 || m["hull"].(float64) != 3 {
		t.Fatalf("peek returned %v", m)
	}
	if m["host"] != "rom" {
		t.Fatalf("peek does not say who is hosting: %v", m)
	}
	if m["full"] != false {
		t.Fatalf("an empty room reported itself full")
	}

	res2, err := http.Get(srv.URL + "/api/coop/ZZZZZ")
	if err != nil {
		t.Fatal(err)
	}
	defer res2.Body.Close()
	if res2.StatusCode != http.StatusNotFound {
		t.Fatalf("an unknown code answered %d", res2.StatusCode)
	}
}

func TestTwoPilotsAreJoinedAndBytesGoBothWays(t *testing.T) {
	srv, _, st := coopServer(t)
	code := openRoom(t, srv, st, "rom")

	host := wsDial(t, srv.URL, "/api/coop/"+code+"/host")
	hello := host.waitFor(t, "joined", 3*time.Second)
	if hello == nil {
		t.Fatal("the host was never told it had joined")
	}
	if hello["side"] != "host" || hello["seed"].(float64) != 12345 {
		t.Fatalf("the host's hello is %v", hello)
	}
	if hello["peer"] != false {
		t.Fatal("the host was told somebody else was already there")
	}

	guest := wsDial(t, srv.URL, "/api/coop/"+code+"/guest")
	gh := guest.waitFor(t, "joined", 3*time.Second)
	if gh == nil {
		t.Fatal("the guest was never told it had joined")
	}
	// The guest needs the seed to build the same hull as the host.
	if gh["seed"].(float64) != 12345 || gh["hull"].(float64) != 3 {
		t.Fatalf("the guest's hello is %v", gh)
	}
	if host.waitFor(t, "peer-joined", 3*time.Second) == nil {
		t.Fatal("the host was not told the guest arrived")
	}

	// A snapshot down.
	snap := bytes.Repeat([]byte{0xAB}, 300)
	host.send(t, 2, snap)
	op, got := guest.recv(t, 3*time.Second)
	if op != 2 || !bytes.Equal(got, snap) {
		t.Fatalf("the guest got opcode %#x, %d bytes", op, len(got))
	}
	// An input up.
	in := []byte{0x01, 0x02, 0x03}
	guest.send(t, 2, in)
	op, got = host.recv(t, 3*time.Second)
	if op != 2 || !bytes.Equal(got, in) {
		t.Fatalf("the host got opcode %#x, %q", op, got)
	}
}

func TestAThirdPilotIsRefused(t *testing.T) {
	srv, _, st := coopServer(t)
	code := openRoom(t, srv, st, "rom")
	host := wsDial(t, srv.URL, "/api/coop/"+code+"/host")
	host.waitFor(t, "joined", 2*time.Second)
	guest := wsDial(t, srv.URL, "/api/coop/"+code+"/guest")
	guest.waitFor(t, "joined", 2*time.Second)

	// Two is the game. The third is told why rather than left to
	// wonder at a socket that opened and did nothing.
	third := wsDial(t, srv.URL, "/api/coop/"+code+"/guest")
	refused := third.waitFor(t, "refused", 3*time.Second)
	if refused == nil {
		t.Fatal("a third pilot was let into a two-player game")
	}
	if why, _ := refused["why"].(string); !strings.Contains(why, "two pilots") {
		t.Fatalf("the refusal does not say why: %v", refused)
	}
	// ...and the two who were already there are undisturbed.
	host.send(t, 2, []byte{9})
	if op, got := guest.recv(t, 2*time.Second); op != 2 || len(got) != 1 {
		t.Fatalf("the existing pair stopped working: opcode %#x %v", op, got)
	}
}

func TestJoiningAGameThatIsNotThere(t *testing.T) {
	srv, _, _ := coopServer(t)
	host := strings.TrimPrefix(srv.URL, "http://")
	c, err := net.Dial("tcp", host)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	req := "GET /api/coop/ZZZZZ/guest HTTP/1.1\r\nHost: x\r\n" +
		"Upgrade: websocket\r\nConnection: Upgrade\r\n" +
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Sec-WebSocket-Version: 13\r\n\r\n"
	if _, err := c.Write([]byte(req)); err != nil {
		t.Fatal(err)
	}
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	resp, err := http.ReadResponse(bufio.NewReader(c), nil)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("joining a game that does not exist answered %d, want 404", resp.StatusCode)
	}
}

func TestTheGuestLeavingTellsTheHost(t *testing.T) {
	srv, _, st := coopServer(t)
	code := openRoom(t, srv, st, "rom")
	host := wsDial(t, srv.URL, "/api/coop/"+code+"/host")
	host.waitFor(t, "joined", 2*time.Second)
	guest := wsDial(t, srv.URL, "/api/coop/"+code+"/guest")
	guest.waitFor(t, "joined", 2*time.Second)
	host.waitFor(t, "peer-joined", 2*time.Second)

	guest.c.Close()
	if host.waitFor(t, "peer-left", 3*time.Second) == nil {
		t.Fatal("the host was not told the guest had gone")
	}
	// The host keeps playing: its own simulation is unaffected.
	host.send(t, 2, []byte{1})
	if op, _ := host.recv(t, 500*time.Millisecond); op == 0 {
		// Nothing to read is correct; what matters is the socket is
		// still open, which the next send proves.
		host.send(t, 2, []byte{2})
	}
}

func TestTheHostLeavingEndsIt(t *testing.T) {
	// The host runs the simulation. Without it the guest is drawing a
	// world nobody is advancing, which is worse than being told.
	srv, api, st := coopServer(t)
	code := openRoom(t, srv, st, "rom")
	host := wsDial(t, srv.URL, "/api/coop/"+code+"/host")
	host.waitFor(t, "joined", 2*time.Second)
	guest := wsDial(t, srv.URL, "/api/coop/"+code+"/guest")
	guest.waitFor(t, "joined", 2*time.Second)

	host.c.Close()
	if guest.waitFor(t, "peer-left", 3*time.Second) == nil {
		t.Fatal("the guest was not told the host had gone")
	}
	// ...and the room goes with it, rather than lingering for a guest
	// who can never be joined again.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if api.coop.find(code) == nil {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("the room outlived its host")
}

func TestRoomsAreSweptWhenNobodyComes(t *testing.T) {
	st := store.NewMemory()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	at := time.Now()
	api := New(st, log, Config{RateLimitPerSec: 1e6, RateBurst: 1e6})
	api.SetClock(func() time.Time { return at })
	api.coop = newCoopRegistry(api.now)

	if _, err := api.coop.open(1, 0, "rom"); err != nil {
		t.Fatal(err)
	}
	if api.coop.count() != 1 {
		t.Fatal("the room was not registered")
	}
	// Still inside the idle window.
	at = at.Add(coopIdleTTL / 2)
	api.coop.sweep()
	if api.coop.count() != 1 {
		t.Fatal("a room was swept while it was still waiting for its guest")
	}
	// Past it, with nobody ever connected.
	at = at.Add(coopIdleTTL)
	if n := api.coop.sweep(); n != 1 {
		t.Fatalf("the sweeper took %d rooms, want 1", n)
	}
	if api.coop.count() != 0 {
		t.Fatal("an abandoned room survived the sweep")
	}
}

func TestOpenRoomsAreCapped(t *testing.T) {
	// A room is cheap. Cheap times unbounded is the same bug every time.
	st := store.NewMemory()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	api := New(st, log, Config{})
	for i := 0; i < coopMaxRooms; i++ {
		if _, err := api.coop.open(int64(i), 0, "rom"); err != nil {
			t.Fatalf("room %d: %v", i, err)
		}
	}
	if _, err := api.coop.open(1, 0, "rom"); err == nil {
		t.Fatalf("room %d was allowed past the cap of %d", coopMaxRooms+1, coopMaxRooms)
	}
}

func TestAFloodIsDroppedNotDisconnected(t *testing.T) {
	// A burst is far more likely to be a slow frame catching up than
	// an attack, so the message goes and the player stays.
	srv, _, st := coopServer(t)
	code := openRoom(t, srv, st, "rom")
	host := wsDial(t, srv.URL, "/api/coop/"+code+"/host")
	host.waitFor(t, "joined", 2*time.Second)
	guest := wsDial(t, srv.URL, "/api/coop/"+code+"/guest")
	guest.waitFor(t, "joined", 2*time.Second)
	host.waitFor(t, "peer-joined", 2*time.Second)

	for i := 0; i < coopRateBurst*3; i++ {
		host.send(t, 2, []byte{byte(i)})
	}
	// Drain whatever got through.
	got := 0
	for {
		op, _ := guest.recv(t, 400*time.Millisecond)
		if op == 0 {
			break
		}
		got++
	}
	if got == 0 {
		t.Fatal("the flood was dropped entirely; the limit is too tight to play through")
	}
	if got >= coopRateBurst*3 {
		t.Fatalf("all %d messages went through; nothing is limiting the relay", got)
	}
	// And the socket is still alive, which is the point.
	host.send(t, 2, []byte{42})
	time.Sleep(300 * time.Millisecond)
	guest.send(t, 2, []byte{43})
	if op, _ := host.recv(t, 2*time.Second); op != 2 {
		t.Fatal("the connection did not survive the flood")
	}
}

func TestAnOversizeRelayEndsTheConnection(t *testing.T) {
	// With a guest attached, because the first version of this had
	// only the host connected: the relay then had nobody to forward
	// to, so removing the size check changed nothing observable and
	// the test passed on a server that would have relayed it.
	srv, _, st := coopServer(t)
	code := openRoom(t, srv, st, "rom")
	host := wsDial(t, srv.URL, "/api/coop/"+code+"/host")
	host.waitFor(t, "joined", 2*time.Second)
	guest := wsDial(t, srv.URL, "/api/coop/"+code+"/guest")
	guest.waitFor(t, "joined", 2*time.Second)
	host.waitFor(t, "peer-joined", 2*time.Second)

	// Under the WebSocket layer's own cap, over this relay's. The two
	// limits are different numbers on purpose and this is the gap
	// between them.
	big := make([]byte, coopMaxMessage+1)
	if len(big) >= 64<<10 {
		t.Fatalf("the fixture is over the transport's cap too; it would be refused lower down")
	}
	host.send(t, 2, big)

	// Nothing reaches the far side. Binary only: the guest also gets
	// a text "peer-left" when the oversize sender is dropped, which is
	// correct behaviour and not the relay under test.
	deadline := time.Now().Add(1500 * time.Millisecond)
	for time.Now().Before(deadline) {
		op, body := guest.recv(t, time.Until(deadline))
		if op == 0 {
			break
		}
		if op == 2 {
			t.Fatalf("a %d-byte message was relayed to the guest (%d bytes)",
				len(big), len(body))
		}
	}
	// ...and the sender's socket is gone.
	host.send(t, 2, []byte{1})
	if op, _ := host.recv(t, time.Second); op != 0 {
		t.Fatalf("the oversize sender is still connected (opcode %#x)", op)
	}
}

// Once the host has gone, its code is dead.
//
// Driven through the registry rather than through sockets, because
// what this protects is a race: the host's socket handler marks the
// room closed and then removes it, and a guest arriving between those
// two steps would otherwise join a room that is about to vanish. A
// socket test cannot land reliably in that window; this one is in it
// by construction.
func TestAGuestCannotJoinAfterTheHostHasLeft(t *testing.T) {
	_, api, _ := coopServer(t)
	room, err := api.coop.open(7, 1, "rom")
	if err != nil {
		t.Fatal(err)
	}
	hostPeer, err := room.join(&wsConnStub{}, sideHost, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	// The host goes, and the room has not been dropped yet.
	room.leave(hostPeer)
	if api.coop.find(room.Code) == nil {
		t.Fatal("the fixture dropped the room; this is about the window before that")
	}
	if _, err := room.join(&wsConnStub{}, sideGuest, time.Now()); err == nil {
		t.Fatal("a guest joined a room whose host had already left")
	}
}

func TestAHullOutOfRangeIsRefused(t *testing.T) {
	srv, _, st := coopServer(t)
	if _, err := st.CreatePlayer("rom", hashToken("tok-rom")); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`{"seed":1,"hull":-1}`, `{"seed":1,"hull":9999}`} {
		req, _ := http.NewRequest("POST", srv.URL+"/api/coop/open", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer tok-rom")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("%s answered %d, want 400", body, res.StatusCode)
		}
	}
}

// A connection that goes nowhere, for the pairing tests. Records what
// it was told, so a test can assert on the notification as well as on
// the refusal.
type wsConnStub struct {
	mu     sync.Mutex
	texts  []string
	closed bool
}

func (c *wsConnStub) WriteText(s string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.texts = append(c.texts, s)
	return nil
}
func (c *wsConnStub) WriteBinary([]byte) error { return nil }
func (c *wsConnStub) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
}
func (c *wsConnStub) said() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.texts...)
}

// The notification rules, without a socket in the way.
func TestLeavingTellsTheRightSide(t *testing.T) {
	_, api, _ := coopServer(t)

	// Guest leaves: the host hears about it and keeps playing.
	room, err := api.coop.open(1, 0, "rom")
	if err != nil {
		t.Fatal(err)
	}
	hc, gc := &wsConnStub{}, &wsConnStub{}
	hp, err := room.join(hc, sideHost, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	gp, err := room.join(gc, sideGuest, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	room.leave(gp)
	if !strings.Contains(strings.Join(hc.said(), " "), "peer-left") {
		t.Fatalf("the host was not told the guest left: %v", hc.said())
	}
	if hc.closed {
		t.Fatal("the guest leaving closed the host's connection")
	}

	// Host leaves: the guest hears about it and is closed, because
	// there is no longer anything advancing the world it is drawing.
	room2, err := api.coop.open(2, 0, "rom")
	if err != nil {
		t.Fatal(err)
	}
	hc2, gc2 := &wsConnStub{}, &wsConnStub{}
	hp2, err := room2.join(hc2, sideHost, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := room2.join(gc2, sideGuest, time.Now()); err != nil {
		t.Fatal(err)
	}
	_ = hp
	room2.leave(hp2)
	if !strings.Contains(strings.Join(gc2.said(), " "), "peer-left") {
		t.Fatalf("the guest was not told the host left: %v", gc2.said())
	}
	if !gc2.closed {
		t.Fatal("the guest was left connected to a game with no simulation behind it")
	}
}
