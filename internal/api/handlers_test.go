package api

import (
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/rom/rivets_n_ruin/internal/store"
)

// --- the public profile

func TestGetPlayerShowsTheirRecentRuns(t *testing.T) {
	h := newTestServer(t)
	id, token := register(t, h, "FORGEHAMMER")
	for i := 0; i < 3; i++ {
		rec, body := do(t, h, "POST", "/api/scores", token, map[string]any{
			"points": 1000 * (i + 1), "timeSec": 60.0, "turrets": 5, "deaths": 0, "levels": 1,
		})
		if rec.Code != http.StatusCreated {
			t.Fatalf("posting a score: %d %v", rec.Code, body)
		}
	}

	rec, body := do(t, h, "GET", "/api/players/"+id, "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET player: %d %v", rec.Code, body)
	}
	player, _ := body["player"].(map[string]any)
	if player == nil || player["name"] != "FORGEHAMMER" {
		t.Fatalf("player came back as %v", body["player"])
	}
	// A public profile must not hand out the credentials.
	for _, secret := range []string{"tokenHash", "passHash", "token", "password"} {
		if _, leaked := player[secret]; leaked {
			t.Errorf("the public profile includes %q", secret)
		}
	}
	recent, _ := body["recent"].([]any)
	if len(recent) != 3 {
		t.Errorf("profile shows %d runs, want 3", len(recent))
	}

	// The limit is a query parameter, and nonsense in it falls back.
	_, body = do(t, h, "GET", "/api/players/"+id+"?limit=1", "", nil)
	if recent, _ := body["recent"].([]any); len(recent) != 1 {
		t.Errorf("limit=1 returned %d runs", len(recent))
	}
	_, body = do(t, h, "GET", "/api/players/"+id+"?limit=not-a-number", "", nil)
	if recent, _ := body["recent"].([]any); len(recent) != 3 {
		t.Errorf("a junk limit returned %d runs rather than falling back", len(recent))
	}
}

func TestGetPlayerThatDoesNotExist(t *testing.T) {
	h := newTestServer(t)
	rec, body := do(t, h, "GET", "/api/players/no-such-pilot", "", nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("got %d %v, want 404", rec.Code, body)
	}
}

// --- the runs board
//
// Separate from /top because it does not fold to one row per player: one
// exceptional pilot can hold several places, which the pilots board hides.

func TestTopRunsDoesNotFoldToOnePerPlayer(t *testing.T) {
	h := newTestServer(t)
	_, token := register(t, h, "RUSTHOUND")
	for _, points := range []int{5000, 9000, 7000} {
		do(t, h, "POST", "/api/scores", token, map[string]any{
			"points": points, "timeSec": 60.0, "turrets": 5, "deaths": 0, "levels": 1,
		})
	}

	rec, body := do(t, h, "GET", "/api/scores/runs", "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET runs: %d %v", rec.Code, body)
	}
	top, _ := body["top"].([]any)
	if len(top) != 3 {
		t.Fatalf("the runs board folded %d runs into %d rows", 3, len(top))
	}

	// ...and the pilots board does fold them, which is the difference.
	_, body = do(t, h, "GET", "/api/scores/top", "", nil)
	if folded, _ := body["top"].([]any); len(folded) != 1 {
		t.Errorf("the pilots board shows %d rows for one pilot, want 1", len(folded))
	}

	_, body = do(t, h, "GET", "/api/scores/runs?limit=2&window=all", "", nil)
	if top, _ := body["top"].([]any); len(top) != 2 {
		t.Errorf("limit=2 returned %d rows", len(top))
	}
}

// --- a mod's own board

func TestModTop(t *testing.T) {
	h := newTestServer(t)
	_, token := register(t, h, "MODDER")
	rec, mod := do(t, h, "POST", "/api/mods", token, map[string]any{
		"name": "SCRAPYARD", "seed": 1234, "notes": "a hull of junk",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("creating a mod: %d %v", rec.Code, mod)
	}
	id, _ := mod["id"].(string)
	if id == "" {
		if m, ok := mod["mod"].(map[string]any); ok {
			id, _ = m["id"].(string)
		}
	}
	if id == "" {
		t.Fatalf("no mod id in %v", mod)
	}

	do(t, h, "POST", "/api/scores", token, map[string]any{
		"modId": id, "points": 4242, "timeSec": 60.0, "turrets": 1, "deaths": 0, "levels": 1,
	})

	rec, body := do(t, h, "GET", "/api/mods/"+id+"/top", "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("mod board: %d %v", rec.Code, body)
	}
	top, _ := body["top"].([]any)
	if len(top) != 1 {
		t.Fatalf("the mod board shows %d rows, want 1", len(top))
	}

	// A mod's score must not appear on the stock board, or publishing a
	// generous mod would be the easiest way to the top of it.
	_, stock := do(t, h, "GET", "/api/scores/top", "", nil)
	if rows, _ := stock["top"].([]any); len(rows) != 0 {
		t.Errorf("a mod score appeared on the stock board")
	}

	rec, _ = do(t, h, "GET", "/api/mods/no-such-mod/top", "", nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("a board for a mod that does not exist gave %d, want 404", rec.Code)
	}
}

// --- presence

func TestHeartbeatClampsProgressAndNeedsAuth(t *testing.T) {
	h := newTestServer(t)
	_, token := register(t, h, "KITESPUR")

	rec, _ := do(t, h, "POST", "/api/presence", "", map[string]any{"progress": 0.5})
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("an unauthenticated heartbeat gave %d, want 401", rec.Code)
	}

	for _, p := range []float64{-5, 0, 0.5, 1, 99} {
		rec, body := do(t, h, "POST", "/api/presence", token, map[string]any{
			"progress": p, "score": 100,
		})
		if rec.Code != http.StatusNoContent {
			t.Fatalf("progress %v: %d %v", p, rec.Code, body)
		}
	}

	_, body := do(t, h, "GET", "/api/presence", "", nil)
	flying, _ := body["flying"].([]any)
	if len(flying) != 1 {
		t.Fatalf("%d pilots in flight, want 1", len(flying))
	}
	got := flying[0].(map[string]any)["progress"].(float64)
	if got < 0 || got > 1 {
		t.Errorf("progress came back as %v, outside 0..1", got)
	}
}

func TestHeartbeatRejectsAMalformedBody(t *testing.T) {
	h := newTestServer(t)
	_, token := register(t, h, "NAILDROSS")
	rec, _ := doRaw(t, h, "POST", "/api/presence", token, "{{{")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("a malformed heartbeat gave %d, want 400", rec.Code)
	}
}

// A heartbeat carrying a run id is also the evidence the run was flown.
func TestHeartbeatFeedsTheRunsAntiCheatCounter(t *testing.T) {
	s := newServer(t)
	r, err := s.runs.open("p", "")
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 4; i++ {
		s.runs.beat(r.ID, i)
	}
	got := s.runs.get(r.ID)
	if got.Beats != 4 {
		t.Errorf("counted %d beats, want 4", got.Beats)
	}
	if got.MaxLevel != 4 {
		t.Errorf("max level %d, want 4", got.MaxLevel)
	}
	// A beat for a run that does not exist is ignored, not a panic.
	if s.runs.beat("no-such-run", 9) {
		t.Error("a beat for an unknown run reported success")
	}
	// And the level only ever goes up: a client reporting hull 1 after
	// hull 9 must not walk the ceiling back down.
	s.runs.beat(r.ID, 1)
	if s.runs.get(r.ID).MaxLevel != 4 {
		t.Error("a lower level report lowered the recorded maximum")
	}
}

// --- error mapping

func TestStatusForMapsStoreErrors(t *testing.T) {
	cases := []struct {
		err  error
		want int
	}{
		{store.ErrNotFound, http.StatusNotFound},
		{store.ErrNameTaken, http.StatusConflict},
		{store.ErrConflict, http.StatusConflict},
		{errors.New("something else"), http.StatusInternalServerError},
		// Wrapped, because the store wraps and a switch on == would miss.
		{fmt.Errorf("looking up: %w", store.ErrNotFound), http.StatusNotFound},
		{fmt.Errorf("creating: %w", store.ErrNameTaken), http.StatusConflict},
	}
	for _, c := range cases {
		if got := statusFor(c.err); got != c.want {
			t.Errorf("statusFor(%v) = %d, want %d", c.err, got, c.want)
		}
	}
}

// --- the sweepers
//
// Split from their timers so the rule can be tested rather than the clock.

func TestIdleRateLimitBucketsAreSwept(t *testing.T) {
	rl := newRateLimiter(10, 10)
	rl.allow("1.1.1.1")
	rl.allow("2.2.2.2")
	if len(rl.buckets) != 2 {
		t.Fatalf("%d buckets, want 2", len(rl.buckets))
	}
	// Nothing is idle yet.
	if n := rl.sweepOnce(time.Now().Add(-time.Hour)); n != 0 {
		t.Errorf("swept %d fresh buckets", n)
	}
	// Everything is, now.
	if n := rl.sweepOnce(time.Now().Add(time.Hour)); n != 2 {
		t.Errorf("swept %d idle buckets, want 2", n)
	}
	if len(rl.buckets) != 0 {
		t.Errorf("%d buckets left behind", len(rl.buckets))
	}
	// An active IP survives a sweep that takes an idle one.
	rl.allow("3.3.3.3")
	rl.buckets["old"] = &bucket{last: time.Now().Add(-2 * idleBucketTTL)}
	rl.sweepOnce(time.Now().Add(-idleBucketTTL))
	if _, stillThere := rl.buckets["old"]; stillThere {
		t.Error("the idle bucket survived")
	}
	if _, stillThere := rl.buckets["3.3.3.3"]; !stillThere {
		t.Error("the active bucket was swept along with the idle one")
	}
}

func TestExpiredRunsAreSwept(t *testing.T) {
	s := newServer(t)
	fresh, _ := s.runs.open("p", "")
	stale, _ := s.runs.open("p", "")
	s.runs.runs[stale.ID].Started = time.Now().Add(-2 * runTTL)

	if n := s.runs.sweepOnce(time.Now().Add(-runTTL)); n != 1 {
		t.Errorf("swept %d runs, want 1", n)
	}
	if s.runs.get(stale.ID) != nil {
		t.Error("the expired run survived")
	}
	if s.runs.get(fresh.ID) == nil {
		t.Error("a live run was swept with the expired one")
	}
}
