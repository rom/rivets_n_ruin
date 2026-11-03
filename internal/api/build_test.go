package api

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rom/rivets_n_ruin/internal/store"
)

func versionServer(t *testing.T, minClient string, at time.Time) (*Server, store.Store) {
	t.Helper()
	st := store.NewMemory()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := New(st, log, Config{
		RateLimitPerSec: 1e6, RateBurst: 1e6,
		Version: "1.1.0", MinClientVersion: minClient, Started: at,
	})
	return srv, st
}

func TestCompareVersions(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want int
	}{
		{"1.0.0", "1.0.0", 0},
		{"1.0.1", "1.0.0", 1},
		{"1.0.0", "1.0.1", -1},
		{"1.10.0", "1.9.0", 1},    // not a string compare
		{"2.0", "10.0", -1},       // nor a lexical one
		{"1.1", "1.1.0", 0},       // a missing part is zero
		{"1.1.0-rc1", "1.1.0", 0}, // a candidate of a release is that release
		{"", "1.0.0", -1},
	} {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestCleanVersionRejectsRubbish(t *testing.T) {
	// It arrives from the network, is shown to an operator and is used
	// as a map key.
	for _, bad := range []string{
		"", "   ", "<script>", "1.0.0; drop", "a b", strings.Repeat("1", 33),
		"1.0\n0", "../../etc", "\x00",
	} {
		if got := cleanVersion(bad); got != "" {
			t.Errorf("cleanVersion(%q) = %q, want it dropped", bad, got)
		}
	}
	for _, ok := range []string{"1.1.0", "2.0.0-rc1", "1.0.0+build7", "dev"} {
		if got := cleanVersion(ok); got != ok {
			t.Errorf("cleanVersion(%q) = %q, want it kept", ok, got)
		}
	}
	if got := cleanVersion("  1.2.3  "); got != "1.2.3" {
		t.Errorf("surrounding space was not trimmed: %q", got)
	}
}

func TestStatsCarriesTheBuildAndUptime(t *testing.T) {
	at := time.Now().Add(-90 * time.Minute)
	srv, _ := versionServer(t, "", at)
	h := srv.Routes()

	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/stats", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("stats: %d", w.Code)
	}
	body := w.Body.String()
	for _, want := range []string{`"version":"1.1.0"`, `"started"`, `"uptimeSec"`} {
		if !strings.Contains(body, want) {
			t.Errorf("/api/stats is missing %s: %s", want, body)
		}
	}
	// Roughly ninety minutes, not zero and not the epoch.
	info := srv.buildInfo()
	if info.UptimeSec < 5300 || info.UptimeSec > 5500 {
		t.Fatalf("uptime came out %ds for a server started 90 minutes ago", info.UptimeSec)
	}
	if info.Started.IsZero() {
		t.Fatal("the boot time is the zero time")
	}
	// No gate configured, so none is advertised.
	if strings.Contains(body, "minClient") {
		t.Errorf("a server with no version gate advertised one: %s", body)
	}
}

func TestUptimeRunsOffTheInjectedClock(t *testing.T) {
	at := time.Now()
	srv, _ := versionServer(t, "", at)
	now := at
	srv.SetClock(func() time.Time { return now })
	if got := srv.buildInfo().UptimeSec; got != 0 {
		t.Fatalf("a server that just started reports %ds of uptime", got)
	}
	now = at.Add(3 * time.Hour)
	if got := srv.buildInfo().UptimeSec; got != 10800 {
		t.Fatalf("after three hours the uptime is %ds", got)
	}
}

func TestTheVersionGate(t *testing.T) {
	srv, st := versionServer(t, "1.1.0", time.Now())
	h := srv.Routes()
	p, err := st.CreatePlayer("rom", "tok-hash")
	if err != nil {
		t.Fatal(err)
	}
	_ = p

	post := func(ver string) int {
		req := httptest.NewRequest("POST", "/api/runs/start", strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		if ver != "" {
			req.Header.Set(ClientVersionHeader, ver)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w.Code
	}

	if got := post("1.0.9"); got != http.StatusUpgradeRequired {
		t.Fatalf("an old client got %d from a write, want 426", got)
	}
	// Current and newer are not refused by the gate. They fail later on
	// authentication, which is a different answer and the point: 426
	// means "your build", 401 means "who are you".
	for _, ver := range []string{"1.1.0", "1.2.0"} {
		if got := post(ver); got == http.StatusUpgradeRequired {
			t.Fatalf("version %s was refused as too old", ver)
		}
	}
	// A client that sends no version is let through. The header is new,
	// and treating its absence as "too old" would lock out every build
	// that predates it — including the ones this exists to upgrade.
	if got := post(""); got == http.StatusUpgradeRequired {
		t.Fatal("a client that sent no version was refused as too old")
	}

	// Reads are never gated: an old client that cannot see the
	// leaderboard shows a blank title screen, which reads as the server
	// being down rather than as a client that needs updating.
	for _, path := range []string{"/api/stats", "/api/scores/top", "/api/presence", "/api/health"} {
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set(ClientVersionHeader, "0.0.1")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code == http.StatusUpgradeRequired {
			t.Errorf("%s refused an old client; reads must not be gated", path)
		}
	}
	// ...and the gate is advertised, so a client can warn before it
	// spends a run finding out.
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/stats", nil))
	if !strings.Contains(w.Body.String(), `"minClient":"1.1.0"`) {
		t.Fatalf("/api/stats does not publish the gate: %s", w.Body)
	}
}

func TestEveryWriteIsBehindTheGate(t *testing.T) {
	// The list of gated routes is hand-written, so this is the check
	// that it did not fall behind the list of routes that change
	// something.
	srv, _ := versionServer(t, "9.9.9", time.Now())
	h := srv.Routes()
	for _, c := range []struct{ method, path, body string }{
		{"POST", "/api/scores", `{"points":1}`},
		{"POST", "/api/runs/start", `{}`},
		{"POST", "/api/mods", `{"name":"x"}`},
		{"PUT", "/api/me/hangar", `{"coins":1}`},
	} {
		req := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set(ClientVersionHeader, "1.0.0")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusUpgradeRequired {
			t.Errorf("%s %s answered %d for an outdated client, want 426",
				c.method, c.path, w.Code)
		}
	}
}

func TestVersionsSeenAreTalliedAndAged(t *testing.T) {
	at := time.Now()
	srv, _ := versionServer(t, "1.1.0", at)
	now := at
	srv.SetClock(func() time.Time { return now })
	srv.versions = newVersionTally(srv.now)
	h := srv.Routes()

	hit := func(ver string) {
		req := httptest.NewRequest("GET", "/api/health", nil)
		if ver != "" {
			req.Header.Set(ClientVersionHeader, ver)
		}
		h.ServeHTTP(httptest.NewRecorder(), req)
	}
	hit("1.1.0")
	hit("1.1.0")
	hit("1.0.4")
	hit("")         // no header: nothing to count
	hit("<script>") // rubbish: dropped

	got := srv.clientVersionsSeen()
	if len(got) != 2 {
		t.Fatalf("tallied %d versions, want 2: %+v", len(got), got)
	}
	// Newest first, so an operator reads the current build at the top.
	if got[0].Version != "1.1.0" || got[0].Count != 2 {
		t.Fatalf("first row is %+v", got[0])
	}
	if got[1].Version != "1.0.4" || !got[1].Stale {
		t.Fatalf("the old build is not flagged stale: %+v", got[1])
	}
	if got[0].Stale {
		t.Fatal("the current build is flagged stale")
	}

	// A sighting from last month is not evidence about today. Without
	// ageing, the tally only grows and an upgrade never shows as done.
	now = at.Add(versionSeenTTL + time.Hour)
	hit("1.1.0")
	got = srv.clientVersionsSeen()
	if len(got) != 1 || got[0].Version != "1.1.0" {
		t.Fatalf("stale versions were not aged out: %+v", got)
	}
}

func TestTheVersionTallyIsBounded(t *testing.T) {
	// The key comes from the network. An unbounded map keyed on it is a
	// memory leak with a user agent.
	v := newVersionTally(time.Now)
	for i := 0; i < maxTrackedVersions*4; i++ {
		v.note(strings.Repeat("9", 1+i%20) + "." + strings.Repeat("1", 1+i%9))
	}
	if n := len(v.report()); n > maxTrackedVersions {
		t.Fatalf("the tally grew to %d entries, cap is %d", n, maxTrackedVersions)
	}
}

func TestAdminStatsCarriesTheBuildAndClientVersions(t *testing.T) {
	h, _ := adminServer(t, true)
	tok := adminLoginAs(t, h)
	_, out := adminDo(t, h, "GET", "/api/admin/stats", tok, nil, true)
	if out["server"] == nil {
		t.Fatal("the operator's stats carry no build block")
	}
	srv, _ := out["server"].(map[string]any)
	for _, k := range []string{"version", "started", "uptimeSec"} {
		if _, ok := srv[k]; !ok {
			t.Errorf("the build block has no %q: %v", k, srv)
		}
	}
	if _, ok := out["clientVersions"]; !ok {
		t.Fatal("the operator's stats carry no client version tally")
	}
}
