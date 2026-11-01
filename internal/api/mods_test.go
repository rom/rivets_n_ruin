package api

import (
	"net/http"
	"strings"
	"testing"
)

// Publishing a mod takes a name, free-text notes and a blob of config
// that the client merges over its own. All three are attacker-controlled
// and all three reach other players' browsers, which makes this the
// widest input surface the server has — and it had almost no tests.

func publish(t *testing.T, h http.Handler, token string, body map[string]any) (int, map[string]any) {
	t.Helper()
	rec, out := do(t, h, "POST", "/api/mods", token, body)
	return rec.Code, out
}

func TestPublishAndFetchAMod(t *testing.T) {
	h := newTestServer(t)
	_, token := register(t, h, "MODDER")

	code, body := publish(t, h, token, map[string]any{
		"name": "SCRAPYARD", "seed": 1234,
		"notes":  "a hull of junk",
		"config": map[string]any{"LEVELS": []any{}},
	})
	if code != http.StatusCreated {
		t.Fatalf("publish: %d %v", code, body)
	}
	id, _ := body["id"].(string)
	if id == "" {
		if m, ok := body["mod"].(map[string]any); ok {
			id, _ = m["id"].(string)
		}
	}
	if id == "" {
		t.Fatalf("no id in %v", body)
	}

	rec, got := do(t, h, "GET", "/api/mods/"+id, "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("fetch: %d %v", rec.Code, got)
	}

	rec, list := do(t, h, "GET", "/api/mods", "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d", rec.Code)
	}
	if mods, _ := list["mods"].([]any); len(mods) != 1 {
		t.Errorf("listed %d mods, want 1", len(mods))
	}
	for _, sort := range []string{"plays", "name", "new", "nonsense"} {
		rec, _ := do(t, h, "GET", "/api/mods?sort="+sort+"&limit=5", "", nil)
		if rec.Code != http.StatusOK {
			t.Errorf("sort=%s gave %d", sort, rec.Code)
		}
	}
}

func TestPublishingNeedsAPilot(t *testing.T) {
	h := newTestServer(t)
	code, _ := publish(t, h, "", map[string]any{"name": "ANON", "seed": 1})
	if code != http.StatusUnauthorized {
		t.Errorf("an unauthenticated publish gave %d, want 401", code)
	}
}

// The config is merged over the client's own, so anything that is not an
// object breaks the game *later*, in the browser of whoever plays it.
func TestAModConfigMustBeAnObject(t *testing.T) {
	h := newTestServer(t)
	_, token := register(t, h, "MODDER")
	for _, cfg := range []any{[]any{1, 2}, "a string", 42, true} {
		code, body := publish(t, h, token, map[string]any{
			"name": "BADCFG", "seed": 1, "config": cfg,
		})
		if code != http.StatusBadRequest {
			t.Errorf("config %v was accepted: %d %v", cfg, code, body)
		}
	}
	// ...and an absent config is fine; it means "change nothing".
	code, _ := publish(t, h, token, map[string]any{"name": "NOCFG", "seed": 1})
	if code != http.StatusCreated {
		t.Errorf("a mod with no config gave %d", code)
	}
}

func TestModInputIsBounded(t *testing.T) {
	h := newTestServer(t)
	_, token := register(t, h, "MODDER")

	code, _ := publish(t, h, token, map[string]any{
		"name": "NOTES", "seed": 1, "notes": strings.Repeat("x", 5000),
	})
	if code != http.StatusBadRequest {
		t.Errorf("5000 characters of notes gave %d, want 400", code)
	}

	code, _ = publish(t, h, token, map[string]any{"name": "x", "seed": 1})
	if code != http.StatusBadRequest {
		t.Errorf("a one-character mod name gave %d, want 400", code)
	}

	rec, _ := doRaw(t, h, "POST", "/api/mods", token, "{{{ not json")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("a malformed body gave %d, want 400", rec.Code)
	}
}

func TestFetchingAModThatDoesNotExist(t *testing.T) {
	h := newTestServer(t)
	for _, path := range []string{"/api/mods/nope", "/api/mods/nope/top"} {
		rec, _ := do(t, h, "GET", path, "", nil)
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s gave %d, want 404", path, rec.Code)
		}
	}
}
