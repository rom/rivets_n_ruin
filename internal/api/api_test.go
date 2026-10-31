package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/rom/rivets_n_ruin/internal/store"
	"github.com/rom/rivets_n_ruin/internal/validate"
)

func newTestServer(t *testing.T) http.Handler {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	// Every test request shares one RemoteAddr, so the default per-IP limit
	// would throttle the suite itself. Rate limiting gets its own test below.
	return New(store.NewMemory(), log, Config{RateLimitPerSec: 1e6, RateBurst: 1e6}).Routes()
}

func do(t *testing.T, h http.Handler, method, path, token string, body any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, r)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	var out map[string]any
	if w.Body.Len() > 0 {
		_ = json.Unmarshal(w.Body.Bytes(), &out)
	}
	return w, out
}

func register(t *testing.T, h http.Handler, name string) (id, token string) {
	t.Helper()
	w, out := do(t, h, "POST", "/api/players", "", map[string]any{"name": name})
	if w.Code != http.StatusCreated {
		t.Fatalf("register %q: status %d body %s", name, w.Code, w.Body)
	}
	return out["id"].(string), out["token"].(string)
}

func TestHealth(t *testing.T) {
	h := newTestServer(t)
	w, out := do(t, h, "GET", "/api/health", "", nil)
	if w.Code != http.StatusOK || out["ok"] != true {
		t.Fatalf("health: %d %v", w.Code, out)
	}
}

func TestRegisterAndAuth(t *testing.T) {
	h := newTestServer(t)
	_, token := register(t, h, "rom")

	w, out := do(t, h, "GET", "/api/me", token, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("me: %d %s", w.Code, w.Body)
	}
	if out["player"].(map[string]any)["name"] != "rom" {
		t.Fatalf("wrong player: %v", out)
	}
	// The token hash must never be serialised.
	if strings.Contains(w.Body.String(), "TokenHash") || strings.Contains(w.Body.String(), "tokenHash") {
		t.Fatalf("response leaked the token hash: %s", w.Body)
	}
}

func TestAuthRejection(t *testing.T) {
	h := newTestServer(t)
	for _, tok := range []string{"", "garbage"} {
		w, _ := do(t, h, "POST", "/api/scores", tok, map[string]any{"points": 1})
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("token %q: expected 401, got %d", tok, w.Code)
		}
	}
}

func TestDuplicateNameConflicts(t *testing.T) {
	h := newTestServer(t)
	register(t, h, "rom")
	w, _ := do(t, h, "POST", "/api/players", "", map[string]any{"name": "rom"})
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for a duplicate name, got %d", w.Code)
	}
}

func TestBadNameRejected(t *testing.T) {
	h := newTestServer(t)
	for _, n := range []string{"", "a", strings.Repeat("x", 40)} {
		w, _ := do(t, h, "POST", "/api/players", "", map[string]any{"name": n})
		if w.Code != http.StatusBadRequest {
			t.Fatalf("name %q: expected 400, got %d", n, w.Code)
		}
	}
}

func TestSubmitScoreAndLeaderboard(t *testing.T) {
	h := newTestServer(t)
	_, aTok := register(t, h, "ace")
	_, bTok := register(t, h, "bolt")

	w, out := do(t, h, "POST", "/api/scores", aTok, map[string]any{
		"points": 14039, "timeSec": 95.0, "turrets": 11, "completed": true,
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("submit: %d %s", w.Code, w.Body)
	}
	if rank := out["rank"].(map[string]any); rank["position"].(float64) != 1 {
		t.Fatalf("first submission should rank 1, got %v", rank)
	}

	if w, _ := do(t, h, "POST", "/api/scores", bTok, map[string]any{"points": 500, "timeSec": 20.0}); w.Code != http.StatusCreated {
		t.Fatalf("second submit: %d", w.Code)
	}

	w, out = do(t, h, "GET", "/api/scores/top", "", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("top: %d", w.Code)
	}
	top := out["top"].([]any)
	if len(top) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(top))
	}
	first := top[0].(map[string]any)["score"].(map[string]any)
	if first["name"] != "ace" {
		t.Fatalf("leaderboard order wrong: %v", first)
	}
}

func TestImpossibleScoreRejected(t *testing.T) {
	h := newTestServer(t)
	_, tok := register(t, h, "cheat")

	// Completed far faster than the hull can physically be flown.
	w, out := do(t, h, "POST", "/api/scores", tok, map[string]any{
		"points": 9000, "timeSec": 2.0, "completed": true,
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d (%s)", w.Code, w.Body)
	}
	if !strings.Contains(out["error"].(string), "cannot be flown") {
		t.Fatalf("unhelpful error: %v", out)
	}

	// Absurd point total.
	w, _ = do(t, h, "POST", "/api/scores", tok, map[string]any{"points": 999999999, "timeSec": 90.0})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for an absurd score, got %d", w.Code)
	}

	// Nothing landed on the board.
	_, out = do(t, h, "GET", "/api/scores/top", "", nil)
	if n := len(out["top"].([]any)); n != 0 {
		t.Fatalf("rejected scores reached the leaderboard: %d rows", n)
	}
}

func TestUnknownFieldRejected(t *testing.T) {
	h := newTestServer(t)
	_, tok := register(t, h, "rom")
	w, _ := do(t, h, "POST", "/api/scores", tok, map[string]any{"points": 10, "pointz": 99})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for an unknown field, got %d", w.Code)
	}
}

func TestModLifecycle(t *testing.T) {
	h := newTestServer(t)
	_, tok := register(t, h, "author")

	w, mod := do(t, h, "POST", "/api/mods", tok, map[string]any{
		"name":   "Osmium Drift",
		"seed":   1234,
		"config": map[string]any{"SHIP": map[string]any{"maxVX": 420}},
		"notes":  "faster, meaner",
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("create mod: %d %s", w.Code, w.Body)
	}
	id := mod["id"].(string)
	if mod["author"] != "author" {
		t.Fatalf("author not stamped: %v", mod)
	}

	w, got := do(t, h, "GET", "/api/mods/"+id, "", nil)
	if w.Code != http.StatusOK || got["name"] != "Osmium Drift" {
		t.Fatalf("get mod: %d %v", w.Code, got)
	}

	// A score against the mod belongs on the mod's board, not the stock one.
	if w, _ := do(t, h, "POST", "/api/scores", tok, map[string]any{"points": 777, "timeSec": 30.0, "modId": id}); w.Code != http.StatusCreated {
		t.Fatalf("mod score: %d", w.Code)
	}
	_, modTop := do(t, h, "GET", "/api/mods/"+id+"/top", "", nil)
	if n := len(modTop["top"].([]any)); n != 1 {
		t.Fatalf("mod board should hold 1 row, got %d", n)
	}
	_, stockTop := do(t, h, "GET", "/api/scores/top", "", nil)
	if n := len(stockTop["top"].([]any)); n != 0 {
		t.Fatalf("mod score leaked onto the stock board: %d rows", n)
	}

	_, list := do(t, h, "GET", "/api/mods", "", nil)
	if n := len(list["mods"].([]any)); n != 1 {
		t.Fatalf("mod list wrong: %d", n)
	}
}

func TestScoreAgainstUnknownModRejected(t *testing.T) {
	h := newTestServer(t)
	_, tok := register(t, h, "rom")
	w, _ := do(t, h, "POST", "/api/scores", tok, map[string]any{"points": 10, "timeSec": 5.0, "modId": "nope"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestModConfigMustBeObject(t *testing.T) {
	h := newTestServer(t)
	_, tok := register(t, h, "rom")
	w, _ := do(t, h, "POST", "/api/mods", tok, map[string]any{"name": "Bad", "config": []int{1, 2}})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a non-object config, got %d", w.Code)
	}
}

func TestPresence(t *testing.T) {
	h := newTestServer(t)
	_, aTok := register(t, h, "ace")
	_, bTok := register(t, h, "bolt")

	for tok, prog := range map[string]float64{aTok: 0.3, bTok: 0.8} {
		if w, _ := do(t, h, "POST", "/api/presence", tok, map[string]any{"progress": prog, "score": 100}); w.Code != http.StatusNoContent {
			t.Fatalf("heartbeat: %d", w.Code)
		}
	}
	w, out := do(t, h, "GET", "/api/presence", "", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("presence: %d", w.Code)
	}
	if out["count"].(float64) != 2 {
		t.Fatalf("expected 2 pilots flying, got %v", out["count"])
	}
	// sorted by progress, furthest along first
	first := out["flying"].([]any)[0].(map[string]any)
	if first["name"] != "bolt" {
		t.Fatalf("presence not sorted by progress: %v", first)
	}
}

func TestPresenceProgressClamped(t *testing.T) {
	h := newTestServer(t)
	_, tok := register(t, h, "rom")
	if w, _ := do(t, h, "POST", "/api/presence", tok, map[string]any{"progress": 99.0}); w.Code != http.StatusNoContent {
		t.Fatalf("heartbeat: %d", w.Code)
	}
	_, out := do(t, h, "GET", "/api/presence", "", nil)
	if p := out["flying"].([]any)[0].(map[string]any)["progress"].(float64); p != 1 {
		t.Fatalf("progress not clamped: %v", p)
	}
}

func TestStats(t *testing.T) {
	h := newTestServer(t)
	_, tok := register(t, h, "rom")
	do(t, h, "POST", "/api/scores", tok, map[string]any{"points": 1234, "timeSec": 40.0})
	w, out := do(t, h, "GET", "/api/stats", "", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("stats: %d", w.Code)
	}
	if out["players"].(float64) != 1 || out["runs"].(float64) != 1 {
		t.Fatalf("stats wrong: %v", out)
	}
	if out["bestPilot"] != "rom" {
		t.Fatalf("bestPilot wrong: %v", out)
	}
}

func TestCORSPreflight(t *testing.T) {
	h := newTestServer(t)
	req := httptest.NewRequest("OPTIONS", "/api/scores/top", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("preflight: %d", w.Code)
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatal("missing CORS header")
	}
}

func TestOversizedBodyRejected(t *testing.T) {
	h := newTestServer(t)
	_, tok := register(t, h, "rom")
	huge := strings.Repeat("x", MaxBodyBytes+1024)
	req := httptest.NewRequest("POST", "/api/mods", strings.NewReader(`{"name":"`+huge+`"}`))
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for an oversized body, got %d", w.Code)
	}
}

// Many players submitting at once is the core use case.
func TestConcurrentSubmissions(t *testing.T) {
	h := newTestServer(t)
	const n = 25
	tokens := make([]string, n)
	for i := 0; i < n; i++ {
		_, tokens[i] = register(t, h, string(rune('a'+i%26))+string(rune('a'+i/26))+"pilot")
	}

	var wg sync.WaitGroup
	for i, tok := range tokens {
		wg.Add(1)
		go func(i int, tok string) {
			defer wg.Done()
			w, _ := do(t, h, "POST", "/api/scores", tok, map[string]any{
				"points": i * 100, "timeSec": 50.0, "turrets": 3,
			})
			if w.Code != http.StatusCreated {
				t.Errorf("concurrent submit %d: %d", i, w.Code)
			}
		}(i, tok)
	}
	wg.Wait()

	_, out := do(t, h, "GET", "/api/scores/top?limit=100", "", nil)
	if got := len(out["top"].([]any)); got != n {
		t.Fatalf("expected %d leaderboard rows, got %d", n, got)
	}
}

func TestRateLimiterRejectsAFlood(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := New(store.NewMemory(), log, Config{RateLimitPerSec: 1, RateBurst: 3}).Routes()

	codes := map[int]int{}
	for i := 0; i < 10; i++ {
		w, _ := do(t, h, "GET", "/api/health", "", nil)
		codes[w.Code]++
	}
	if codes[http.StatusOK] == 0 {
		t.Fatal("limiter rejected everything, including the initial burst")
	}
	if codes[http.StatusTooManyRequests] == 0 {
		t.Fatalf("limiter never engaged: %v", codes)
	}
}

// Guard the validator's internal consistency. Whether it matches the client
// is checked by test/parity.test.mjs, which reads this file and compares it
// against src/config.js directly — a Go test cannot see the JavaScript.
func TestValidatorIsSelfConsistent(t *testing.T) {
	if validate.BaseMaxVX <= 0 {
		t.Errorf("BaseMaxVX is %v", validate.BaseMaxVX)
	}
	if len(validate.BossRewards) != validate.NumLevels() {
		t.Errorf("%d boss rewards for %d hulls", len(validate.BossRewards), validate.NumLevels())
	}
	if len(validate.BossPickupDrops) != validate.NumLevels() {
		t.Errorf("%d boss drop counts for %d hulls", len(validate.BossPickupDrops), validate.NumLevels())
	}
	for i := 1; i < validate.NumLevels(); i++ {
		if validate.HullLengths[i] <= validate.HullLengths[i-1] {
			t.Errorf("hull %d (%v) is not longer than hull %d (%v)",
				i, validate.HullLengths[i], i-1, validate.HullLengths[i-1])
		}
		if validate.BossRewards[i] <= validate.BossRewards[i-1] {
			t.Errorf("boss %d pays no more than boss %d", i, i-1)
		}
	}
	// A full campaign must fit under the ceiling, or every finished run 422s.
	full := 0
	for _, r := range validate.BossRewards {
		full += r
	}
	s := validate.Submission{
		Points: full * 3, TimeSec: 1800, Turrets: 200,
		Completed: true, Levels: validate.NumLevels(),
	}
	if err := validate.Score(s); err != nil {
		t.Errorf("a maximal legitimate campaign is rejected: %v", err)
	}
}
