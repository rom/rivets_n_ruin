package api

import (
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rom/rivets_n_ruin/internal/store"
)

// Posting a co-op run.
//
// The thing worth protecting here is not the arithmetic -- that is
// shared with the solo route and already tested -- but the two names on
// the row. A board that credits a pilot who was not there, or lets one
// pilot name another, is worse than no co-op board at all, because it
// looks like a record.
//
// So every test below is about who gets credited: that the host posts
// and the guest does not, that the partner comes from the room and
// never from the request, and that a pair who did not actually fly
// together does not get a row.

// A server plus its routes, with the clock in the test's hands: the
// time-flown-together rule is a duration, and a duration nobody can
// advance is a rule nobody can test.
func coopScoreServer(t *testing.T) (*Server, http.Handler, *fakeClock) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	s := New(store.NewMemory(), log, Config{
		RateLimitPerSec: 1e6, RateBurst: 1e6, RequireRuns: true,
	})
	clk := &fakeClock{at: time.Date(2026, 4, 1, 9, 0, 0, 0, time.UTC)}
	s.SetClock(clk.now)
	// The registry captured the old clock when New built it.
	s.coop = newCoopRegistry(s.now)
	return s, s.Routes(), clk
}

type fakeClock struct{ at time.Time }

func (c *fakeClock) now() time.Time      { return c.at }
func (c *fakeClock) add(d time.Duration) { c.at = c.at.Add(d) }

// A room with both pilots in it and both sockets connected, which is
// the state a run is actually played in.
type pairedRoom struct {
	code      string
	hostTok   string
	guestTok  string
	hostID    string
	guestID   string
	room      *coopRoom
	hostPeer  *coopPeer
	guestPeer *coopPeer
}

func pairUp(t *testing.T, s *Server, h http.Handler, clk *fakeClock) *pairedRoom {
	t.Helper()
	hostID, hostTok := register(t, h, "rom")
	guestID, guestTok := register(t, h, "ada")

	w, out := do(t, h, "POST", "/api/coop/open", hostTok, map[string]any{"seed": 7, "hull": 0})
	if w.Code != http.StatusOK {
		t.Fatalf("opening a room: %d %s", w.Code, w.Body)
	}
	code := out["code"].(string)

	if w, _ := do(t, h, "POST", "/api/coop/"+code+"/join", guestTok, nil); w.Code != http.StatusOK {
		t.Fatalf("joining: %d %s", w.Code, w.Body)
	}

	room := s.coop.find(code)
	if room == nil {
		t.Fatal("the room vanished between opening and joining")
	}
	hp, _, err := room.join(&wsConnStub{}, sideHost, clk.now())
	if err != nil {
		t.Fatalf("host socket: %v", err)
	}
	gp, _, err := room.join(&wsConnStub{}, sideGuest, clk.now())
	if err != nil {
		t.Fatalf("guest socket: %v", err)
	}
	return &pairedRoom{
		code: code, hostTok: hostTok, guestTok: guestTok,
		hostID: hostID, guestID: guestID,
		room: room, hostPeer: hp, guestPeer: gp,
	}
}

// backdate makes a run session as old as the run it is about to carry.
//
// checkRun times a run against the wall clock -- that is the check that
// catches a tampered client clock, so it cannot be moved onto the
// server's injectable one without giving up the thing it is for. A test
// that wants a three-minute run therefore has to make the session three
// minutes old, and the honest way to do that is to say so here rather
// than to keep every test run under the 25-second slack and leave the
// rules that matter at this length untested.
func backdate(t *testing.T, s *Server, runID string, bySec float64) {
	t.Helper()
	r := s.runs.get(runID)
	if r == nil {
		t.Fatalf("no run %s to backdate", runID)
	}
	s.runs.mu.Lock()
	r.Started = r.Started.Add(-time.Duration(bySec+5) * time.Second)
	s.runs.mu.Unlock()
}

// post builds a signed co-op submission for a run of the given length.
func postCoop(t *testing.T, s *Server, h http.Handler, p *pairedRoom,
	token string, points int, timeSec float64, levels int) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	w, out := do(t, h, "POST", "/api/runs/start", token, map[string]any{})
	if w.Code != http.StatusCreated {
		t.Fatalf("opening a run: %d %s", w.Code, w.Body)
	}
	runID := out["runId"].(string)
	secret, err := base64.RawURLEncoding.DecodeString(out["secret"].(string))
	if err != nil {
		t.Fatal(err)
	}
	backdate(t, s, runID, timeSec)
	// Enough progress reports for a run of this length; see checkRun.
	for i := 0; i < int(timeSec/10)+2; i++ {
		s.runs.beat(runID, levels-1)
	}
	return do(t, h, "POST", "/api/coop/scores", token, map[string]any{
		"code": p.code, "points": points, "timeSec": timeSec,
		"levels": levels, "hullsFlown": levels, "turrets": 3, "deaths": 1,
		"runId": runID, "sig": sign(secret, runID, points, timeSec, levels),
	})
}

func TestACoopRunIsRecordedForBothPilots(t *testing.T) {
	s, h, clk := coopScoreServer(t)
	p := pairUp(t, s, h, clk)
	clk.add(200 * time.Second) // they flew it together

	w, out := postCoop(t, s, h, p, p.hostTok, 48000, 180, 3)
	if w.Code != http.StatusCreated {
		t.Fatalf("posting a co-op run: %d %s", w.Code, w.Body)
	}
	score, _ := out["score"].(map[string]any)
	if score == nil {
		t.Fatalf("no score came back: %s", w.Body)
	}
	if score["hostName"] != "rom" || score["guestName"] != "ada" {
		t.Fatalf("the row does not name both pilots: %v", score)
	}
	if got := score["pairedSec"].(float64); got < 179 {
		t.Fatalf("time flown together recorded as %v, want about 200", got)
	}
	rank, _ := out["rank"].(map[string]any)
	if rank == nil || rank["position"].(float64) != 1 {
		t.Fatalf("the first co-op run did not place first: %v", rank)
	}

	// And it is on the co-op board, not the solo one.
	_, board := do(t, h, "GET", "/api/coop/scores/top", "", nil)
	rows, _ := board["top"].([]any)
	if len(rows) != 1 {
		t.Fatalf("the co-op board has %d row(s), want 1", len(rows))
	}
	_, solo := do(t, h, "GET", "/api/scores/runs", "", nil)
	if sr, _ := solo["top"].([]any); len(sr) != 0 {
		t.Fatalf("a co-op run reached the solo board: %d row(s)", len(sr))
	}
}

// The guest's figures are the host's figures, arriving back by way of a
// snapshot. A second submission could only ever be a duplicate row or a
// disagreement for the server to arbitrate.
func TestOnlyTheHostPostsACoopRun(t *testing.T) {
	s, h, clk := coopScoreServer(t)
	p := pairUp(t, s, h, clk)
	clk.add(200 * time.Second)

	w, _ := postCoop(t, s, h, p, p.guestTok, 48000, 180, 3)
	if w.Code != http.StatusForbidden {
		t.Fatalf("the guest posted a co-op run: %d %s", w.Code, w.Body)
	}
}

// The partner is not in the request, so there is nothing to forge. This
// is the test that would fail if the handler ever started reading a
// name or an id out of the body.
func TestAHostCannotNameTheOtherPilot(t *testing.T) {
	s, h, clk := coopScoreServer(t)
	p := pairUp(t, s, h, clk)
	// A third pilot, who is about to be credited with a run they have
	// never heard of -- if the handler reads any of this from the body.
	victimID, _ := register(t, h, "cass")
	clk.add(200 * time.Second)

	w, out := do(t, h, "POST", "/api/runs/start", p.hostTok, map[string]any{})
	if w.Code != http.StatusCreated {
		t.Fatal(w.Body)
	}
	runID := out["runId"].(string)
	secret, _ := base64.RawURLEncoding.DecodeString(out["secret"].(string))
	backdate(t, s, runID, 100)
	for i := 0; i < 20; i++ {
		s.runs.beat(runID, 2)
	}
	honest := map[string]any{
		"code": p.code, "points": 1000, "timeSec": 100.0, "levels": 2,
		"hullsFlown": 2, "runId": runID, "sig": sign(secret, runID, 1000, 100, 2),
	}

	// Every field a forger might reach for. None of them exists on the
	// request, and the decoder rejects unknown fields -- so a client
	// trying to name its partner does not get a quietly ignored field,
	// it gets a 400 and no row at all.
	for _, extra := range []map[string]any{
		{"guestId": victimID},
		{"guestName": "cass"},
		{"hostName": "somebody else"},
		{"pairedSec": 999999},
	} {
		body := map[string]any{}
		for k, v := range honest {
			body[k] = v
		}
		for k, v := range extra {
			body[k] = v
		}
		w, _ := do(t, h, "POST", "/api/coop/scores", p.hostTok, body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("a submission carrying %v was answered %d, want 400", extra, w.Code)
		}
	}

	// And the honest one credits the pilot the ROOM recorded.
	w, out = do(t, h, "POST", "/api/coop/scores", p.hostTok, honest)
	if w.Code != http.StatusCreated {
		t.Fatalf("the honest submission was refused: %d %s", w.Code, w.Body)
	}
	score := out["score"].(map[string]any)
	if score["guestId"] != p.guestID || score["guestName"] != "ada" {
		t.Fatalf("the credited partner is not the one who joined: %v", score)
	}
	if score["hostName"] != "rom" {
		t.Fatalf("the host is not named as itself: %v", score)
	}
}

func TestACoopRunNeedsASignedInSecondPilot(t *testing.T) {
	s, h, clk := coopScoreServer(t)
	_, hostTok := register(t, h, "rom")
	w, out := do(t, h, "POST", "/api/coop/open", hostTok, map[string]any{"seed": 7, "hull": 0})
	if w.Code != http.StatusOK {
		t.Fatal(w.Body)
	}
	code := out["code"].(string)
	room := s.coop.find(code)
	// A guest's socket, but no account behind it: an old client that
	// never called /join.
	if _, _, err := room.join(&wsConnStub{}, sideHost, clk.now()); err != nil {
		t.Fatal(err)
	}
	if _, _, err := room.join(&wsConnStub{}, sideGuest, clk.now()); err != nil {
		t.Fatal(err)
	}
	clk.add(200 * time.Second)

	p := &pairedRoom{code: code, hostTok: hostTok}
	w, _ = postCoop(t, s, h, p, hostTok, 1000, 100, 2)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a run with an anonymous second pilot was recorded: %d %s", w.Code, w.Body)
	}
}

func TestACoopRunCannotBePostedAfterTheRoomHasGone(t *testing.T) {
	s, h, clk := coopScoreServer(t)
	p := pairUp(t, s, h, clk)
	clk.add(200 * time.Second)
	s.coop.drop(p.code)

	w, _ := postCoop(t, s, h, p, p.hostTok, 1000, 100, 2)
	if w.Code != http.StatusConflict {
		t.Fatalf("a run posted into a room that no longer exists: %d %s", w.Code, w.Body)
	}
}

// Join, leave, and collect a board row: the thing the paired clock
// exists to stop.
func TestAGuestWhoLeftEarlyDoesNotGetABoardRow(t *testing.T) {
	s, h, clk := coopScoreServer(t)
	p := pairUp(t, s, h, clk)
	// Twenty seconds together, then the guest goes and the host flies
	// on for five more minutes.
	clk.add(20 * time.Second)
	p.room.leave(p.guestPeer)
	clk.add(300 * time.Second)

	w, out := postCoop(t, s, h, p, p.hostTok, 48000, 320, 4)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a run flown almost entirely alone was credited to two: %d %s", w.Code, w.Body)
	}
	if msg, _ := out["error"].(string); msg == "" {
		t.Fatal("the refusal said nothing; two people are waiting on this screen")
	} else if !strings.Contains(msg, "connected") {
		t.Fatalf("the refusal does not explain itself: %q", msg)
	}
}

// The other half of that rule: a disconnect-and-return in the middle of
// a long campaign is a bad network, not a fraud, and voiding the run
// would cost the pilots something they earned.
func TestABriefDropoutStillCounts(t *testing.T) {
	s, h, clk := coopScoreServer(t)
	p := pairUp(t, s, h, clk)
	clk.add(300 * time.Second)
	p.room.leave(p.guestPeer)
	clk.add(30 * time.Second) // thirty seconds of reconnecting
	gp, _, err := p.room.join(&wsConnStub{}, sideGuest, clk.now())
	if err != nil {
		t.Fatal(err)
	}
	p.guestPeer = gp
	clk.add(300 * time.Second)

	w, _ := postCoop(t, s, h, p, p.hostTok, 48000, 620, 5)
	if w.Code != http.StatusCreated {
		t.Fatalf("a run with one dropout was thrown away: %d %s", w.Code, w.Body)
	}
}

// A run too short for the fraction to mean anything. Socket setup is a
// large share of twelve seconds, and a pair who died on the first hull
// should not be refused for it.
func TestAVeryShortCoopRunIsNotRefusedForTiming(t *testing.T) {
	s, h, clk := coopScoreServer(t)
	p := pairUp(t, s, h, clk)
	// No time passes at all: paired reads zero.
	w, _ := postCoop(t, s, h, p, p.hostTok, 400, 12, 1)
	if w.Code != http.StatusCreated {
		t.Fatalf("a twelve-second run was refused on the pairing rule: %d %s", w.Code, w.Body)
	}
}

func TestACoopRunCannotBePostedTwice(t *testing.T) {
	s, h, clk := coopScoreServer(t)
	p := pairUp(t, s, h, clk)
	clk.add(200 * time.Second)

	w, out := do(t, h, "POST", "/api/runs/start", p.hostTok, map[string]any{})
	if w.Code != http.StatusCreated {
		t.Fatal(w.Body)
	}
	runID := out["runId"].(string)
	secret, _ := base64.RawURLEncoding.DecodeString(out["secret"].(string))
	backdate(t, s, runID, 180)
	for i := 0; i < 30; i++ {
		s.runs.beat(runID, 2)
	}
	body := map[string]any{
		"code": p.code, "points": 5000, "timeSec": 180.0, "levels": 3,
		"hullsFlown": 3, "runId": runID, "sig": sign(secret, runID, 5000, 180, 3),
	}
	if w, _ := do(t, h, "POST", "/api/coop/scores", p.hostTok, body); w.Code != http.StatusCreated {
		t.Fatalf("the first post was refused: %d %s", w.Code, w.Body)
	}
	if w, _ := do(t, h, "POST", "/api/coop/scores", p.hostTok, body); w.Code != http.StatusConflict {
		t.Fatalf("the same run posted twice: %d %s", w.Code, w.Body)
	}
	_, board := do(t, h, "GET", "/api/coop/scores/top", "", nil)
	if rows, _ := board["top"].([]any); len(rows) != 1 {
		t.Fatalf("the board has %d row(s) for one run", len(rows))
	}
}

func TestAForgedCoopSignatureIsRefused(t *testing.T) {
	s, h, clk := coopScoreServer(t)
	p := pairUp(t, s, h, clk)
	clk.add(200 * time.Second)

	w, out := do(t, h, "POST", "/api/runs/start", p.hostTok, map[string]any{})
	if w.Code != http.StatusCreated {
		t.Fatal(w.Body)
	}
	runID := out["runId"].(string)
	backdate(t, s, runID, 180)
	for i := 0; i < 30; i++ {
		s.runs.beat(runID, 2)
	}
	w, _ = do(t, h, "POST", "/api/coop/scores", p.hostTok, map[string]any{
		"code": p.code, "points": 5000, "timeSec": 180.0, "levels": 3,
		"hullsFlown": 3, "runId": runID, "sig": "forged",
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a forged signature was accepted: %d %s", w.Code, w.Body)
	}
	// And the run is still spendable, so one bad request has not voided
	// a legitimate campaign.
	if _, err := s.runs.claim(runID); err != nil {
		t.Fatalf("a failed check burned the run: %v", err)
	}
}

// --- /join

func TestJoiningACoopGameNeedsAnAccount(t *testing.T) {
	s, h, _ := coopScoreServer(t)
	_, hostTok := register(t, h, "rom")
	_, out := do(t, h, "POST", "/api/coop/open", hostTok, map[string]any{"seed": 1, "hull": 0})
	code := out["code"].(string)
	_ = s

	w, _ := do(t, h, "POST", "/api/coop/"+code+"/join", "", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("an anonymous pilot claimed the guest slot: %d %s", w.Code, w.Body)
	}
}

func TestAPilotCannotJoinTheirOwnCoopGame(t *testing.T) {
	_, h, _ := coopScoreServer(t)
	_, hostTok := register(t, h, "rom")
	_, out := do(t, h, "POST", "/api/coop/open", hostTok, map[string]any{"seed": 1, "hull": 0})
	code := out["code"].(string)

	w, _ := do(t, h, "POST", "/api/coop/"+code+"/join", hostTok, nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("a pilot joined their own game: %d %s", w.Code, w.Body)
	}
}

func TestJoiningAFullCoopGameIsRefused(t *testing.T) {
	s, h, clk := coopScoreServer(t)
	p := pairUp(t, s, h, clk)
	_, thirdTok := register(t, h, "cass")

	w, _ := do(t, h, "POST", "/api/coop/"+p.code+"/join", thirdTok, nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("a third pilot claimed the guest slot: %d %s", w.Code, w.Body)
	}
}

func TestJoiningTellsTheGuestWhatTheyAreJoining(t *testing.T) {
	_, h, _ := coopScoreServer(t)
	_, hostTok := register(t, h, "rom")
	_, guestTok := register(t, h, "ada")
	_, out := do(t, h, "POST", "/api/coop/open", hostTok, map[string]any{"seed": 4242, "hull": 5})
	code := out["code"].(string)

	w, got := do(t, h, "POST", "/api/coop/"+code+"/join", guestTok, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("joining: %d %s", w.Code, w.Body)
	}
	// The guest builds the identical hull from these two numbers, so
	// they are the whole point of the reply.
	if got["seed"].(float64) != 4242 || got["hull"].(float64) != 5 {
		t.Fatalf("the reply does not carry the world: %v", got)
	}
	if got["host"] != "rom" {
		t.Fatalf("the reply does not say who is hosting: %v", got)
	}
}

// --- the admin view

func TestTheOperatorCanSeeAndRemoveACoopRun(t *testing.T) {
	s, st := adminSrv(t, false)
	s.adminRL = newRateLimiter(1e6, 1e6)
	s.requireRuns = true
	clk := &fakeClock{at: time.Date(2026, 4, 1, 9, 0, 0, 0, time.UTC)}
	s.SetClock(clk.now)
	s.coop = newCoopRegistry(s.now)
	h := s.Routes()
	admin := s.AdminRoutes(nil)

	p := pairUp(t, s, h, clk)
	clk.add(200 * time.Second)
	if w, _ := postCoop(t, s, h, p, p.hostTok, 7000, 180, 3); w.Code != http.StatusCreated {
		t.Fatalf("posting: %d %s", w.Code, w.Body)
	}

	tok := adminLoginAs(t, admin)
	w, out := adminDo(t, admin, "GET", "/api/admin/coop", tok, nil, true)
	if w.Code != http.StatusOK {
		t.Fatalf("listing co-op runs: %d %s", w.Code, w.Body)
	}
	runs, _ := out["runs"].([]any)
	if len(runs) != 1 {
		t.Fatalf("the operator sees %d co-op run(s), want 1: %s", len(runs), w.Body)
	}
	row := runs[0].(map[string]any)
	id := row["id"].(string)
	if row["hostName"] != "rom" || row["guestName"] != "ada" {
		t.Fatalf("the row does not name both pilots: %v", row)
	}

	// Searching by either name finds it.
	for _, q := range []string{"rom", "ada"} {
		_, found := adminDo(t, admin, "GET", "/api/admin/coop?q="+q, tok, nil, true)
		if got, _ := found["runs"].([]any); len(got) != 1 {
			t.Fatalf("searching %q found %d run(s)", q, len(got))
		}
	}

	if w, _ := adminDo(t, admin, "DELETE", "/api/admin/coop/"+id, tok, nil, true); w.Code != http.StatusOK {
		t.Fatalf("deleting: %d %s", w.Code, w.Body)
	}
	_, after := adminDo(t, admin, "GET", "/api/admin/coop", tok, nil, true)
	if got, _ := after["runs"].([]any); len(got) != 0 {
		t.Fatalf("%d run(s) survived the delete", len(got))
	}
	// Neither pilot's card moved, before or after: a co-op run never
	// fed them, so there was nothing to recount.
	for _, id := range []string{p.hostID, p.guestID} {
		pl, err := st.PlayerByID(id)
		if err != nil {
			t.Fatal(err)
		}
		if pl.Runs != 0 || pl.Best != 0 {
			t.Fatalf("%s's card reads runs %d best %d", pl.Name, pl.Runs, pl.Best)
		}
	}
}
