package store

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/rom/rivets_n_ruin/internal/model"
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
