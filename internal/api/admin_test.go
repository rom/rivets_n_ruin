package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rom/rivets_n_ruin/internal/model"
	"github.com/rom/rivets_n_ruin/internal/store"
)

const adminPw = "correct horse battery staple"

func adminServer(t *testing.T, localOnly bool) (http.Handler, store.Store) {
	t.Helper()
	h, err := HashPassword(adminPw)
	if err != nil {
		t.Fatal(err)
	}
	st := store.NewMemory()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(st, log, Config{
		RateLimitPerSec: 1e6, RateBurst: 1e6,
		AdminPasswordHash: h, AdminLocalOnly: localOnly,
	}).Routes(), st
}

// httptest.NewRequest uses 192.0.2.1, which is not loopback. Most of
// these tests want to be the operator at the console.
func asLocal(r *http.Request) *http.Request { r.RemoteAddr = "127.0.0.1:54321"; return r }

func adminDo(t *testing.T, h http.Handler, method, path, token string, body any, local bool) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rd = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if local {
		asLocal(req)
	} else {
		req.RemoteAddr = "203.0.113.9:40000"
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	out := map[string]any{}
	if w.Body.Len() > 0 {
		_ = json.Unmarshal(w.Body.Bytes(), &out)
	}
	return w, out
}

func adminLoginAs(t *testing.T, h http.Handler) string {
	t.Helper()
	w, out := adminDo(t, h, "POST", "/api/admin/login", "", map[string]any{"password": adminPw}, true)
	if w.Code != http.StatusOK {
		t.Fatalf("admin login: %d %s", w.Code, w.Body)
	}
	return out["token"].(string)
}

// The most important property: no password configured, no surface.
func TestAdminRoutesAbsentWithoutAPassword(t *testing.T) {
	srv := newTestServer(t) // no AdminPasswordHash
	for _, p := range []string{
		"/api/admin/login", "/api/admin/players", "/api/admin/stats",
	} {
		req := asLocal(httptest.NewRequest("POST", p, strings.NewReader(`{"password":"x"}`)))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		srv.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound && w.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s answered %d on a server with no admin password; want it to not exist", p, w.Code)
		}
	}
}

func TestAdminIsLoopbackOnlyByDefault(t *testing.T) {
	srv, _ := adminServer(t, true)

	// Even with the right password, from off-machine: nothing.
	w, _ := adminDo(t, srv, "POST", "/api/admin/login", "", map[string]any{"password": adminPw}, false)
	if w.Code != http.StatusNotFound {
		t.Errorf("remote login answered %d, want 404", w.Code)
	}

	// A token minted locally is no good from elsewhere either, so a
	// leaked token does not travel.
	tok := adminLoginAs(t, srv)
	w, _ = adminDo(t, srv, "GET", "/api/admin/players", tok, nil, false)
	if w.Code != http.StatusNotFound {
		t.Errorf("remote request with a valid token answered %d, want 404", w.Code)
	}
}

func TestAdminAnywhereOptsOut(t *testing.T) {
	srv, _ := adminServer(t, false)
	w, out := adminDo(t, srv, "POST", "/api/admin/login", "", map[string]any{"password": adminPw}, false)
	if w.Code != http.StatusOK {
		t.Fatalf("login from off-machine with -admin-anywhere: %d %s", w.Code, w.Body)
	}
	tok := out["token"].(string)
	w, _ = adminDo(t, srv, "GET", "/api/admin/players", tok, nil, false)
	if w.Code != http.StatusOK {
		t.Errorf("listing answered %d", w.Code)
	}
}

func TestAdminRejectsWrongPasswordAndBareRequests(t *testing.T) {
	srv, _ := adminServer(t, true)
	w, _ := adminDo(t, srv, "POST", "/api/admin/login", "", map[string]any{"password": "wrong"}, true)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("wrong password answered %d, want 401", w.Code)
	}
	for _, p := range []string{"/api/admin/players", "/api/admin/stats"} {
		w, _ := adminDo(t, srv, "GET", p, "", nil, true)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s without a token answered %d, want 404", p, w.Code)
		}
		w, _ = adminDo(t, srv, "GET", p, "made-up-token", nil, true)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s with a bogus token answered %d, want 404", p, w.Code)
		}
	}
}

func TestAdminLifecycleOnAPilot(t *testing.T) {
	srv, st := adminServer(t, true)
	tok := adminLoginAs(t, srv)

	// create
	w, out := adminDo(t, srv, "POST", "/api/admin/players", tok,
		map[string]any{"name": "MADEBYADMIN", "password": "hunter2hunter2"}, true)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	id := out["id"].(string)

	// read, with statistics
	w, out = adminDo(t, srv, "GET", "/api/admin/players/"+id, tok, nil, true)
	if w.Code != http.StatusOK {
		t.Fatalf("read: %d %s", w.Code, w.Body)
	}
	stats := out["stats"].(map[string]any)
	if stats["hasPassword"] != true {
		t.Error("a pilot created with a password does not have one")
	}
	if _, ok := out["hangar"]; !ok {
		t.Error("no hangar in the admin view")
	}

	// list, and find them in it
	w, out = adminDo(t, srv, "GET", "/api/admin/players?q=MADEBY", tok, nil, true)
	if w.Code != http.StatusOK || out["count"].(float64) != 1 {
		t.Fatalf("list: %d %s", w.Code, w.Body)
	}

	// change the password — and the pilot's token must die with it,
	// or resetting a compromised account changes nothing for whoever
	// was already inside it.
	before, _ := st.PlayerByID(id)
	oldTokenHash := before.TokenHash
	w, _ = adminDo(t, srv, "POST", "/api/admin/players/"+id+"/password", tok,
		map[string]any{"password": "a-whole-new-password"}, true)
	if w.Code != http.StatusOK {
		t.Fatalf("set password: %d %s", w.Code, w.Body)
	}
	after, _ := st.PlayerByID(id)
	if after.TokenHash == oldTokenHash {
		t.Error("changing the password left the old session token working")
	}

	// reset: history gone, account still there
	st.SetHangar(id, &model.Hangar{Coins: 500})
	w, _ = adminDo(t, srv, "POST", "/api/admin/players/"+id+"/reset", tok, nil, true)
	if w.Code != http.StatusOK {
		t.Fatalf("reset: %d %s", w.Code, w.Body)
	}
	if h := st.Hangar(id); h.Coins != 0 {
		t.Errorf("reset left %d coins", h.Coins)
	}
	if _, err := st.PlayerByID(id); err != nil {
		t.Error("reset deleted the account; it should only clear it")
	}

	// delete
	w, _ = adminDo(t, srv, "DELETE", "/api/admin/players/"+id, tok, nil, true)
	if w.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", w.Code, w.Body)
	}
	if _, err := st.PlayerByID(id); err == nil {
		t.Error("the pilot is still there after a delete")
	}
}

func TestAdminSessionsExpire(t *testing.T) {
	// A surface that deletes accounts should not hold a session open
	// forever because somebody left a terminal logged in. Driven by an
	// injected clock: a TTL that can only be tested by waiting thirty
	// minutes is a TTL nobody tests.
	h, err := HashPassword(adminPw)
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	api := New(store.NewMemory(), log, Config{
		RateLimitPerSec: 1e6, RateBurst: 1e6,
		AdminPasswordHash: h, AdminLocalOnly: true,
	})
	at := time.Now()
	api.SetClock(func() time.Time { return at })
	srv := api.Routes()

	tok := adminLoginAs(t, srv)
	if w, _ := adminDo(t, srv, "GET", "/api/admin/players", tok, nil, true); w.Code != http.StatusOK {
		t.Fatalf("a fresh session does not work: %d", w.Code)
	}

	at = at.Add(adminSessionTTL - time.Minute)
	if w, _ := adminDo(t, srv, "GET", "/api/admin/players", tok, nil, true); w.Code != http.StatusOK {
		t.Errorf("the session died a minute early: %d", w.Code)
	}

	at = at.Add(2 * time.Minute) // now past the TTL
	if w, _ := adminDo(t, srv, "GET", "/api/admin/players", tok, nil, true); w.Code != http.StatusNotFound {
		t.Errorf("an expired session still works: %d", w.Code)
	}
}

func TestLogoutEndsTheSession(t *testing.T) {
	srv, _ := adminServer(t, true)
	tok := adminLoginAs(t, srv)
	if w, _ := adminDo(t, srv, "POST", "/api/admin/logout", tok, nil, true); w.Code != http.StatusNoContent {
		t.Fatalf("logout: %d", w.Code)
	}
	if w, _ := adminDo(t, srv, "GET", "/api/admin/players", tok, nil, true); w.Code != http.StatusNotFound {
		t.Errorf("the token still works after logout: %d", w.Code)
	}
}

// --- the name check

func TestNameCheckAnswersOneBit(t *testing.T) {
	srv := newTestServer(t)
	register(t, srv, "TAKENNAME")

	for name, want := range map[string]bool{"TAKENNAME": false, "FREENAME": true} {
		w, out := do(t, srv, "POST", "/api/auth/available", "", map[string]any{"name": name})
		if w.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", name, w.Code, w.Body)
		}
		if out["available"] != want {
			t.Errorf("%s: available=%v, want %v", name, out["available"], want)
		}
		// One bit and nothing beside it. An id, a creation date or a
		// hasPassword flag here is what an enumeration is *for*.
		if len(out) != 1 {
			t.Errorf("%s: the answer carries more than availability: %v", name, out)
		}
	}
}

func TestNameCheckHasItsOwnTightLimit(t *testing.T) {
	// The general API limit is thousands per second in these tests. The
	// name check must not inherit it: a shared bucket is how an
	// endpoint designed to be slow ends up as fast as everything else.
	srv := newTestServer(t)
	allowed := 0
	for i := 0; i < NameCheckBurst*5; i++ {
		w, _ := do(t, srv, "POST", "/api/auth/available", "",
			map[string]any{"name": fmt.Sprintf("PILOT%04d", i)})
		if w.Code == http.StatusOK {
			allowed++
		}
	}
	if allowed > NameCheckBurst+2 {
		t.Errorf("%d checks got through a burst of %d; the limiter is shared with the rest of the API",
			allowed, NameCheckBurst)
	}
	if allowed == 0 {
		t.Error("the limiter refused everything, including the first")
	}
}

func TestNameCheckRejectsJunkBeforeLookingAnythingUp(t *testing.T) {
	srv := newTestServer(t)
	for _, bad := range []string{"", " ", strings.Repeat("x", 500), "has spaces and symbols !!"} {
		w, _ := do(t, srv, "POST", "/api/auth/available", "", map[string]any{"name": bad})
		if w.Code == http.StatusOK {
			t.Errorf("%q was answered rather than rejected", bad)
		}
	}
}

// There is no route that lists pilots without the admin credential.
// This is the invariant the name check exists inside: one bit at a
// time is only meaningful if there is no bulk route beside it.
func TestNoPublicRouteListsPlayers(t *testing.T) {
	srv := newTestServer(t)
	register(t, srv, "FINDME")
	for _, p := range []string{
		"/api/players", "/api/players?limit=100", "/api/admin/players",
		"/api/me/players", "/api/scores/players",
	} {
		w, _ := do(t, srv, "GET", p, "", nil)
		if w.Code == http.StatusOK && strings.Contains(w.Body.String(), "FINDME") {
			t.Errorf("%s listed a pilot without the admin credential: %s", p, w.Body)
		}
	}
}

func TestAdminStats(t *testing.T) {
	srv, _ := adminServer(t, true)
	tok := adminLoginAs(t, srv)
	w, out := adminDo(t, srv, "GET", "/api/admin/stats", tok, nil, true)
	if w.Code != http.StatusOK {
		t.Fatalf("stats: %d %s", w.Code, w.Body)
	}
	if _, ok := out["store"]; !ok {
		t.Error("no store counters")
	}
	// The point of reporting this: a hardening layer whose state nobody
	// can see gets quietly broken and stays broken.
	if _, ok := out["hardening"]; !ok {
		t.Error("the admin view does not say what the OS granted")
	}
	if out["adminSessions"].(float64) < 1 {
		t.Error("the session making this request is not counted")
	}
}

func TestAdminRefusesBadInput(t *testing.T) {
	srv, _ := adminServer(t, true)
	tok := adminLoginAs(t, srv)

	// A missing pilot, on every route that names one.
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{"GET", "/api/admin/players/nope", nil},
		{"DELETE", "/api/admin/players/nope", nil},
		{"POST", "/api/admin/players/nope/reset", nil},
		{"POST", "/api/admin/players/nope/password", map[string]any{"password": "hunter2hunter2"}},
	} {
		w, _ := adminDo(t, srv, c.method, c.path, tok, c.body, true)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s %s on a missing pilot answered %d, want 404", c.method, c.path, w.Code)
		}
	}

	// An admin is not exempt from the rules that keep the store sane.
	for _, bad := range []any{
		map[string]any{"name": ""},
		map[string]any{"name": strings.Repeat("x", 300)},
		map[string]any{"name": "FINE", "password": "short"},
	} {
		w, _ := adminDo(t, srv, "POST", "/api/admin/players", tok, bad, true)
		if w.Code != http.StatusBadRequest {
			t.Errorf("create with %v answered %d, want 400", bad, w.Code)
		}
	}

	// ...including when setting a password.
	w, out := adminDo(t, srv, "POST", "/api/admin/players", tok, map[string]any{"name": "VICTIM"}, true)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	id := out["id"].(string)
	w, _ = adminDo(t, srv, "POST", "/api/admin/players/"+id+"/password", tok,
		map[string]any{"password": "x"}, true)
	if w.Code != http.StatusBadRequest {
		t.Errorf("a too-short password was accepted: %d", w.Code)
	}

	// A pilot created without one has no password, and says so.
	w, out = adminDo(t, srv, "GET", "/api/admin/players/"+id, tok, nil, true)
	if w.Code != http.StatusOK {
		t.Fatalf("read: %d", w.Code)
	}
	if out["stats"].(map[string]any)["hasPassword"] != false {
		t.Error("a pilot created without a password reports having one")
	}

	// And a duplicate name is refused rather than silently taking over
	// the existing account.
	w, _ = adminDo(t, srv, "POST", "/api/admin/players", tok, map[string]any{"name": "VICTIM"}, true)
	if w.Code == http.StatusCreated {
		t.Error("an admin created a second pilot with an existing name")
	}
}

func TestAdminSeesPilotStatistics(t *testing.T) {
	srv, st := adminServer(t, true)
	tok := adminLoginAs(t, srv)
	w, out := adminDo(t, srv, "POST", "/api/admin/players", tok, map[string]any{"name": "SCORER"}, true)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d", w.Code)
	}
	id := out["id"].(string)
	for i, pts := range []int{500, 1500, 900} {
		if err := st.AddScore(&model.Score{
			ID: fmt.Sprintf("s%d", i), PlayerID: id, Name: "SCORER",
			Points: pts, Levels: 2, Completed: i == 1,
		}); err != nil {
			t.Fatal(err)
		}
	}
	w, out = adminDo(t, srv, "GET", "/api/admin/players/"+id, tok, nil, true)
	if w.Code != http.StatusOK {
		t.Fatalf("read: %d %s", w.Code, w.Body)
	}
	stats := out["stats"].(map[string]any)
	if stats["best"].(float64) != 1500 {
		t.Errorf("best = %v, want 1500", stats["best"])
	}
	if stats["totalPoints"].(float64) != 2900 {
		t.Errorf("totalPoints = %v, want 2900", stats["totalPoints"])
	}
	if stats["completedRuns"].(float64) != 1 {
		t.Errorf("completedRuns = %v, want 1", stats["completedRuns"])
	}
	if len(out["recentScores"].([]any)) != 3 {
		t.Errorf("recentScores has %d entries, want 3", len(out["recentScores"].([]any)))
	}
}
