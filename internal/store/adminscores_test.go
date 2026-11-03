package store

import (
	"strings"
	"testing"

	"github.com/rom/rivets_n_ruin/internal/model"
)

// The operator's view of the recorded runs.
//
// Everything here is reachable only from internal/api/admin.go. The
// properties that matter are not "does it return rows": they are that
// removing a run takes the number it earned with it, that wiping the
// board leaves the accounts standing, and that a page says how much it
// is a page of.

func addRun(t *testing.T, m *Memory, p *model.Player, points int) *model.Score {
	t.Helper()
	s := &model.Score{PlayerID: p.ID, Points: points, TimeSec: 42, Levels: 3}
	if err := m.AddScore(s); err != nil {
		t.Fatalf("AddScore: %v", err)
	}
	return s
}

func TestListScoresPagesNewestFirst(t *testing.T) {
	m := NewMemory()
	p := mustPlayer(t, m, "rom")
	for i := 1; i <= 7; i++ {
		addRun(t, m, p, i*100)
	}

	page, total := m.ListScores("", 3, 0)
	if total != 7 {
		t.Fatalf("total = %d, want 7 — a page that cannot say how much it is a page of", total)
	}
	if len(page) != 3 {
		t.Fatalf("len(page) = %d, want 3", len(page))
	}
	// Newest first: the last run added is the one an operator is looking
	// for, and scrolling to the bottom of 400 runs to find it is not a
	// tool.
	if page[0].Points != 700 || page[2].Points != 500 {
		t.Fatalf("page = %d,%d,%d; want 700,600,500",
			page[0].Points, page[1].Points, page[2].Points)
	}

	next, _ := m.ListScores("", 3, 3)
	if len(next) != 3 || next[0].Points != 400 {
		t.Fatalf("second page starts at %d, want 400", next[0].Points)
	}
	// ...and the offset really skips rather than re-serving the first page.
	if next[0].ID == page[0].ID {
		t.Fatal("the second page is the first page again")
	}
}

func TestListScoresFiltersByNameAndID(t *testing.T) {
	m := NewMemory()
	rom := mustPlayer(t, m, "rom")
	ada := mustPlayer(t, m, "ada")
	addRun(t, m, rom, 100)
	target := addRun(t, m, ada, 200)

	byName, total := m.ListScores("AD", 50, 0)
	if total != 1 || len(byName) != 1 || byName[0].Name != "ada" {
		t.Fatalf("filtering by a partial name gave %d rows (total %d)", len(byName), total)
	}

	byRun, _ := m.ListScores(target.ID, 50, 0)
	if len(byRun) != 1 || byRun[0].ID != target.ID {
		t.Fatalf("a run id did not find its own run")
	}
	// A truncated id, the way one arrives from a copy out of the page.
	byPrefix, _ := m.ListScores(target.ID[:10], 50, 0)
	if len(byPrefix) != 1 || byPrefix[0].ID != target.ID {
		t.Fatalf("the first ten characters of a run id did not find it")
	}

	byPlayer, _ := m.ListScores(ada.ID, 50, 0)
	if len(byPlayer) != 1 || byPlayer[0].PlayerID != ada.ID {
		t.Fatalf("a player id did not find their runs")
	}

	if _, total := m.ListScores("nobody", 50, 0); total != 0 {
		t.Fatalf("a query matching nothing returned %d", total)
	}
}

// Ids are 32 hex characters, so a short query lands inside a good
// fraction of them by chance. Matching ids anywhere meant searching for
// the pilot "ada" returned her runs plus a scattering of other people's
// whose id happened to contain "ad" — and the test that found it passed
// most of the time, which is how it reached CI.
//
// Ids match from the start only. This drives the ids rather than hoping
// for a collision, so it fails every time if that changes back.
func TestAShortNameSearchDoesNotMatchRandomIDs(t *testing.T) {
	m := NewMemory()
	other := mustPlayer(t, m, "zz")
	wanted := mustPlayer(t, m, "ada")
	// Give the other pilot's run an id that CONTAINS the query and does
	// not start with it, which is exactly the case that was wrong.
	noise := &model.Score{PlayerID: other.ID, Points: 1, ID: "99ad99" + strings.Repeat("0", 26)}
	if err := m.AddScore(noise); err != nil {
		t.Fatal(err)
	}
	hit := &model.Score{PlayerID: wanted.ID, Points: 2}
	if err := m.AddScore(hit); err != nil {
		t.Fatal(err)
	}

	got, total := m.ListScores("ad", 50, 0)
	if total != 1 || len(got) != 1 || got[0].Name != "ada" {
		t.Fatalf("searching \"ad\" returned %d runs (total %d); a two-letter name "+
			"must not match the middle of somebody else's id", len(got), total)
	}
	// ...and the id is still findable from its own start.
	if _, n := m.ListScores("99ad", 50, 0); n != 1 {
		t.Fatalf("an id prefix found %d runs, want 1", n)
	}
}

func TestScoreByID(t *testing.T) {
	m := NewMemory()
	p := mustPlayer(t, m, "rom")
	s := addRun(t, m, p, 1234)

	got, err := m.ScoreByID(s.ID)
	if err != nil || got.Points != 1234 {
		t.Fatalf("ScoreByID: %v %+v", err, got)
	}
	// A copy, so an operator reading a run cannot edit the table by
	// holding on to what they read.
	got.Points = 1
	again, _ := m.ScoreByID(s.ID)
	if again.Points != 1234 {
		t.Fatalf("ScoreByID handed out a live pointer: %d", again.Points)
	}
	if _, err := m.ScoreByID("nope"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestDeleteScoreTakesTheNumberWithIt(t *testing.T) {
	// The point of removing a run is removing what it earned. A delete
	// that left Best alone would leave the cheated number on the card
	// after the run behind it was gone, which is the one thing this is
	// for.
	m := NewMemory()
	p := mustPlayer(t, m, "rom")
	addRun(t, m, p, 500)
	bogus := addRun(t, m, p, 999999)
	addRun(t, m, p, 700)

	before, _ := m.PlayerByID(p.ID)
	if before.Best != 999999 || before.Runs != 3 {
		t.Fatalf("fixture: best %d runs %d", before.Best, before.Runs)
	}

	if err := m.DeleteScore(bogus.ID); err != nil {
		t.Fatalf("DeleteScore: %v", err)
	}
	after, _ := m.PlayerByID(p.ID)
	if after.Best != 700 {
		t.Fatalf("best is still %d after removing the run that set it", after.Best)
	}
	if after.Runs != 2 {
		t.Fatalf("runs = %d after removing one of three", after.Runs)
	}
	if _, err := m.ScoreByID(bogus.ID); err != ErrNotFound {
		t.Fatal("the run is still on record")
	}
	// The leaderboard agrees, which is the number anyone else sees.
	top, _ := m.Top(TopQuery{Window: model.WindowAll, Limit: 10})
	if len(top) != 1 || top[0].Score.Points != 700 {
		t.Fatalf("the board still shows %+v", top)
	}
	if err := m.DeleteScore("nope"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestDeleteScoreLeavesOtherPilotsAlone(t *testing.T) {
	m := NewMemory()
	rom := mustPlayer(t, m, "rom")
	ada := mustPlayer(t, m, "ada")
	addRun(t, m, rom, 300)
	gone := addRun(t, m, ada, 800)
	addRun(t, m, ada, 100)

	if err := m.DeleteScore(gone.ID); err != nil {
		t.Fatalf("DeleteScore: %v", err)
	}
	r, _ := m.PlayerByID(rom.ID)
	if r.Runs != 1 || r.Best != 300 {
		t.Fatalf("recount reached into another pilot: runs %d best %d", r.Runs, r.Best)
	}
	a, _ := m.PlayerByID(ada.ID)
	if a.Runs != 1 || a.Best != 100 {
		t.Fatalf("ada: runs %d best %d", a.Runs, a.Best)
	}
}

func TestResetScoresClearsTheBoardAndKeepsTheAccounts(t *testing.T) {
	m := NewMemory()
	rom := mustPlayer(t, m, "rom")
	ada := mustPlayer(t, m, "ada")
	addRun(t, m, rom, 500)
	addRun(t, m, ada, 900)
	h := m.SetHangar(rom.ID, &model.Hangar{Coins: 1200})

	n := m.ResetScores()
	if n != 2 {
		t.Fatalf("ResetScores reported %d runs, want 2", n)
	}
	top, _ := m.Top(TopQuery{Window: model.WindowAll, Limit: 10})
	if len(top) != 0 {
		t.Fatalf("the board still has %d rows", len(top))
	}
	for _, id := range []string{rom.ID, ada.ID} {
		p, err := m.PlayerByID(id)
		if err != nil {
			t.Fatalf("wiping the board deleted an account: %v", err)
		}
		if p.Runs != 0 || p.Best != 0 {
			t.Fatalf("%s still shows runs %d best %d", p.Name, p.Runs, p.Best)
		}
	}
	// Belongings are not scores. A pilot who banked coins keeps them.
	if got := m.Hangar(rom.ID); got.Coins != h.Coins {
		t.Fatalf("wiping the board emptied the hangar: %d", got.Coins)
	}
	if st := m.Stats(); st.Players != 2 || st.Runs != 0 || st.BestScore != 0 {
		t.Fatalf("stats after a wipe: %+v", st)
	}
}

func TestSetPlayerStats(t *testing.T) {
	m := NewMemory()
	p := mustPlayer(t, m, "rom")
	addRun(t, m, p, 400)

	if err := m.SetPlayerStats(p.ID, 12, 7000); err != nil {
		t.Fatalf("SetPlayerStats: %v", err)
	}
	got, _ := m.PlayerByID(p.ID)
	if got.Runs != 12 || got.Best != 7000 {
		t.Fatalf("runs %d best %d", got.Runs, got.Best)
	}
	// The counters are a cache; the board is computed from the runs.
	// Setting one does not invent the other, and the API is what has to
	// show the operator that the two now disagree.
	top, _ := m.Top(TopQuery{Window: model.WindowAll, Limit: 10})
	if len(top) != 1 || top[0].Score.Points != 400 {
		t.Fatalf("editing a counter moved the leaderboard: %+v", top)
	}
	// Negatives are a typo, not an instruction.
	if err := m.SetPlayerStats(p.ID, -5, -5); err != nil {
		t.Fatalf("SetPlayerStats: %v", err)
	}
	got, _ = m.PlayerByID(p.ID)
	if got.Runs != 0 || got.Best != 0 {
		t.Fatalf("negatives stored: runs %d best %d", got.Runs, got.Best)
	}
	if err := m.SetPlayerStats("nope", 1, 1); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestDeletedRunsDoNotComeBackFromASnapshot(t *testing.T) {
	// The snapshot is the source of truth across a restart. A run
	// removed by an operator that reappears on the next boot is not
	// removed.
	m := NewMemory()
	p := mustPlayer(t, m, "rom")
	addRun(t, m, p, 100)
	bogus := addRun(t, m, p, 999999)
	if err := m.DeleteScore(bogus.ID); err != nil {
		t.Fatalf("DeleteScore: %v", err)
	}

	path := t.TempDir() + "/scores.json"
	if err := m.Snapshot(path); err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	n := NewMemory()
	if err := n.Load(path); err != nil {
		t.Fatalf("Load: %v", err)
	}
	if _, err := n.ScoreByID(bogus.ID); err != ErrNotFound {
		t.Fatal("a deleted run came back from the snapshot")
	}
	back, err := n.PlayerByID(p.ID)
	if err != nil {
		t.Fatalf("PlayerByID after reload: %v", err)
	}
	if back.Best != 100 {
		t.Fatalf("best came back as %d, want 100", back.Best)
	}
}
