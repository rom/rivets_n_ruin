package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// doRaw sends a body the JSON marshaller would never produce, which is
// the point: a malformed body must come back 400 rather than a panic.
func doRaw(t *testing.T, h http.Handler, method, path, token, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	return doBody(t, h, method, path, "Bearer "+token, io.Reader(bytes.NewReader([]byte(body))))
}

// doHeader sends the Authorization header verbatim, including the shapes
// a client would never send.
func doHeader(t *testing.T, h http.Handler, method, path, header string, body io.Reader) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	return doBody(t, h, method, path, header, body)
}

func doBody(t *testing.T, h http.Handler, method, path, header string, body io.Reader) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, body)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if header != "" {
		req.Header.Set("Authorization", header)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	var out map[string]any
	if w.Body.Len() > 0 {
		_ = json.Unmarshal(w.Body.Bytes(), &out)
	}
	return w, out
}

// Registration and login had no tests at all, which for the part of the
// system that decides who owns a score is the wrong place to have a gap.

func reg(t *testing.T, h http.Handler, token, name, pw string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	return do(t, h, "POST", "/api/auth/register", token, map[string]any{"name": name, "password": pw})
}

func TestRegisterCreatesAPilotWithAPassword(t *testing.T) {
	h := newTestServer(t)
	rec, body := reg(t, h, "", "RUSTJACK", "a decent password")
	if rec.Code != http.StatusCreated {
		t.Fatalf("register: %d %v", rec.Code, body)
	}
	for _, k := range []string{"id", "name", "token"} {
		if body[k] == nil || body[k] == "" {
			t.Errorf("register returned no %s", k)
		}
	}
	if body["name"] != "RUSTJACK" {
		t.Errorf("name came back as %v", body["name"])
	}

	// The token works.
	rec, me := do(t, h, "GET", "/api/me", body["token"].(string), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("the token register handed out does not authenticate: %d %v", rec.Code, me)
	}
}

func TestRegisterRejectsBadNamesAndPasswords(t *testing.T) {
	h := newTestServer(t)
	cases := []struct{ name, pw, why string }{
		{"", "a decent password", "empty name"},
		{"x", "a decent password", "one-character name"},
		{"ok name", "", "no password"},
		{"ok name", "short", "seven characters or fewer"},
		{"ok name", "has\x00a control char", "control characters"},
	}
	for _, c := range cases {
		rec, body := reg(t, h, "", c.name, c.pw)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d %v, want 400", c.why, rec.Code, body)
		}
	}
}

func TestRegisterRejectsMalformedBody(t *testing.T) {
	h := newTestServer(t)
	rec, _ := doRaw(t, h, "POST", "/api/auth/register", "", "{not json")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("malformed body gave %d, want 400", rec.Code)
	}
	rec, _ = doRaw(t, h, "POST", "/api/auth/login", "", "{not json")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("malformed login body gave %d, want 400", rec.Code)
	}
}

func TestANameCannotBeStolen(t *testing.T) {
	h := newTestServer(t)
	_, first := reg(t, h, "", "SLAGHOUND", "the first password")

	// A stranger with no token cannot take it.
	rec, _ := reg(t, h, "", "SLAGHOUND", "some other password")
	if rec.Code != http.StatusConflict {
		t.Errorf("a stranger claiming a taken name got %d, want 409", rec.Code)
	}
	// Nor can the holder set a second password on it.
	rec, _ = reg(t, h, first["token"].(string), "SLAGHOUND", "yet another password")
	if rec.Code != http.StatusConflict {
		t.Errorf("re-registering an already-passworded pilot got %d, want 409", rec.Code)
	}

	// The case the two above between them miss: an anonymous pilot has no
	// password, so the "already has a password" guard does not fire for
	// them, and only the ownership check stands between their name and
	// anyone else's token. Dropping that check still produced two 409s
	// above, for the wrong reason.
	do(t, h, "POST", "/api/players", "", map[string]any{"name": "OPENHOUSE"})
	_, thief := reg(t, h, "", "A THIEF", "the thief's password")
	rec, body := reg(t, h, thief["token"].(string), "OPENHOUSE", "now it is mine")
	if rec.Code != http.StatusConflict {
		t.Errorf("another pilot's token claimed OPENHOUSE: %d %v", rec.Code, body)
	}
	if body["error"] != "that name is taken" {
		t.Errorf("refused for the wrong reason: %q", body["error"])
	}

	// ...and OPENHOUSE still belongs to whoever had it: they can still
	// adopt a password themselves.
	_, reopened := do(t, h, "POST", "/api/auth/login", "", map[string]any{
		"name": "OPENHOUSE", "password": "now it is mine",
	})
	if reopened["token"] != nil {
		t.Error("the thief's password now logs in as OPENHOUSE")
	}
}

// The migration path the comment in auth.go promises: a pilot created
// before passwords existed adopts one without losing their scores.
func TestAnAnonymousPilotCanAdoptAPasswordAndKeepTheirScores(t *testing.T) {
	h := newTestServer(t)
	_, created := do(t, h, "POST", "/api/players", "", map[string]any{"name": "DROSSKITE"})
	oldToken := created["token"].(string)
	oldID := created["id"].(string)

	rec, _ := do(t, h, "POST", "/api/scores", oldToken, map[string]any{
		"points": 120000, "timeSec": 90.0, "turrets": 12, "deaths": 1, "levels": 1,
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("could not post a score as the anonymous pilot: %d", rec.Code)
	}

	// Adopt a password, holding the old token.
	rec, adopted := reg(t, h, oldToken, "DROSSKITE", "a password at last")
	if rec.Code != http.StatusOK {
		t.Fatalf("adopting a password: %d %v", rec.Code, adopted)
	}
	if adopted["id"] != oldID {
		t.Errorf("adopting a password made a new pilot: %v, was %v", adopted["id"], oldID)
	}

	// The score is still theirs, under the same identity.
	_, me := do(t, h, "GET", "/api/me", adopted["token"].(string), nil)
	recent, _ := me["recent"].([]any)
	if len(recent) != 1 {
		t.Fatalf("the pilot came back with %d scores, want 1", len(recent))
	}

	// ...and the old token is retired, so a leaked one stops working.
	rec, _ = do(t, h, "GET", "/api/me", oldToken, nil)
	if rec.Code == http.StatusOK {
		t.Error("the pre-password token still works after adopting a password")
	}
}

func TestLoginRoundTrip(t *testing.T) {
	h := newTestServer(t)
	reg(t, h, "", "BOLTSPUR", "the correct password")

	rec, body := do(t, h, "POST", "/api/auth/login", "", map[string]any{
		"name": "BOLTSPUR", "password": "the correct password",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("login: %d %v", rec.Code, body)
	}
	rec, _ = do(t, h, "GET", "/api/me", body["token"].(string), nil)
	if rec.Code != http.StatusOK {
		t.Error("the token login handed out does not authenticate")
	}
}

// One message and one code for every failure, so the endpoint cannot be
// used to find out which pilot names exist.
func TestLoginDoesNotLeakWhichNamesExist(t *testing.T) {
	h := newTestServer(t)
	reg(t, h, "", "ARCWRENCH", "the correct password")

	_, wrongPw := do(t, h, "POST", "/api/auth/login", "", map[string]any{
		"name": "ARCWRENCH", "password": "not the password",
	})
	recNo, noSuch := do(t, h, "POST", "/api/auth/login", "", map[string]any{
		"name": "NOBODYHERE", "password": "not the password",
	})
	recWrong, _ := do(t, h, "POST", "/api/auth/login", "", map[string]any{
		"name": "ARCWRENCH", "password": "not the password",
	})

	if recWrong.Code != http.StatusUnauthorized || recNo.Code != http.StatusUnauthorized {
		t.Fatalf("codes differ: existing %d, missing %d", recWrong.Code, recNo.Code)
	}
	if wrongPw["error"] != noSuch["error"] {
		t.Errorf("messages differ: %q for an existing pilot, %q for one that does not exist",
			wrongPw["error"], noSuch["error"])
	}
}

func TestLoggingInToAnAnonymousPilotIsRefused(t *testing.T) {
	h := newTestServer(t)
	do(t, h, "POST", "/api/players", "", map[string]any{"name": "FLUXNAIL"})
	rec, _ := do(t, h, "POST", "/api/auth/login", "", map[string]any{
		"name": "FLUXNAIL", "password": "anything at all",
	})
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("logging in to a pilot with no password gave %d, want 401", rec.Code)
	}
}

// Logging in again must not strand the previous session's score history,
// but it must retire the old token.
func TestLoggingInRotatesTheToken(t *testing.T) {
	h := newTestServer(t)
	_, first := reg(t, h, "", "QUENCHRIG", "the correct password")
	_, second := do(t, h, "POST", "/api/auth/login", "", map[string]any{
		"name": "QUENCHRIG", "password": "the correct password",
	})
	if first["token"] == second["token"] {
		t.Error("logging in handed back the same token")
	}
	rec, _ := do(t, h, "GET", "/api/me", first["token"].(string), nil)
	if rec.Code == http.StatusOK {
		t.Error("the previous token still works after logging in again")
	}
	rec, _ = do(t, h, "GET", "/api/me", second["token"].(string), nil)
	if rec.Code != http.StatusOK {
		t.Error("the new token does not work")
	}
}

func TestBearerIgnoresAnythingThatIsNotAToken(t *testing.T) {
	h := newTestServer(t)
	for _, header := range []string{"", "Bearer", "Bearer ", "Basic abc", "abcdef", "Bearer nope"} {
		rec, _ := doHeader(t, h, "GET", "/api/me", header, nil)
		if rec.Code == http.StatusOK {
			t.Errorf("Authorization %q authenticated somebody", header)
		}
	}
}
