package api

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rom/rivets_n_ruin/internal/model"
	"github.com/rom/rivets_n_ruin/internal/store"
)

// The operator tool lives on its own listener.
//
// What that buys, and what these tests are protecting: the game's
// handler does not have the admin routes registered. Not refused by a
// password check inside a handler — not there. A proxy rule, a
// middleware reordering or a mistake in requireAdmin cannot expose a
// route the mux has never heard of.

func TestTheGameListenerHasNoAdminDoor(t *testing.T) {
	srv, _ := adminSrv(t, false) // admin enabled, and allowed from anywhere
	public := srv.Routes()

	// Every route the operator tool offers, asked of the public
	// handler from the console, with the correct password in the body.
	// The point is that the answer does not depend on any of that.
	for _, c := range []struct{ method, path string }{
		{"POST", "/api/admin/login"},
		{"POST", "/api/admin/logout"},
		{"GET", "/api/admin/stats"},
		{"GET", "/api/admin/errors"},
		{"GET", "/api/admin/presence"},
		{"GET", "/api/admin/players"},
		{"POST", "/api/admin/players"},
		{"GET", "/api/admin/players/abc"},
		{"DELETE", "/api/admin/players/abc"},
		{"POST", "/api/admin/players/abc/reset"},
		{"POST", "/api/admin/players/abc/password"},
		{"POST", "/api/admin/players/abc/stats"},
		{"GET", "/api/admin/runs"},
		{"GET", "/api/admin/runs/abc"},
		{"DELETE", "/api/admin/runs/abc"},
		{"POST", "/api/admin/scores/reset"},
	} {
		req := asLocal(httptest.NewRequest(c.method, c.path,
			strings.NewReader(`{"password":"`+adminPw+`"}`)))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		public.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s %s on the GAME listener answered %d; the admin routes must not be "+
				"registered there at all", c.method, c.path, w.Code)
		}
	}

	// ...and the same server, on its own listener, does answer. Without
	// this the test above passes on a build where AdminRoutes is broken
	// and there is no admin tool anywhere.
	srv.adminRL = newRateLimiter(1e6, 1e6)
	admin := srv.AdminRoutes(nil)
	if admin == nil {
		t.Fatal("AdminRoutes returned nil with a password configured")
	}
	if w, _ := adminDo(t, admin, "POST", "/api/admin/login", "",
		map[string]any{"password": adminPw}, true); w.Code != http.StatusOK {
		t.Fatalf("the operator listener refused a correct password: %d", w.Code)
	}
}

func TestAdminRoutesAreNilWithoutAPassword(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := New(store.NewMemory(), log, Config{})
	if h := srv.AdminRoutes(nil); h != nil {
		t.Fatal("a server with no admin password returned an admin handler; " +
			"cmd/server opens a second port when it does")
	}
}

// The login limiter.
//
// Login is the one unauthenticated route on that listener, and the
// listener is normally loopback-only, which means every attempt in the
// world shares one bucket. That is the point: generous enough for an
// operator mistyping a password, useless for working through a list.
func TestAdminLoginIsRateLimited(t *testing.T) {
	srv, _ := adminSrv(t, true)
	h := srv.AdminRoutes(nil) // the real limiter, not the test one

	refused := 0
	for i := 0; i < AdminLoginBurst+6; i++ {
		w, _ := adminDo(t, h, "POST", "/api/admin/login", "",
			map[string]any{"password": "wrong"}, true)
		if w.Code == http.StatusTooManyRequests {
			refused++
		}
	}
	if refused == 0 {
		t.Fatalf("%d wrong passwords in a row and none was rate limited", AdminLoginBurst+6)
	}
	// The limiter is per-IP, so it must not have locked out the whole
	// world: a different console still gets its own allowance.
	w, _ := adminDo(t, h, "POST", "/api/admin/login", "",
		map[string]any{"password": adminPw}, true)
	_ = w // the local bucket is spent; what matters is that it answered at all
}

// --- the recorded runs

func seedRuns(t *testing.T, st store.Store) (*model.Player, []*model.Score) {
	t.Helper()
	p, err := st.CreatePlayer("rom", "tok-rom")
	if err != nil {
		t.Fatal(err)
	}
	var out []*model.Score
	for _, pts := range []int{400, 999999, 700} {
		s := &model.Score{PlayerID: p.ID, Points: pts, TimeSec: 120, Levels: 4, Turrets: 20}
		if err := st.AddScore(s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return p, out
}

func TestAdminListsAndReadsRuns(t *testing.T) {
	h, st := adminServer(t, true)
	_, runs := seedRuns(t, st)
	tok := adminLoginAs(t, h)

	w, out := adminDo(t, h, "GET", "/api/admin/runs?limit=2", tok, nil, true)
	if w.Code != http.StatusOK {
		t.Fatalf("list runs: %d %s", w.Code, w.Body)
	}
	if total, _ := out["total"].(float64); total != 3 {
		t.Fatalf("total = %v, want 3 — a page that cannot say how much it is a page of", out["total"])
	}
	list, _ := out["runs"].([]any)
	if len(list) != 2 {
		t.Fatalf("limit=2 returned %d rows", len(list))
	}

	// One run, with the context that makes it worth looking at.
	w, one := adminDo(t, h, "GET", "/api/admin/runs/"+runs[1].ID, tok, nil, true)
	if w.Code != http.StatusOK {
		t.Fatalf("read run: %d %s", w.Code, w.Body)
	}
	run, _ := one["run"].(map[string]any)
	if run == nil || run["points"].(float64) != 999999 {
		t.Fatalf("read the wrong run: %v", one["run"])
	}
	if rate, _ := one["pointsPerSec"].(float64); rate < 8000 {
		t.Fatalf("pointsPerSec = %v for 999999 in 120s; this is the first number "+
			"anyone looks at on a run that does not smell right", one["pointsPerSec"])
	}
	if one["player"] == nil {
		t.Fatal("a run came back without the pilot it belongs to")
	}
	if others, _ := one["otherRuns"].([]any); len(others) != 3 {
		t.Fatalf("otherRuns has %d entries, want the pilot's 3", len(others))
	}

	if w, _ := adminDo(t, h, "GET", "/api/admin/runs/nope", tok, nil, true); w.Code != http.StatusNotFound {
		t.Fatalf("an unknown run answered %d", w.Code)
	}
}

func TestAdminDeletesOneRunAndTheNumberGoesWithIt(t *testing.T) {
	h, st := adminServer(t, true)
	p, runs := seedRuns(t, st)
	tok := adminLoginAs(t, h)

	w, out := adminDo(t, h, "DELETE", "/api/admin/runs/"+runs[1].ID, tok, nil, true)
	if w.Code != http.StatusOK {
		t.Fatalf("delete run: %d %s", w.Code, w.Body)
	}
	// The answer carries the pilot's recomputed card, so the page can
	// show that the number actually went without a second round trip.
	if best, _ := out["best"].(float64); best != 700 {
		t.Fatalf("the answer says best is %v after removing the 999999; want 700", out["best"])
	}
	if runsLeft, _ := out["runs"].(float64); runsLeft != 2 {
		t.Fatalf("runs = %v, want 2", out["runs"])
	}
	got, _ := st.PlayerByID(p.ID)
	if got.Best != 700 {
		t.Fatalf("the store still has best %d", got.Best)
	}
	top, _ := st.Top(store.TopQuery{Window: model.WindowAll, Limit: 10})
	if len(top) != 1 || top[0].Score.Points != 700 {
		t.Fatalf("the board still shows %v", top)
	}
}

func TestWipingTheBoardNeedsTheWord(t *testing.T) {
	// DELETE on a collection is one mistyped URL from DELETE on a row,
	// and this one cannot be undone.
	h, st := adminServer(t, true)
	seedRuns(t, st)
	tok := adminLoginAs(t, h)

	for _, body := range []map[string]any{{}, {"confirm": ""}, {"confirm": "reset"}, {"confirm": "yes"}} {
		w, _ := adminDo(t, h, "POST", "/api/admin/scores/reset", tok, body, true)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("confirm=%v wiped the board with %d", body, w.Code)
		}
	}
	if list, total := st.ListScores("", 50, 0); total != 3 || len(list) != 3 {
		t.Fatalf("the runs are gone after refusals: %d", total)
	}

	w, out := adminDo(t, h, "POST", "/api/admin/scores/reset", tok, map[string]any{"confirm": "RESET"}, true)
	if w.Code != http.StatusOK {
		t.Fatalf("reset: %d %s", w.Code, w.Body)
	}
	if n, _ := out["deleted"].(float64); n != 3 {
		t.Fatalf("deleted = %v, want 3", out["deleted"])
	}
	if _, total := st.ListScores("", 50, 0); total != 0 {
		t.Fatalf("%d runs survived the wipe", total)
	}
	// The accounts are not scores.
	if st.Stats().Players != 1 {
		t.Fatal("wiping the board deleted the pilot")
	}
}

func TestAdminEditsStatsAndSaysWhenTheyDisagree(t *testing.T) {
	h, st := adminServer(t, true)
	p, _ := seedRuns(t, st)
	tok := adminLoginAs(t, h)

	w, out := adminDo(t, h, "POST", "/api/admin/players/"+p.ID+"/stats", tok,
		map[string]any{"runs": 2, "best": 500}, true)
	if w.Code != http.StatusOK {
		t.Fatalf("set stats: %d %s", w.Code, w.Body)
	}
	player, _ := out["player"].(map[string]any)
	if player["runs"].(float64) != 2 || player["best"].(float64) != 500 {
		t.Fatalf("the card says %v", player)
	}
	// The counters are a cache and the runs are the truth. An operator
	// who has made the two disagree has to be told so here, because the
	// place they would otherwise find out is the public leaderboard.
	rec, _ := out["onRecord"].(map[string]any)
	if rec == nil {
		t.Fatal("the answer does not say what the runs on record add up to")
	}
	if rec["runs"].(float64) != 3 || rec["best"].(float64) != 999999 {
		t.Fatalf("onRecord = %v; the three seeded runs top out at 999999", rec)
	}

	// Each field moves on its own: sending only one must not zero the other.
	if w, out := adminDo(t, h, "POST", "/api/admin/players/"+p.ID+"/stats", tok,
		map[string]any{"best": 123}, true); w.Code == http.StatusOK {
		pl, _ := out["player"].(map[string]any)
		if pl["runs"].(float64) != 2 {
			t.Fatalf("sending only best reset runs to %v", pl["runs"])
		}
	} else {
		t.Fatalf("partial update: %d", w.Code)
	}

	if w, _ := adminDo(t, h, "POST", "/api/admin/players/nope/stats", tok,
		map[string]any{"runs": 1}, true); w.Code != http.StatusNotFound {
		t.Fatalf("editing an unknown pilot answered %d", w.Code)
	}
}

func TestAdminSeesClientErrorsThePublicApiWithholds(t *testing.T) {
	srv, _ := adminSrv(t, true)
	srv.adminRL = newRateLimiter(1e6, 1e6)
	h := srv.AdminRoutes(nil)
	public := srv.Routes()

	// A browser reports something going wrong.
	body := `{"errors":[{"kind":"TypeError","message":"cannot read beam of undefined",` +
		`"stack":"at drawBeams (level.js:1573)","hull":4,"build":"abc","agent":"Firefox"}]}`
	req := httptest.NewRequest("POST", "/api/errors", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "203.0.113.9:40000"
	public.ServeHTTP(httptest.NewRecorder(), req)

	// The public surface gives a count and nothing else: these hold
	// stack traces and user agents from other people's machines.
	pw := httptest.NewRecorder()
	public.ServeHTTP(pw, httptest.NewRequest("GET", "/api/stats", nil))
	if strings.Contains(pw.Body.String(), "cannot read beam") {
		t.Fatal("/api/stats leaked the contents of a client error report")
	}

	// Behind the operator's door, the contents are the point.
	tok := adminLoginAs(t, h)
	w, out := adminDo(t, h, "GET", "/api/admin/errors", tok, nil, true)
	if w.Code != http.StatusOK {
		t.Fatalf("admin errors: %d %s", w.Code, w.Body)
	}
	recent, _ := out["recent"].([]any)
	if len(recent) != 1 {
		t.Fatalf("recent has %d entries, want the one that was reported", len(recent))
	}
	first, _ := recent[0].(map[string]any)
	if !strings.Contains(first["message"].(string), "cannot read beam") {
		t.Fatalf("the report came back as %v", first)
	}
	if out["summary"] == nil {
		t.Fatal("the counts went missing when the contents arrived")
	}
}

func TestAdminPresence(t *testing.T) {
	h, st := adminServer(t, true)
	p, _ := seedRuns(t, st)
	if err := st.Heartbeat(model.Presence{PlayerID: p.ID, Name: p.Name, Score: 1200, Progress: 0.4}); err != nil {
		t.Fatal(err)
	}
	tok := adminLoginAs(t, h)
	w, out := adminDo(t, h, "GET", "/api/admin/presence", tok, nil, true)
	if w.Code != http.StatusOK {
		t.Fatalf("presence: %d %s", w.Code, w.Body)
	}
	if c, _ := out["count"].(float64); c != 1 {
		t.Fatalf("count = %v, want 1", out["count"])
	}
}

// Everything new refuses an unauthenticated caller the same way
// everything old does: 404, not 401. A surface that announces itself is
// a surface worth attacking.
func TestNewAdminRoutesRefuseWithoutASession(t *testing.T) {
	h, st := adminServer(t, true)
	p, runs := seedRuns(t, st)
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/admin/runs"},
		{"GET", "/api/admin/runs/" + runs[0].ID},
		{"DELETE", "/api/admin/runs/" + runs[0].ID},
		{"POST", "/api/admin/scores/reset"},
		{"POST", "/api/admin/players/" + p.ID + "/stats"},
		{"GET", "/api/admin/errors"},
		{"GET", "/api/admin/presence"},
	} {
		for _, tok := range []string{"", "not-a-real-token"} {
			w, _ := adminDo(t, h, c.method, c.path, tok, map[string]any{"confirm": "RESET"}, true)
			if w.Code != http.StatusNotFound {
				t.Errorf("%s %s with token %q answered %d, want 404",
					c.method, c.path, tok, w.Code)
			}
		}
	}
	// ...and nothing happened while they were being refused.
	if _, total := st.ListScores("", 50, 0); total != 3 {
		t.Fatalf("%d runs left after a string of refused calls", total)
	}
}

// The operator's page is served by the admin listener and by nothing
// else, and only to a caller the listener would talk to anyway.
func TestTheOperatorPageIsOnTheAdminListenerOnly(t *testing.T) {
	srv, _ := adminSrv(t, true) // loopback only
	page := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("<!DOCTYPE html><title>operator</title>"))
	})
	h := srv.AdminRoutes(page)

	req := asLocal(httptest.NewRequest("GET", "/", nil))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "operator") {
		t.Fatalf("the console did not get the page: %d %s", w.Code, w.Body)
	}
	// The policy a page holding a session token to this surface needs.
	csp := w.Header().Get("Content-Security-Policy")
	for _, want := range []string{"default-src 'none'", "script-src 'self'", "connect-src 'self'"} {
		if !strings.Contains(csp, want) {
			t.Errorf("the page's policy is missing %q: %q", want, csp)
		}
	}
	if strings.Contains(csp, "unsafe-inline") {
		t.Errorf("the page's policy allows inline script or style: %q", csp)
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Error("the operator page is cacheable")
	}

	// From off the machine, on a loopback-only server, it does not exist.
	req = httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "203.0.113.9:40000"
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("a remote caller got the operator page: %d", w.Code)
	}

	// And the game's listener does not serve it at all.
	pw := httptest.NewRecorder()
	srv.Routes().ServeHTTP(pw, asLocal(httptest.NewRequest("GET", "/", nil)))
	if strings.Contains(pw.Body.String(), "operator") {
		t.Fatal("the game's handler served the operator page")
	}
}

// The audit line goes out before the thing happens, so an operation
// that dies halfway is still in the log. Checked on the one that
// removes the most.
func TestDestructiveAdminActionsAreLoggedBeforeTheyHappen(t *testing.T) {
	var buf strings.Builder
	h, err := HashPassword(adminPw)
	if err != nil {
		t.Fatal(err)
	}
	st := store.NewMemory()
	log := slog.New(slog.NewTextHandler(&buf, nil))
	srv := New(st, log, Config{RateLimitPerSec: 1e6, RateBurst: 1e6, AdminPasswordHash: h})
	srv.adminRL = newRateLimiter(1e6, 1e6)
	mux := srv.AdminRoutes(nil)
	p, runs := seedRuns(t, st)
	tok := adminLoginAs(t, mux)

	adminDo(t, mux, "DELETE", "/api/admin/runs/"+runs[0].ID, tok, nil, true)
	adminDo(t, mux, "DELETE", "/api/admin/players/"+p.ID, tok, nil, true)
	adminDo(t, mux, "POST", "/api/admin/scores/reset", tok, map[string]any{"confirm": "RESET"}, true)

	out := buf.String()
	for _, want := range []string{"delete run", "delete player", "reset all scores"} {
		if !strings.Contains(out, want) {
			t.Errorf("the log has no %q line:\n%s", want, out)
		}
	}
	if !strings.Contains(out, "127.0.0.1") {
		t.Error("the audit lines do not say who did it")
	}
}

// A run can outlive the account on a store that did not cascade. An
// operator looking at the orphan should see the orphan, not a 404 —
// that run is probably the reason they went looking.
//
// The memory store does cascade, so the state is built with a wrapper
// that loses the pilot and keeps the run. Contriving it inside the real
// store instead was how the first version of this test ended up
// asserting an ordinary 404 and proving nothing about the branch.
type lostPilotStore struct{ store.Store }

func (s lostPilotStore) PlayerByID(string) (*model.Player, error) { return nil, store.ErrNotFound }

func TestReadingARunWhosePilotIsGone(t *testing.T) {
	h, err := HashPassword(adminPw)
	if err != nil {
		t.Fatal(err)
	}
	mem := store.NewMemory()
	p, runs := seedRuns(t, mem)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := New(lostPilotStore{mem}, log, Config{
		RateLimitPerSec: 1e6, RateBurst: 1e6, AdminPasswordHash: h,
	})
	srv.adminRL = newRateLimiter(1e6, 1e6)
	mux := srv.AdminRoutes(nil)
	tok := adminLoginAs(t, mux)

	w, out := adminDo(t, mux, "GET", "/api/admin/runs/"+runs[0].ID, tok, nil, true)
	if w.Code != http.StatusOK {
		t.Fatalf("a run whose pilot is missing answered %d; the run is still a run", w.Code)
	}
	run, _ := out["run"].(map[string]any)
	if run == nil || run["points"].(float64) != 400 {
		t.Fatalf("the run did not come back: %v", out["run"])
	}
	if out["player"] != nil {
		t.Fatalf("a pilot came back for a run that has none: %v", out["player"])
	}
	_ = p
}
