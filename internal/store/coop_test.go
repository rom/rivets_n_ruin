package store

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/rom/rivets_n_ruin/internal/model"
)

// The co-op table.
//
// What these are actually guarding, in order of how badly it would hurt
// to get it wrong:
//
//   1. A co-op run must not leak into a pilot's solo card. The whole
//      reason the two boards are separate is that a pair's score is not
//      comparable to one pilot's, and the moment AddCoopScore bumps
//      Player.Best the solo board is quietly wrong for everybody.
//   2. Deleting a pilot must take their co-op runs, from either side.
//      The same reasoning as DeletePlayer's own comment: a delete that
//      leaves the name on the published board has not deleted the only
//      part anybody could see.
//   3. The submitting client must not be able to name the other pilot.

func twoPilots(t *testing.T) (*Memory, *model.Player, *model.Player) {
	t.Helper()
	m := NewMemory()
	a, err := m.CreatePlayer("rom", "hash-a")
	if err != nil {
		t.Fatal(err)
	}
	b, err := m.CreatePlayer("ada", "hash-b")
	if err != nil {
		t.Fatal(err)
	}
	return m, a, b
}

func addCoop(t *testing.T, m *Memory, hostID, guestID string, points int, opts ...func(*model.CoopScore)) *model.CoopScore {
	t.Helper()
	c := &model.CoopScore{
		HostID: hostID, GuestID: guestID,
		Points: points, TimeSec: 100, Levels: 2, PairedSec: 100,
	}
	for _, o := range opts {
		o(c)
	}
	if err := m.AddCoopScore(c); err != nil {
		t.Fatalf("adding a co-op run: %v", err)
	}
	return c
}

func TestACoopRunNamesBothPilotsFromTheirAccounts(t *testing.T) {
	m, a, b := twoPilots(t)
	// The submitting client claims both names. Both claims are ignored.
	c := addCoop(t, m, a.ID, b.ID, 5000, func(c *model.CoopScore) {
		c.HostName = "NOT ROM"
		c.GuestName = "NOT ADA"
	})
	if c.HostName != "rom" || c.GuestName != "ada" {
		t.Fatalf("names came from the request: host %q guest %q", c.HostName, c.GuestName)
	}
	if c.ID == "" {
		t.Fatal("no id was minted")
	}
	if c.Created.IsZero() {
		t.Fatal("no timestamp was set")
	}
}

func TestACoopRunDoesNotTouchEitherSoloCard(t *testing.T) {
	m, a, b := twoPilots(t)
	addCoop(t, m, a.ID, b.ID, 9_000_000)
	for _, p := range []*model.Player{a, b} {
		got, err := m.PlayerByID(p.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.Runs != 0 || got.Best != 0 {
			t.Fatalf("%s's solo card moved: runs %d best %d — a co-op score is not a solo score",
				got.Name, got.Runs, got.Best)
		}
	}
	// And it is not on the solo board either.
	top, err := m.TopRuns(TopQuery{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(top) != 0 {
		t.Fatalf("a co-op run reached the solo board: %d row(s)", len(top))
	}
}

func TestACoopRunNeedsTwoDifferentKnownPilots(t *testing.T) {
	m, a, b := twoPilots(t)
	cases := []struct {
		why    string
		host   string
		guest  string
		expect error
	}{
		{"an unknown host", "nobody", b.ID, ErrNotFound},
		{"an unknown guest", a.ID, "nobody", ErrNotFound},
		{"a pilot flying with themselves", a.ID, a.ID, ErrConflict},
	}
	for _, tc := range cases {
		err := m.AddCoopScore(&model.CoopScore{
			HostID: tc.host, GuestID: tc.guest, Points: 1, TimeSec: 1, Levels: 1,
		})
		if err != tc.expect {
			t.Fatalf("%s: got %v, want %v", tc.why, err, tc.expect)
		}
	}
}

func TestTheCoopBoardRanksByPointsThenTime(t *testing.T) {
	m, a, b := twoPilots(t)
	base := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	m.SetClock(func() time.Time { return base })
	slow := addCoop(t, m, a.ID, b.ID, 5000, func(c *model.CoopScore) { c.TimeSec = 400 })
	fast := addCoop(t, m, a.ID, b.ID, 5000, func(c *model.CoopScore) { c.TimeSec = 200 })
	big := addCoop(t, m, a.ID, b.ID, 9000)

	top, err := m.TopCoop(TopQuery{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{big.ID, fast.ID, slow.ID}
	if len(top) != len(want) {
		t.Fatalf("got %d rows, want %d", len(top), len(want))
	}
	for i, id := range want {
		if top[i].Score.ID != id {
			t.Fatalf("row %d is %s, want %s — order is points, then the faster run",
				i+1, top[i].Score.ID, id)
		}
		if top[i].Position != i+1 {
			t.Fatalf("row %d says position %d", i+1, top[i].Position)
		}
	}
}

func TestTheCoopBoardHonoursTheWindow(t *testing.T) {
	m, a, b := twoPilots(t)
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	m.SetClock(func() time.Time { return now })
	addCoop(t, m, a.ID, b.ID, 100, func(c *model.CoopScore) {
		c.Created = now.Add(-72 * time.Hour)
	})
	fresh := addCoop(t, m, a.ID, b.ID, 50)

	day, err := m.TopCoop(TopQuery{Window: model.WindowDay, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(day) != 1 || day[0].Score.ID != fresh.ID {
		t.Fatalf("the day window kept %d row(s); it should hold only today's", len(day))
	}
	all, err := m.TopCoop(TopQuery{Window: model.WindowAll, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("all-time kept %d row(s), want 2", len(all))
	}
}

// Matching the record does not take it. Counting greater-or-equal would
// tell the second pair they placed first, which is a nicer number and a
// false one.
// Where a run places has to be what the board will show, which is why
// CoopPosition asks coopOrder rather than comparing points. Two things
// went wrong when it counted higher scores alone: a run tying the
// leader was told it placed first, and -- because the position is read
// after the row is stored -- a greater-or-equal count made every run
// place one lower by counting itself.
func TestWhereACoopRunPlacesIsWhereTheBoardPutsIt(t *testing.T) {
	m, a, b := twoPilots(t)
	// A moving clock, because the real one moves: two runs that tie on
	// points and time are separated by when they landed, and pinning
	// the clock would be testing the id tie-break instead.
	base := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	step := 0
	m.SetClock(func() time.Time { step++; return base.Add(time.Duration(step) * time.Minute) })
	leader := addCoop(t, m, a.ID, b.ID, 5000, func(c *model.CoopScore) { c.TimeSec = 200 })

	if got := m.CoopPosition(leader); got != 1 {
		t.Fatalf("the only run on the board placed %d, want 1 — it counted itself", got)
	}

	// Same points, slower, and later: second on both counts.
	tie := addCoop(t, m, a.ID, b.ID, 5000, func(c *model.CoopScore) { c.TimeSec = 200 })
	if got := m.CoopPosition(tie); got != 2 {
		t.Fatalf("a tie with the leader placed %d, want 2 — matching the record does not take it", got)
	}
	// Same points but faster takes the place, because that is the
	// board's own tie-break.
	quick := addCoop(t, m, a.ID, b.ID, 5000, func(c *model.CoopScore) { c.TimeSec = 100 })
	if got := m.CoopPosition(quick); got != 1 {
		t.Fatalf("the faster of three ties placed %d, want 1", got)
	}
	// And the position agrees with the board, row for row.
	top, err := m.TopCoop(TopQuery{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range top {
		if got := m.CoopPosition(row.Score); got != row.Position {
			t.Fatalf("run %s is row %d on the board but places %d",
				row.Score.ID, row.Position, got)
		}
	}
	if m.CoopPosition(nil) != 0 {
		t.Fatal("a nil run should place nowhere rather than first")
	}
}

func TestAPilotFindsCoopRunsFromEitherSide(t *testing.T) {
	m, a, b := twoPilots(t)
	c, err := m.CreatePlayer("cass", "hash-c")
	if err != nil {
		t.Fatal(err)
	}
	addCoop(t, m, a.ID, b.ID, 100) // rom hosting
	addCoop(t, m, c.ID, a.ID, 200) // rom as the guest
	addCoop(t, m, b.ID, c.ID, 300) // without rom at all

	mine := m.PlayerCoopScores(a.ID, 10)
	if len(mine) != 2 {
		t.Fatalf("rom has %d co-op run(s), want 2 — one of each side", len(mine))
	}
	for _, r := range mine {
		if !r.Flew(a.ID) {
			t.Fatalf("run %s does not name rom at all", r.ID)
		}
	}
}

func TestDeletingAPilotTakesTheirCoopRunsFromEitherSide(t *testing.T) {
	m, a, b := twoPilots(t)
	c, err := m.CreatePlayer("cass", "hash-c")
	if err != nil {
		t.Fatal(err)
	}
	addCoop(t, m, a.ID, b.ID, 100) // rom hosting
	addCoop(t, m, c.ID, a.ID, 200) // rom as the guest
	keep := addCoop(t, m, b.ID, c.ID, 300)

	if err := m.DeletePlayer(a.ID); err != nil {
		t.Fatal(err)
	}
	left, err := m.TopCoop(TopQuery{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 1 || left[0].Score.ID != keep.ID {
		t.Fatalf("%d row(s) survived; a deleted pilot's name must leave the board too", len(left))
	}
}

func TestResettingAPilotTakesTheirCoopRunsAndKeepsTheAccount(t *testing.T) {
	m, a, b := twoPilots(t)
	addCoop(t, m, a.ID, b.ID, 100)
	if err := m.ResetPlayer(a.ID); err != nil {
		t.Fatal(err)
	}
	if left := m.PlayerCoopScores(a.ID, 10); len(left) != 0 {
		t.Fatalf("%d co-op run(s) survived a reset", len(left))
	}
	if _, err := m.PlayerByID(a.ID); err != nil {
		t.Fatalf("the account went with the runs: %v", err)
	}
}

func TestWipingTheBoardEmptiesBothOfThem(t *testing.T) {
	m, a, b := twoPilots(t)
	if err := m.AddScore(&model.Score{PlayerID: a.ID, Points: 10, TimeSec: 5, Levels: 1}); err != nil {
		t.Fatal(err)
	}
	addCoop(t, m, a.ID, b.ID, 20)

	n := m.ResetScores()
	if n != 2 {
		t.Fatalf("ResetScores reported %d, want 2 — both kinds are counted", n)
	}
	solo, _ := m.TopRuns(TopQuery{Limit: 10})
	pairs, _ := m.TopCoop(TopQuery{Limit: 10})
	if len(solo) != 0 || len(pairs) != 0 {
		t.Fatalf("after a wipe: %d solo and %d co-op row(s) left", len(solo), len(pairs))
	}
}

func TestTheOperatorSearchesCoopRunsByEitherName(t *testing.T) {
	m, a, b := twoPilots(t)
	one := addCoop(t, m, a.ID, b.ID, 100)
	two := addCoop(t, m, b.ID, a.ID, 200)

	for _, q := range []string{"rom", "ada", "ROM"} {
		got, total := m.ListCoopScores(q, 50, 0)
		if total != 2 || len(got) != 2 {
			t.Fatalf("searching %q found %d of %d, want 2 of 2", q, len(got), total)
		}
	}
	// Newest first, like the solo list.
	got, _ := m.ListCoopScores("", 50, 0)
	if got[0].ID != two.ID || got[1].ID != one.ID {
		t.Fatal("the operator's list is not newest first")
	}
	// An id matches from the start only. Ids are 32 hex characters, so a
	// two-letter query matching anywhere inside one lands on a
	// scattering of unrelated runs — the bug matchesScore already had.
	if _, total := m.ListCoopScores(one.ID[:8], 50, 0); total != 1 {
		t.Fatalf("an id prefix found %d run(s), want 1", total)
	}
	if _, total := m.ListCoopScores("zzzzzz", 50, 0); total != 0 {
		t.Fatal("a query that matches nothing found something")
	}
}

func TestDeletingOneCoopRunLeavesTheRest(t *testing.T) {
	m, a, b := twoPilots(t)
	gone := addCoop(t, m, a.ID, b.ID, 100)
	keep := addCoop(t, m, a.ID, b.ID, 200)

	if _, err := m.CoopScoreByID(gone.ID); err != nil {
		t.Fatalf("looking the run up before deleting it: %v", err)
	}
	if err := m.DeleteCoopScore(gone.ID); err != nil {
		t.Fatal(err)
	}
	if err := m.DeleteCoopScore(gone.ID); err != ErrNotFound {
		t.Fatalf("deleting it twice gave %v, want ErrNotFound", err)
	}
	left, _ := m.TopCoop(TopQuery{Limit: 10})
	if len(left) != 1 || left[0].Score.ID != keep.ID {
		t.Fatalf("%d row(s) left after deleting one of two", len(left))
	}
}

func TestCoopRunsSurviveASnapshot(t *testing.T) {
	m, a, b := twoPilots(t)
	c := addCoop(t, m, a.ID, b.ID, 4242, func(s *model.CoopScore) { s.PairedSec = 95.5 })

	dir := t.TempDir()
	accounts := filepath.Join(dir, "accounts.json")
	public := filepath.Join(dir, "public.json")
	if err := m.SnapshotPart(accounts, Accounts); err != nil {
		t.Fatal(err)
	}
	if err := m.SnapshotPart(public, Public); err != nil {
		t.Fatal(err)
	}

	back := NewMemory()
	if err := back.Load(accounts); err != nil {
		t.Fatal(err)
	}
	if err := back.Load(public); err != nil {
		t.Fatal(err)
	}
	got, err := back.CoopScoreByID(c.ID)
	if err != nil {
		t.Fatalf("the co-op run did not come back: %v", err)
	}
	if got.Points != 4242 || got.HostName != "rom" || got.GuestName != "ada" {
		t.Fatalf("it came back wrong: %+v", got)
	}
	if got.PairedSec != 95.5 {
		t.Fatalf("the time-flown-together was lost: %v", got.PairedSec)
	}
}

func TestStatsCountCoopRunsWithoutFoldingThemIntoTheRecord(t *testing.T) {
	m, a, b := twoPilots(t)
	if err := m.AddScore(&model.Score{PlayerID: a.ID, Points: 500, TimeSec: 5, Levels: 1}); err != nil {
		t.Fatal(err)
	}
	addCoop(t, m, a.ID, b.ID, 9_000_000)

	st := m.Stats()
	if st.CoopRuns != 1 {
		t.Fatalf("coopRuns is %d, want 1", st.CoopRuns)
	}
	if st.Runs != 1 {
		t.Fatalf("runs is %d — a co-op run is not a solo run", st.Runs)
	}
	// BEST SCORE is the solo record. A pair with twice the guns taking it
	// would make the one number on the title screen incomparable to
	// itself.
	if st.BestScore != 500 {
		t.Fatalf("the solo record became %d; a co-op score must not take it", st.BestScore)
	}
	if st.RunsToday != 2 {
		t.Fatalf("runsToday is %d, want 2 — today's activity is both kinds", st.RunsToday)
	}
}
