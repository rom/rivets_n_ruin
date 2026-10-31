package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/rom/rivets_n_ruin/internal/store"
)

// newTestServer returns the Routes() handler; these tests need the Server
// itself, because persistence is its API and not an HTTP route.
func newServer(t *testing.T) *Server {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(store.NewMemory(), log, Config{RateLimitPerSec: 1e6, RateBurst: 1e6})
}

// A campaign takes longer than a deploy. Before these, a server restart
// mid-run voided it: the submission came back 409 "no such run, or it has
// expired" and the player lost a campaign to something they could not see.

func TestOpenRunsSurviveARestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "rnr.json.runs")

	before := newServer(t)
	r, err := before.runs.open("pilot-1", "")
	if err != nil {
		t.Fatalf("opening a run: %v", err)
	}
	before.runs.beat(r.ID, 4)
	before.runs.beat(r.ID, 7)
	if err := before.SaveRuns(path); err != nil {
		t.Fatalf("saving runs: %v", err)
	}

	// A different server process, same data directory.
	after := newServer(t)
	n, err := after.LoadRuns(path)
	if err != nil {
		t.Fatalf("loading runs: %v", err)
	}
	if n != 1 {
		t.Fatalf("restored %d runs, want 1", n)
	}

	got := after.runs.get(r.ID)
	if got == nil {
		t.Fatal("the run did not come back; the campaign is lost")
	}
	if got.PlayerID != "pilot-1" {
		t.Errorf("run came back owned by %q", got.PlayerID)
	}
	if got.Beats != 2 || got.MaxLevel != 7 {
		t.Errorf("beats %d / maxLevel %d, want 2 / 7 — the anti-cheat checks read these",
			got.Beats, got.MaxLevel)
	}
	if string(got.Secret) != string(r.Secret) {
		t.Error("the secret did not survive, so the signature on the submission cannot match")
	}
	// The whole point: a submission signed before the restart still verifies.
	sig := sign(got.Secret, got.ID, 4650367, 256.8, 8)
	if err := checkRunSig(got, "pilot-1", 4650367, 256.8, 8, sig); err != nil {
		t.Errorf("a run signed before the restart no longer verifies: %v", err)
	}
}

// Only the sig/ownership part of checkRun; the timing checks need a clock
// that has actually advanced and are covered separately.
func checkRunSig(r *runSession, playerID string, points int, timeSec float64, levels int, sig string) error {
	saved := r.Started
	r.Started = time.Now().Add(-time.Hour)
	defer func() { r.Started = saved }()
	beats := r.Beats
	r.Beats = 1000
	defer func() { r.Beats = beats }()
	return checkRun(r, playerID, points, timeSec, levels, sig)
}

func TestUsedAndExpiredRunsAreNotResurrected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "runs")
	s := newServer(t)

	live, _ := s.runs.open("p", "")
	used, _ := s.runs.open("p", "")
	s.runs.consume(used.ID)
	old, _ := s.runs.open("p", "")
	s.runs.runs[old.ID].Started = time.Now().Add(-2 * runTTL)

	if err := s.SaveRuns(path); err != nil {
		t.Fatal(err)
	}
	after := newServer(t)
	if n, _ := after.LoadRuns(path); n != 1 {
		t.Fatalf("restored %d runs, want only the live one", n)
	}
	if after.runs.get(live.ID) == nil {
		t.Error("the live run was dropped")
	}
	if after.runs.get(used.ID) != nil {
		t.Error("a submitted run came back, which widens the replay window")
	}
	if after.runs.get(old.ID) != nil {
		t.Error("an expired run came back")
	}
}

func TestARunThatExpiresWhileTheServerIsDownIsNotRestored(t *testing.T) {
	path := filepath.Join(t.TempDir(), "runs")
	s := newServer(t)
	r, _ := s.runs.open("p", "")
	if err := s.SaveRuns(path); err != nil {
		t.Fatal(err)
	}

	// Rewrite the file as if the save had happened a long time ago.
	var snaps []runSnapshot
	raw, _ := os.ReadFile(path)
	if err := json.Unmarshal(raw, &snaps); err != nil {
		t.Fatal(err)
	}
	snaps[0].Started = time.Now().Add(-2 * runTTL)
	out, _ := json.Marshal(snaps)
	if err := os.WriteFile(path, out, 0o600); err != nil {
		t.Fatal(err)
	}

	after := newServer(t)
	if n, _ := after.LoadRuns(path); n != 0 {
		t.Fatalf("restored %d runs; the TTL must be measured now, not at save time", n)
	}
	if after.runs.get(r.ID) != nil {
		t.Error("a run that expired during the outage came back")
	}
}

func TestNoRunFileIsNotAnError(t *testing.T) {
	s := newServer(t)
	n, err := s.LoadRuns(filepath.Join(t.TempDir(), "never-written"))
	if err != nil {
		t.Fatalf("a first boot must not be an error: %v", err)
	}
	if n != 0 {
		t.Fatalf("restored %d runs from nothing", n)
	}
}

// One unreadable entry must not cost everybody else their campaign.
func TestABadEntryDoesNotTakeTheRestWithIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "runs")
	good := runSnapshot{
		ID: "aaaa", PlayerID: "p", Secret: "c2VjcmV0", Started: time.Now(),
	}
	bad := []runSnapshot{
		{ID: "", PlayerID: "p", Secret: "c2VjcmV0", Started: time.Now()},
		{ID: "bbbb", PlayerID: "", Secret: "c2VjcmV0", Started: time.Now()},
		{ID: "cccc", PlayerID: "p", Secret: "!!!! not base64 !!!!", Started: time.Now()},
		{ID: "dddd", PlayerID: "p", Secret: "", Started: time.Now()},
	}
	out, _ := json.Marshal(append(bad, good))
	if err := os.WriteFile(path, out, 0o600); err != nil {
		t.Fatal(err)
	}

	s := newServer(t)
	n, err := s.LoadRuns(path)
	if err != nil {
		t.Fatalf("a bad entry failed the whole restore: %v", err)
	}
	if n != 1 {
		t.Fatalf("restored %d runs, want just the good one", n)
	}
	if s.runs.get("aaaa") == nil {
		t.Error("the good run was lost to its neighbours")
	}
}

func TestCorruptRunFileIsReportedNotIgnored(t *testing.T) {
	path := filepath.Join(t.TempDir(), "runs")
	if err := os.WriteFile(path, []byte("{{{ not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	s := newServer(t)
	if _, err := s.LoadRuns(path); err == nil {
		t.Error("a corrupt run file was read as an empty one, so nobody would know")
	}
}

// Same write-to-temp-and-rename as the store: a crash mid-write must not
// leave a truncated file that loses every run instead of none.
func TestSaveIsAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "runs")
	s := newServer(t)
	if _, err := s.runs.open("p", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveRuns(path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Error("the temp file was left behind")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Errorf("saving left %d files in the directory, want 1", len(entries))
	}
}
