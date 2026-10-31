package api

import (
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/rom/rivets_n_ruin/internal/store"
)

func strictServer(t *testing.T) http.Handler {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(store.NewMemory(), log, Config{
		RateLimitPerSec: 1e6, RateBurst: 1e6, RequireRuns: true,
	}).Routes()
}

// Opens a run and returns its id and secret.
func openRun(t *testing.T, h http.Handler, token string) (string, []byte) {
	t.Helper()
	w, out := do(t, h, "POST", "/api/runs/start", token, map[string]any{})
	if w.Code != http.StatusCreated {
		t.Fatalf("start run: %d %s", w.Code, w.Body)
	}
	sec, err := base64.RawURLEncoding.DecodeString(out["secret"].(string))
	if err != nil {
		t.Fatal(err)
	}
	return out["runId"].(string), sec
}

func TestStrictModeRejectsScoresWithoutARun(t *testing.T) {
	h := strictServer(t)
	_, tok := register(t, h, "rom")
	w, _ := do(t, h, "POST", "/api/scores", tok, map[string]any{
		"points": 1000, "timeSec": 100.0, "levels": 1,
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 without a run, got %d", w.Code)
	}
}

func TestSignedRunIsAccepted(t *testing.T) {
	h := strictServer(t)
	_, tok := register(t, h, "rom")
	runID, secret := openRun(t, h, tok)

	// a short claimed time needs no elapsed wall clock
	const pts, secs, lv = 1200, 9.0, 1
	w, _ := do(t, h, "POST", "/api/scores", tok, map[string]any{
		"points": pts, "timeSec": secs, "levels": lv,
		"runId": runID, "sig": sign(secret, runID, pts, secs, lv),
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("a correctly signed run was rejected: %d %s", w.Code, w.Body)
	}
}

func TestTamperedFiguresBreakTheSignature(t *testing.T) {
	h := strictServer(t)
	_, tok := register(t, h, "rom")
	runID, secret := openRun(t, h, tok)

	// sign a modest score, then submit a large one with that signature
	sig := sign(secret, runID, 1200, 9.0, 1)
	w, out := do(t, h, "POST", "/api/scores", tok, map[string]any{
		"points": 999000, "timeSec": 9.0, "levels": 1, "runId": runID, "sig": sig,
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for a tampered payload, got %d", w.Code)
	}
	if out["error"] == nil {
		t.Fatal("no reason given")
	}
}

func TestRunCannotBeSubmittedTwice(t *testing.T) {
	h := strictServer(t)
	_, tok := register(t, h, "rom")
	runID, secret := openRun(t, h, tok)
	body := map[string]any{
		"points": 500, "timeSec": 8.0, "levels": 1,
		"runId": runID, "sig": sign(secret, runID, 500, 8.0, 1),
	}
	if w, _ := do(t, h, "POST", "/api/scores", tok, body); w.Code != http.StatusCreated {
		t.Fatalf("first submission: %d", w.Code)
	}
	w, _ := do(t, h, "POST", "/api/scores", tok, body)
	if w.Code != http.StatusConflict {
		t.Fatalf("a replayed submission was accepted: %d", w.Code)
	}
}

func TestAnotherPilotCannotUseYourRun(t *testing.T) {
	h := strictServer(t)
	_, mine := register(t, h, "owner")
	_, theirs := register(t, h, "thief")
	runID, secret := openRun(t, h, mine)
	w, _ := do(t, h, "POST", "/api/scores", theirs, map[string]any{
		"points": 500, "timeSec": 8.0, "levels": 1,
		"runId": runID, "sig": sign(secret, runID, 500, 8.0, 1),
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for a stolen run, got %d", w.Code)
	}
}

// The check the physics bounds cannot make: a claimed duration longer than
// the run has actually been open.
func TestClaimedTimeCannotExceedWallClock(t *testing.T) {
	h := strictServer(t)
	_, tok := register(t, h, "rom")
	runID, secret := openRun(t, h, tok)
	const pts, secs, lv = 40000, 600.0, 3
	w, out := do(t, h, "POST", "/api/scores", tok, map[string]any{
		"points": pts, "timeSec": secs, "levels": lv,
		"runId": runID, "sig": sign(secret, runID, pts, secs, lv),
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for an impossibly fast 600s run, got %d", w.Code)
	}
	if msg, _ := out["error"].(string); msg == "" {
		t.Fatal("no reason given")
	}
}

func TestUnknownRunIsRejected(t *testing.T) {
	h := strictServer(t)
	_, tok := register(t, h, "rom")
	w, _ := do(t, h, "POST", "/api/scores", tok, map[string]any{
		"points": 100, "timeSec": 5.0, "levels": 1, "runId": "deadbeef", "sig": "x",
	})
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for an unknown run, got %d", w.Code)
	}
}

func TestHeartbeatsAreCountedAgainstTheRun(t *testing.T) {
	rs := newRunStore()
	r, err := rs.open("p1", "")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 9; i++ {
		if !rs.beat(r.ID, 1) {
			t.Fatal("heartbeat not recorded")
		}
	}
	if rs.get(r.ID).Beats != 9 {
		t.Fatalf("expected 9 beats, got %d", rs.get(r.ID).Beats)
	}
	if rs.beat("nope", 1) {
		t.Fatal("a heartbeat for an unknown run was accepted")
	}
}

func TestLongRunWithNoHeartbeatsIsRejected(t *testing.T) {
	rs := newRunStore()
	r, _ := rs.open("p1", "")
	r.Started = time.Now().Add(-20 * time.Minute) // plenty of wall clock
	r.MaxLevel = 2
	sig := sign(r.Secret, r.ID, 40000, 600, 3)
	err := checkRun(r, "p1", 40000, 600, 3, sig)
	if err == nil {
		t.Fatal("a 600s run with no progress reports was accepted")
	}

	// the same run, with heartbeats, passes
	for i := 0; i < 40; i++ {
		rs.beat(r.ID, 2)
	}
	if err := checkRun(r, "p1", 40000, 600, 3, sig); err != nil {
		t.Fatalf("a run with heartbeats was rejected: %v", err)
	}
}

func TestCannotClaimMoreHullsThanReached(t *testing.T) {
	rs := newRunStore()
	r, _ := rs.open("p1", "")
	r.Started = time.Now().Add(-30 * time.Minute)
	r.MaxLevel = 1
	for i := 0; i < 60; i++ {
		rs.beat(r.ID, 1)
	}
	sig := sign(r.Secret, r.ID, 50000, 900, 8)
	if err := checkRun(r, "p1", 50000, 900, 8, sig); err == nil {
		t.Fatal("claimed eight hulls having reached two")
	}
}

// A rejected submission must not burn the run: a client bug or a mangled
// request would otherwise void a legitimate campaign.
func TestAFailedCheckDoesNotConsumeTheRun(t *testing.T) {
	h := strictServer(t)
	_, tok := register(t, h, "rom")
	runID, secret := openRun(t, h, tok)

	// a forged signature is rejected
	w, _ := do(t, h, "POST", "/api/scores", tok, map[string]any{
		"points": 500, "timeSec": 8.0, "levels": 1, "runId": runID, "sig": "forged",
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", w.Code)
	}

	// and the same run still works when submitted properly
	w, _ = do(t, h, "POST", "/api/scores", tok, map[string]any{
		"points": 500, "timeSec": 8.0, "levels": 1,
		"runId": runID, "sig": sign(secret, runID, 500, 8.0, 1),
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("a failed attempt burned the run: %d %s", w.Code, w.Body)
	}
}

// Now reachable, since a bad signature no longer consumes the run first.
func TestSignedButImpossiblyFastRunIsRejectedOnWallClock(t *testing.T) {
	h := strictServer(t)
	_, tok := register(t, h, "rom")
	runID, secret := openRun(t, h, tok)
	const pts, secs, lv = 99999, 400.0, 3
	w, out := do(t, h, "POST", "/api/scores", tok, map[string]any{
		"points": pts, "timeSec": secs, "levels": lv,
		"runId": runID, "sig": sign(secret, runID, pts, secs, lv),
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", w.Code)
	}
	if msg, _ := out["error"].(string); msg == "" || !strings.Contains(msg, "only been open") {
		t.Fatalf("wrong reason: %v", out["error"])
	}
}
