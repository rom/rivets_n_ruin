package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The bug this is all for: the release tree's own defaults put the
// snapshot inside the directory the static handler serves, so
// GET /data/rnr.json returned the password hashes. Served end to end
// through a real http.FileServer over real files, because the predicate
// agreeing with itself proves nothing about what net/http will open.
func TestSnapshotIsNotServed(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "index.html"), "<!doctype html>")
	write(t, filepath.Join(root, "src", "game.js"), "export const x = 1")
	data := filepath.Join(root, "data", "rnr.json")
	write(t, data, `{"pass":{"abc":"pbkdf2-sha256$240000$salt$hash"}}`)
	write(t, data+".runs", `[{"id":"r1"}]`)
	write(t, data+".tmp", `{"half":"written"}`)

	// Through ResolvePaths, the way the server builds it: passing the
	// file alone would leave the directory listing readable, and the
	// server does not pass the file alone.
	paths, err := ResolvePaths(root, filepath.Dir(data), filepath.Dir(data), "", false)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(hideData(root, paths.Hidden(), http.FileServer(http.Dir(root))))
	defer srv.Close()

	// Everything the snapshot touches, and the spellings that reach it by
	// another route. The traversal cases are what filepath.Clean is for,
	// and they are here because a check written against the raw URL would
	// pass every other case in this test and fail these.
	for _, p := range []string{
		"/data/rnr.json",
		"/data/rnr.json.runs",
		"/data/rnr.json.tmp",
		"/data/",
		"/data",
		"/src/../data/rnr.json",
		"/./data/rnr.json",
		"//data/rnr.json",
		"/data/./rnr.json",
	} {
		if code, body := get(t, srv.URL+p); code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404 — body begins %q", p, code, first(body, 60))
		} else if strings.Contains(body, "pbkdf2") {
			t.Errorf("GET %s returned a 404 that still contained the hash", p)
		}
	}

	// ...and the game still works, which is the other half.
	for _, p := range []string{"/", "/index.html", "/src/game.js"} {
		if code, _ := get(t, srv.URL+p); code != http.StatusOK {
			t.Errorf("GET %s = %d, want 200 — the guard is eating the game", p, code)
		}
	}
}

// With the snapshot kept outside the web root, which is what the warning
// recommends, nothing in the root may be blocked.
func TestDataOutsideRootBlocksNothing(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "web")
	write(t, filepath.Join(root, "index.html"), "<!doctype html>")
	write(t, filepath.Join(root, "data", "levels.json"), `{"not":"the snapshot"}`)
	data := filepath.Join(base, "state", "rnr.json")
	write(t, data, `{"pass":{}}`)

	srv := httptest.NewServer(hideData(root, []string{data}, http.FileServer(http.Dir(root))))
	defer srv.Close()

	// A directory called data/ in the web root is an ordinary directory
	// when the snapshot lives elsewhere, and blocking it would be a
	// regression invisible to anyone using the defaults.
	for _, p := range []string{"/", "/data/levels.json"} {
		if code, _ := get(t, srv.URL+p); code != http.StatusOK {
			t.Errorf("GET %s = %d, want 200", p, code)
		}
	}
}

// The snapshot put directly in the web root: the file still has to go,
// but "the directory holding it" is the whole site and must not.
func TestSnapshotInTheRootItself(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "index.html"), "<!doctype html>")
	data := filepath.Join(root, "rnr.json")
	write(t, data, `{"pass":{"abc":"pbkdf2"}}`)
	write(t, data+".runs", `[{"id":"r1"}]`)
	write(t, data+".tmp", `{"half":"written"}`)

	srv := httptest.NewServer(hideData(root, []string{data}, http.FileServer(http.Dir(root))))
	defer srv.Close()

	// The sidecars matter most here. Everywhere else they happen to sit
	// in a directory that is blocked wholesale, so the prefix match is
	// doing no work and a version without it passes. Here the directory
	// is the web root and cannot be blocked, so the prefix match is the
	// only thing standing between the open-runs table and the internet.
	for _, p := range []string{"/rnr.json", "/rnr.json.runs", "/rnr.json.tmp"} {
		if code, body := get(t, srv.URL+p); code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404 — body begins %q", p, code, first(body, 60))
		}
	}
	if code, _ := get(t, srv.URL+"/"); code != http.StatusOK {
		t.Errorf("GET / = %d, want 200 — hiding the root hid the game", code)
	}
}

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func get(t *testing.T, url string) (int, string) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b := make([]byte, 4096)
	n, _ := resp.Body.Read(b)
	return resp.StatusCode, string(b[:n])
}

func first(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// --- the layouts that put a writable root at the web root
//
// Three configurations collapse State onto Content. In each, the guard
// used to record the directory, skip the files as "already covered",
// and then drop the directory because hiding the web root would hide
// the game — so nothing was hidden at all. Driven end to end through a
// real file server, because the predicate agreeing with itself is what
// let this through the first time.

func servingLayout(t *testing.T, root string, state, accounts, legacy string) *httptest.Server {
	t.Helper()
	p, err := ResolvePaths(root, state, accounts, legacy, false)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("exposed: %v", p.Exposed)
	srv := httptest.NewServer(hideData(root, p.Hidden(), http.FileServer(http.Dir(root))))
	t.Cleanup(srv.Close)
	return srv
}

func TestLegacyDataInTheWebRootIsNotServed(t *testing.T) {
	// The exact pre-split invocation: `rnr-server -data ./rnr.json`
	// with -dir defaulting to ".". This served the password hashes.
	root := t.TempDir()
	write(t, filepath.Join(root, "index.html"), "<!doctype html>")
	legacy := filepath.Join(root, "rnr.json")
	write(t, legacy, `{"pass":{"a":"pbkdf2-sha256$240000$salt$hash"}}`)
	write(t, legacy+".runs", `[{"id":"r1"}]`)

	srv := servingLayout(t, root, "", "", legacy)
	for _, u := range []string{"/rnr.json", "/rnr.json.runs"} {
		code, body := get(t, srv.URL+u)
		if code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404 — body %q", u, code, first(body, 60))
		}
		if strings.Contains(body, "pbkdf2") {
			t.Errorf("GET %s returned the password hashes", u)
		}
	}
	if code, _ := get(t, srv.URL+"/"); code != http.StatusOK {
		t.Errorf("the game stopped being served: %d", code)
	}
}

func TestStateAtTheWebRootIsNotServed(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "index.html"), "<!doctype html>")
	write(t, filepath.Join(root, "scores.json"), `{"scores":[]}`)
	write(t, filepath.Join(root, "runs.json"), `[]`)

	srv := servingLayout(t, root, root, filepath.Join(root, "accounts"), "")
	for _, u := range []string{"/scores.json", "/runs.json"} {
		if code, _ := get(t, srv.URL+u); code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", u, code)
		}
	}
	if code, _ := get(t, srv.URL+"/"); code != http.StatusOK {
		t.Errorf("hiding the state files hid the game: %d", code)
	}
}

func TestANameSharingAPrefixIsStillServed(t *testing.T) {
	// `statements.html` begins with `state`. A bare prefix test answers
	// 404 for it, which is a legitimate page vanishing with no way to
	// work out why.
	root := t.TempDir()
	write(t, filepath.Join(root, "index.html"), "<!doctype html>")
	for _, n := range []string{"statements.html", "stateless.js", "accounting.css", "scoreboard.png"} {
		write(t, filepath.Join(root, n), "legitimate")
	}
	write(t, filepath.Join(root, "state", "scores.json"), "{}")

	srv := servingLayout(t, root, filepath.Join(root, "state"), filepath.Join(root, "accounts"), "")
	for _, n := range []string{"statements.html", "stateless.js", "accounting.css", "scoreboard.png"} {
		if code, _ := get(t, srv.URL+"/"+n); code != http.StatusOK {
			t.Errorf("GET /%s = %d, want 200 — hidden for sharing a name prefix", n, code)
		}
	}
	// ...and the sidecars that the prefix rule is actually for.
	write(t, filepath.Join(root, "state", "scores.json.tmp"), "{}")
	for _, u := range []string{"/state/scores.json", "/state/scores.json.tmp"} {
		if code, _ := get(t, srv.URL+u); code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", u, code)
		}
	}
}
