package store

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/rom/rivets_n_ruin/internal/model"
	"os"
	"strings"
)

func mustPlayer(t *testing.T, m *Memory, name string) *model.Player {
	t.Helper()
	p, err := m.CreatePlayer(name, "hash-"+name)
	if err != nil {
		t.Fatalf("CreatePlayer(%q): %v", name, err)
	}
	return p
}

func TestCreatePlayerRejectsDuplicateName(t *testing.T) {
	m := NewMemory()
	mustPlayer(t, m, "rom")
	if _, err := m.CreatePlayer("ROM", "other"); err != ErrNameTaken {
		t.Fatalf("expected ErrNameTaken for a case-insensitive duplicate, got %v", err)
	}
}

func TestTokenLookup(t *testing.T) {
	m := NewMemory()
	p := mustPlayer(t, m, "rom")
	got, err := m.PlayerByTokenHash("hash-rom")
	if err != nil || got.ID != p.ID {
		t.Fatalf("token lookup failed: %v %+v", err, got)
	}
	if _, err := m.PlayerByTokenHash("nope"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for an unknown token, got %v", err)
	}
}

// A player's clone must not expose the token hash, and mutating a returned
// copy must not reach back into the store.
func TestPlayerCopiesAreIsolated(t *testing.T) {
	m := NewMemory()
	p := mustPlayer(t, m, "rom")
	p.Name = "tampered"
	again, _ := m.PlayerByID(p.ID)
	if again.Name != "rom" {
		t.Fatalf("mutating a returned player leaked into the store: %q", again.Name)
	}
}

func TestTopReturnsOneRowPerPlayerBestFirst(t *testing.T) {
	m := NewMemory()
	a := mustPlayer(t, m, "ace")
	b := mustPlayer(t, m, "bolt")

	for _, pts := range []int{100, 9000, 400} {
		if err := m.AddScore(&model.Score{PlayerID: a.ID, Points: pts}); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.AddScore(&model.Score{PlayerID: b.ID, Points: 5000}); err != nil {
		t.Fatal(err)
	}

	top, err := m.Top(TopQuery{Window: model.WindowAll, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(top) != 2 {
		t.Fatalf("expected one row per player, got %d rows", len(top))
	}
	if top[0].Score.Name != "ace" || top[0].Score.Points != 9000 || top[0].Position != 1 {
		t.Fatalf("row 1 wrong: %+v", top[0].Score)
	}
	if top[1].Score.Name != "bolt" || top[1].Position != 2 {
		t.Fatalf("row 2 wrong: %+v", top[1].Score)
	}
}

func TestTopTieBreaksOnFasterTime(t *testing.T) {
	m := NewMemory()
	slow := mustPlayer(t, m, "slow")
	fast := mustPlayer(t, m, "fast")
	if err := m.AddScore(&model.Score{PlayerID: slow.ID, Points: 1000, TimeSec: 200}); err != nil {
		t.Fatal(err)
	}
	if err := m.AddScore(&model.Score{PlayerID: fast.ID, Points: 1000, TimeSec: 90}); err != nil {
		t.Fatal(err)
	}
	top, _ := m.Top(TopQuery{Window: model.WindowAll, Limit: 10})
	if top[0].Score.Name != "fast" {
		t.Fatalf("equal points should break toward the faster run, got %q first", top[0].Score.Name)
	}
}

func TestTopWindowFiltersByAge(t *testing.T) {
	m := NewMemory()
	now := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	m.SetClock(func() time.Time { return now })
	old := mustPlayer(t, m, "veteran")
	fresh := mustPlayer(t, m, "rookie")

	if err := m.AddScore(&model.Score{PlayerID: old.ID, Points: 9999, Created: now.Add(-72 * time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if err := m.AddScore(&model.Score{PlayerID: fresh.ID, Points: 10, Created: now.Add(-1 * time.Hour)}); err != nil {
		t.Fatal(err)
	}

	day, _ := m.Top(TopQuery{Window: model.WindowDay, Limit: 10})
	if len(day) != 1 || day[0].Score.Name != "rookie" {
		t.Fatalf("day window should hold only the recent run, got %d rows", len(day))
	}
	all, _ := m.Top(TopQuery{Window: model.WindowAll, Limit: 10})
	if len(all) != 2 {
		t.Fatalf("all-time should hold both, got %d", len(all))
	}
}

func TestTopScopesByMod(t *testing.T) {
	m := NewMemory()
	p := mustPlayer(t, m, "rom")
	mod := &model.Mod{Name: "Osmium", AuthorID: p.ID}
	if err := m.CreateMod(mod); err != nil {
		t.Fatal(err)
	}
	if err := m.AddScore(&model.Score{PlayerID: p.ID, Points: 100}); err != nil {
		t.Fatal(err)
	}
	if err := m.AddScore(&model.Score{PlayerID: p.ID, ModID: mod.ID, Points: 777}); err != nil {
		t.Fatal(err)
	}

	stock, _ := m.Top(TopQuery{ModID: "", Window: model.WindowAll, Limit: 10})
	if len(stock) != 1 || stock[0].Score.Points != 100 {
		t.Fatalf("stock board leaked a mod score: %+v", stock)
	}
	onMod, _ := m.Top(TopQuery{ModID: mod.ID, Window: model.WindowAll, Limit: 10})
	if len(onMod) != 1 || onMod[0].Score.Points != 777 {
		t.Fatalf("mod board wrong: %+v", onMod)
	}
	pooled, _ := m.Top(TopQuery{ModID: "*", Window: model.WindowAll, Limit: 10})
	if len(pooled) != 1 || pooled[0].Score.Points != 777 {
		t.Fatalf("pooled board should keep the player's single best: %+v", pooled)
	}
}

func TestAddScoreUpdatesPlayerAndModCounters(t *testing.T) {
	m := NewMemory()
	p := mustPlayer(t, m, "rom")
	mod := &model.Mod{Name: "Tantalum", AuthorID: p.ID}
	if err := m.CreateMod(mod); err != nil {
		t.Fatal(err)
	}
	for _, pts := range []int{500, 200} {
		if err := m.AddScore(&model.Score{PlayerID: p.ID, ModID: mod.ID, Points: pts}); err != nil {
			t.Fatal(err)
		}
	}
	got, _ := m.PlayerByID(p.ID)
	if got.Runs != 2 || got.Best != 500 {
		t.Fatalf("player counters wrong: runs=%d best=%d", got.Runs, got.Best)
	}
	gotMod, _ := m.ModByID(mod.ID)
	if gotMod.Plays != 2 {
		t.Fatalf("mod plays wrong: %d", gotMod.Plays)
	}
}

func TestAddScoreRejectsUnknownPlayer(t *testing.T) {
	m := NewMemory()
	if err := m.AddScore(&model.Score{PlayerID: "ghost", Points: 1}); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestPresenceExpires(t *testing.T) {
	m := NewMemory()
	now := time.Now()
	m.SetClock(func() time.Time { return now })
	p := mustPlayer(t, m, "rom")
	if err := m.Heartbeat(model.Presence{PlayerID: p.ID, Name: p.Name, Progress: 0.5}); err != nil {
		t.Fatal(err)
	}
	if got := m.LivePresence(); len(got) != 1 {
		t.Fatalf("expected 1 live pilot, got %d", len(got))
	}
	now = now.Add(PresenceTTL + time.Second)
	if got := m.LivePresence(); len(got) != 0 {
		t.Fatalf("stale presence was not swept, got %d", len(got))
	}
}

func TestSnapshotRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "rnr.json")
	m := NewMemory()
	p := mustPlayer(t, m, "rom")
	mod := &model.Mod{Name: "Rhenium", AuthorID: p.ID}
	if err := m.CreateMod(mod); err != nil {
		t.Fatal(err)
	}
	if err := m.AddScore(&model.Score{PlayerID: p.ID, Points: 4242, ModID: mod.ID}); err != nil {
		t.Fatal(err)
	}
	if err := m.Snapshot(path); err != nil {
		t.Fatalf("Snapshot: %v", err)
	}

	m2 := NewMemory()
	if err := m2.Load(path); err != nil {
		t.Fatalf("Load: %v", err)
	}
	got, err := m2.PlayerByID(p.ID)
	if err != nil || got.Name != "rom" {
		t.Fatalf("player did not survive the round trip: %v %+v", err, got)
	}
	// The token must still resolve, or every player is locked out on restart.
	if _, err := m2.PlayerByTokenHash("hash-rom"); err != nil {
		t.Fatalf("token index did not survive the round trip: %v", err)
	}
	top, _ := m2.Top(TopQuery{ModID: mod.ID, Window: model.WindowAll, Limit: 5})
	if len(top) != 1 || top[0].Score.Points != 4242 {
		t.Fatalf("scores did not survive the round trip: %+v", top)
	}
}

func TestLoadMissingFileIsNotAnError(t *testing.T) {
	m := NewMemory()
	if err := m.Load(filepath.Join(t.TempDir(), "absent.json")); err != nil {
		t.Fatalf("first run should not fail: %v", err)
	}
}

// The whole point of the backend is many players at once, so hammer it.
func TestConcurrentPlayersAndScores(t *testing.T) {
	m := NewMemory()
	const players, runsEach = 40, 25

	var wg sync.WaitGroup
	for i := 0; i < players; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			p, err := m.CreatePlayer(fmt.Sprintf("pilot%02d", i), fmt.Sprintf("hash%02d", i))
			if err != nil {
				t.Errorf("CreatePlayer: %v", err)
				return
			}
			for j := 0; j < runsEach; j++ {
				if err := m.AddScore(&model.Score{PlayerID: p.ID, Points: i*100 + j}); err != nil {
					t.Errorf("AddScore: %v", err)
					return
				}
				_ = m.Heartbeat(model.Presence{PlayerID: p.ID, Name: p.Name, Progress: float64(j) / runsEach})
				_, _ = m.Top(TopQuery{Window: model.WindowAll, Limit: 10})
				_ = m.Stats()
			}
		}(i)
	}
	wg.Wait()

	st := m.Stats()
	if st.Players != players {
		t.Fatalf("expected %d players, got %d", players, st.Players)
	}
	if st.Runs != players*runsEach {
		t.Fatalf("expected %d runs, got %d", players*runsEach, st.Runs)
	}
	top, _ := m.Top(TopQuery{Window: model.WindowAll, Limit: 100})
	if len(top) != players {
		t.Fatalf("expected one row per player, got %d", len(top))
	}
	// highest-numbered pilot scores highest
	if want := (players-1)*100 + runsEach - 1; top[0].Score.Points != want {
		t.Fatalf("top score %d, want %d", top[0].Score.Points, want)
	}
}

func TestTopRunsDoesNotFoldByPlayer(t *testing.T) {
	m := NewMemory()
	ace := mustPlayer(t, m, "ace")
	bolt := mustPlayer(t, m, "bolt")

	for _, pts := range []int{9000, 8000, 7000} {
		if err := m.AddScore(&model.Score{PlayerID: ace.ID, Points: pts}); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.AddScore(&model.Score{PlayerID: bolt.ID, Points: 8500}); err != nil {
		t.Fatal(err)
	}

	// Top folds to one row per player; TopRuns does not.
	top, _ := m.Top(TopQuery{Window: model.WindowAll, Limit: 10})
	if len(top) != 2 {
		t.Fatalf("Top should fold to 2 players, got %d", len(top))
	}
	runs, err := m.TopRuns(TopQuery{Window: model.WindowAll, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 4 {
		t.Fatalf("TopRuns should list all 4 runs, got %d", len(runs))
	}
	want := []int{9000, 8500, 8000, 7000}
	for i, w := range want {
		if runs[i].Score.Points != w {
			t.Fatalf("run %d is %d, want %d", i, runs[i].Score.Points, w)
		}
		if runs[i].Position != i+1 {
			t.Fatalf("run %d has position %d", i, runs[i].Position)
		}
	}
	// one pilot holding several places is the whole point
	if runs[0].Score.Name != "ace" || runs[2].Score.Name != "ace" {
		t.Fatal("ace should hold more than one place")
	}
}

func TestTopRunsRespectsWindowAndLimit(t *testing.T) {
	m := NewMemory()
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	m.SetClock(func() time.Time { return now })
	p := mustPlayer(t, m, "rom")
	for i := 0; i < 20; i++ {
		if err := m.AddScore(&model.Score{PlayerID: p.ID, Points: i * 100, Created: now.Add(-time.Hour)}); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.AddScore(&model.Score{PlayerID: p.ID, Points: 99999, Created: now.Add(-72 * time.Hour)}); err != nil {
		t.Fatal(err)
	}
	runs, _ := m.TopRuns(TopQuery{Window: model.WindowDay, Limit: 5})
	if len(runs) != 5 {
		t.Fatalf("limit ignored: %d rows", len(runs))
	}
	if runs[0].Score.Points == 99999 {
		t.Fatal("a run outside the window was included")
	}
}

// The snapshot holds every pilot's token hash and password hash. It was
// written with os.Create, which is 0666 before umask and 0644 after, so
// on a shared machine the whole credential table was world-readable —
// while the run file written beside it was already 0600.
func TestSnapshotIsNotWorldReadable(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "rnr.json")
	m := NewMemory()
	p := mustPlayer(t, m, "rom")
	if err := m.SetPassword(p.ID, "pbkdf2-sha256$1$aa$bb"); err != nil {
		t.Fatal(err)
	}
	if err := m.Snapshot(path); err != nil {
		t.Fatalf("Snapshot: %v", err)
	}

	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if mode := fi.Mode().Perm(); mode&0o077 != 0 {
		t.Errorf("the snapshot is mode %04o; it holds token and password hashes", mode)
	}

	di, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if mode := di.Mode().Perm(); mode&0o077 != 0 {
		t.Errorf("the data directory is mode %04o", mode)
	}

	// And it really does contain the thing worth protecting, or this
	// test is guarding an empty file.
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "pbkdf2") {
		t.Fatal("the snapshot holds no password hash, so this proves nothing")
	}
}

// --- hangars

func TestHangarIsNeverNil(t *testing.T) {
	m := NewMemory()
	h := m.Hangar("nobody")
	if h == nil || h.Mods == nil {
		t.Fatalf("a pilot who has banked nothing must read as empty, not missing: %#v", h)
	}
	if h.Coins != 0 || h.Bars != 0 || len(h.Mods) != 0 {
		t.Fatalf("an empty hangar is not empty: %#v", h)
	}
}

func TestSetHangarClamps(t *testing.T) {
	m := NewMemory()
	mods := map[string]int{}
	for i := 0; i < MaxMods*3; i++ {
		mods[fmt.Sprintf("mod%03d", i)] = 5
	}
	mods["negative"] = -4
	mods[""] = 2
	mods[strings.Repeat("x", 200)] = 2

	got := m.SetHangar("p1", &model.Hangar{
		Coins: MaxCoins * 10, Bars: -99, Mods: mods,
	})
	if got.Coins != MaxCoins {
		t.Errorf("coins = %d, want the cap %d", got.Coins, MaxCoins)
	}
	if got.Bars != 0 {
		t.Errorf("a negative balance became %d, want 0", got.Bars)
	}
	if len(got.Mods) > MaxMods {
		t.Errorf("%d mods kept, want at most %d", len(got.Mods), MaxMods)
	}
	for id, lvl := range got.Mods {
		if id == "" || len(id) > 64 {
			t.Errorf("a junk mod id survived: %q", id)
		}
		if lvl < 1 || lvl > MaxModLevel {
			t.Errorf("%s came back at level %d", id, lvl)
		}
	}
}

func TestSetHangarHandsBackACopy(t *testing.T) {
	// The caller gets a value it can scribble on. Returning the stored
	// map would let an HTTP handler mutate the store after the fact,
	// outside the lock.
	m := NewMemory()
	m.SetHangar("p1", &model.Hangar{Coins: 10, Mods: map[string]int{"a": 1}})
	got := m.Hangar("p1")
	got.Coins = 99999
	got.Mods["a"] = 99
	got.Mods["b"] = 1

	again := m.Hangar("p1")
	if again.Coins != 10 || again.Mods["a"] != 1 || len(again.Mods) != 1 {
		t.Fatalf("the stored hangar was changed from outside: %#v", again)
	}
}

func TestSetHangarTakesNil(t *testing.T) {
	m := NewMemory()
	got := m.SetHangar("p1", nil)
	if got == nil || got.Coins != 0 || got.Mods == nil {
		t.Fatalf("a nil body should store an empty hangar, got %#v", got)
	}
}

func TestDeleteHangar(t *testing.T) {
	m := NewMemory()
	m.SetHangar("p1", &model.Hangar{Coins: 500})
	m.DeleteHangar("p1")
	if h := m.Hangar("p1"); h.Coins != 0 {
		t.Fatalf("a deleted hangar still has %d coins", h.Coins)
	}
}

func TestHangarsSurviveASnapshot(t *testing.T) {
	// It lives in the account half, because deleting a pilot has to take
	// their belongings with them and because it is per-pilot data rather
	// than the published leaderboard.
	dir := t.TempDir()
	path := filepath.Join(dir, "accounts.json")

	m := NewMemory()
	m.SetHangar("p1", &model.Hangar{Coins: 1234, Bars: 7, Mods: map[string]int{"reclaimer": 3}})
	if err := m.SnapshotPart(path, Accounts); err != nil {
		t.Fatal(err)
	}

	back := NewMemory()
	if err := back.Load(path); err != nil {
		t.Fatal(err)
	}
	h := back.Hangar("p1")
	if h.Coins != 1234 || h.Bars != 7 || h.Mods["reclaimer"] != 3 {
		t.Fatalf("the hangar did not survive the round trip: %#v", h)
	}

	// ...and not in the published half, which is handed out freely.
	pub := filepath.Join(dir, "scores.json")
	if err := m.SnapshotPart(pub, Public); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(pub)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "reclaimer") {
		t.Error("a pilot's belongings were written into the public snapshot")
	}
}

func TestClampInt(t *testing.T) {
	for _, c := range []struct{ v, lo, hi, want int }{
		{5, 0, 10, 5}, {-1, 0, 10, 0}, {99, 0, 10, 10}, {0, 0, 0, 0},
	} {
		if got := clampInt(c.v, c.lo, c.hi); got != c.want {
			t.Errorf("clampInt(%d,%d,%d) = %d, want %d", c.v, c.lo, c.hi, got, c.want)
		}
	}
}

// --- administration

func seedPilotWithScores(t *testing.T, m *Memory, name string, n int) *model.Player {
	t.Helper()
	p := mustPlayer(t, m, name)
	for i := 0; i < n; i++ {
		if err := m.AddScore(&model.Score{
			ID: fmt.Sprintf("%s-%d", p.ID, i), PlayerID: p.ID, Name: p.Name,
			Points: 100 * (i + 1), Levels: 1,
		}); err != nil {
			t.Fatal(err)
		}
	}
	m.SetHangar(p.ID, &model.Hangar{Coins: 250})
	return p
}

func TestListPlayersFiltersAndCaps(t *testing.T) {
	m := NewMemory()
	for _, n := range []string{"ALPHA", "ALPACA", "BRAVO"} {
		mustPlayer(t, m, n)
	}
	if got := len(m.ListPlayers("", 0)); got != 3 {
		t.Errorf("listed %d of 3", got)
	}
	if got := len(m.ListPlayers("alp", 0)); got != 2 {
		t.Errorf("case-insensitive search returned %d, want 2", got)
	}
	if got := len(m.ListPlayers("", 1)); got != 1 {
		t.Errorf("limit ignored: %d", got)
	}
	if got := len(m.ListPlayers("nothing matches this", 0)); got != 0 {
		t.Errorf("a miss returned %d", got)
	}
}

func TestDeletePlayerTakesEverything(t *testing.T) {
	// A delete that leaves the scores behind leaves the pilot's name on
	// the leaderboard — the one page that is published — so the only
	// part anybody could see would not have been deleted.
	m := NewMemory()
	gone := seedPilotWithScores(t, m, "DELETEME", 3)
	stays := seedPilotWithScores(t, m, "KEEPME", 2)

	if err := m.DeletePlayer(gone.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := m.PlayerByID(gone.ID); err == nil {
		t.Error("the player record survived")
	}
	if _, err := m.PlayerByName("DELETEME"); err == nil {
		t.Error("the name is still taken, so it cannot be reused")
	}
	if _, err := m.PlayerByTokenHash(gone.TokenHash); err == nil {
		t.Error("the old token still resolves")
	}
	if h := m.Hangar(gone.ID); h.Coins != 0 {
		t.Error("their belongings survived")
	}
	if got, _ := m.PlayerScores(gone.ID, 50); len(got) != 0 {
		t.Errorf("%d scores survived the delete", len(got))
	}
	// ...and the pilot standing next to them is untouched.
	if got, _ := m.PlayerScores(stays.ID, 50); len(got) != 2 {
		t.Errorf("deleting one pilot took %d of another's scores", 2-len(got))
	}
	if h := m.Hangar(stays.ID); h.Coins != 250 {
		t.Error("deleting one pilot emptied another's hangar")
	}
	if err := m.DeletePlayer("no-such-id"); err == nil {
		t.Error("deleting a missing pilot should report not found")
	}
}

func TestResetPlayerKeepsTheAccount(t *testing.T) {
	m := NewMemory()
	p := seedPilotWithScores(t, m, "RESETME", 3)
	before := p.TokenHash

	if err := m.ResetPlayer(p.ID); err != nil {
		t.Fatal(err)
	}
	after, err := m.PlayerByID(p.ID)
	if err != nil {
		t.Fatal("reset deleted the account; it should only clear it")
	}
	if after.TokenHash != before {
		t.Error("reset changed the credential; that is what the password route is for")
	}
	if after.Runs != 0 || after.Best != 0 {
		t.Errorf("the counters survived: runs=%d best=%d", after.Runs, after.Best)
	}
	if got, _ := m.PlayerScores(p.ID, 50); len(got) != 0 {
		t.Errorf("%d scores survived the reset", len(got))
	}
	if h := m.Hangar(p.ID); h.Coins != 0 {
		t.Error("their belongings survived the reset")
	}
	if err := m.ResetPlayer("no-such-id"); err == nil {
		t.Error("resetting a missing pilot should report not found")
	}
}

func TestDroppedScoresDoNotLeak(t *testing.T) {
	// dropScoresLocked compacts in place. The tail of the backing array
	// still points at the removed entries, and leaving it that way keeps
	// them alive for as long as the process runs.
	m := NewMemory()
	p := seedPilotWithScores(t, m, "LEAKCHECK", 5)
	m.DeletePlayer(p.ID)

	m.mu.RLock()
	defer m.mu.RUnlock()
	tail := m.scores[len(m.scores):cap(m.scores)]
	for i, s := range tail {
		if s != nil {
			t.Fatalf("slot %d past the end still references a score", i)
		}
	}
}
