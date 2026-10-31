package store

import (
	"testing"
	"time"

	"github.com/rom/rivets_n_ruin/internal/model"
)

// The identity half of the store: looking a pilot up, rotating their
// token, setting a password, and the per-player views the profile page
// reads. All of it had no direct tests, which for the code that decides
// which scores belong to whom is the wrong gap to have.

func TestPlayerByNameIsCaseInsensitiveAndMissesCleanly(t *testing.T) {
	m := NewMemory()
	p := mustPlayer(t, m, "RustJack")

	for _, spelling := range []string{"RustJack", "rustjack", "RUSTJACK", "rUsTjAcK"} {
		got, err := m.PlayerByName(spelling)
		if err != nil {
			t.Fatalf("PlayerByName(%q): %v", spelling, err)
		}
		if got.ID != p.ID {
			t.Errorf("PlayerByName(%q) found a different pilot", spelling)
		}
	}
	if _, err := m.PlayerByName("nobody"); err != ErrNotFound {
		t.Errorf("a name nobody holds gave %v, want ErrNotFound", err)
	}
	// And the caller gets a copy: mutating it must not reach the store.
	got, _ := m.PlayerByName("RustJack")
	got.Name = "TAMPERED"
	again, _ := m.PlayerByName("RustJack")
	if again.Name == "TAMPERED" {
		t.Error("PlayerByName handed out the live record, not a copy")
	}
}

func TestSetPasswordMarksThePilotAsHavingOne(t *testing.T) {
	m := NewMemory()
	p := mustPlayer(t, m, "slaghound")
	if p.HasPass {
		t.Fatal("a freshly created pilot already claims a password")
	}
	if err := m.SetPassword(p.ID, "pbkdf2-sha256$1$aa$bb"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	got, _ := m.PlayerByID(p.ID)
	if !got.HasPass {
		t.Error("HasPass did not follow the hash")
	}

	// Clearing it clears the flag, so the two cannot disagree.
	if err := m.SetPassword(p.ID, ""); err != nil {
		t.Fatal(err)
	}
	got, _ = m.PlayerByID(p.ID)
	if got.HasPass {
		t.Error("HasPass stayed true with no hash behind it")
	}
	if err := m.SetPassword("no-such-pilot", "x"); err != ErrNotFound {
		t.Errorf("SetPassword on a missing pilot gave %v, want ErrNotFound", err)
	}
}

// Rotating the token has to retire the old one, or a leaked token from a
// previous session keeps working forever.
func TestSetTokenRetiresThePreviousOne(t *testing.T) {
	m := NewMemory()
	p, err := m.CreatePlayer("boltspur", "first-hash")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.PlayerByTokenHash("first-hash"); err != nil {
		t.Fatalf("the original token does not resolve: %v", err)
	}

	if err := m.SetToken(p.ID, "second-hash"); err != nil {
		t.Fatalf("SetToken: %v", err)
	}
	if _, err := m.PlayerByTokenHash("first-hash"); err != ErrNotFound {
		t.Error("the old token still resolves after rotation")
	}
	got, err := m.PlayerByTokenHash("second-hash")
	if err != nil || got.ID != p.ID {
		t.Errorf("the new token does not resolve: %v", err)
	}
	if err := m.SetToken("no-such-pilot", "x"); err != ErrNotFound {
		t.Errorf("SetToken on a missing pilot gave %v, want ErrNotFound", err)
	}
}

func TestTouchPlayerMovesLastSeenForward(t *testing.T) {
	m := NewMemory()
	at := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	m.now = func() time.Time { return at }
	p := mustPlayer(t, m, "drosskite")

	at = at.Add(3 * time.Hour)
	if err := m.TouchPlayer(p.ID); err != nil {
		t.Fatalf("TouchPlayer: %v", err)
	}
	got, _ := m.PlayerByID(p.ID)
	if !got.LastSeen.Equal(at) {
		t.Errorf("LastSeen is %v, want %v", got.LastSeen, at)
	}
	if err := m.TouchPlayer("no-such-pilot"); err != ErrNotFound {
		t.Errorf("TouchPlayer on a missing pilot gave %v, want ErrNotFound", err)
	}
}

func TestPlayerRankIsThePositionOnTheBoard(t *testing.T) {
	m := NewMemory()
	var ids []string
	for i, points := range []int{500, 9000, 3000} {
		p := mustPlayer(t, m, string(rune('a'+i)))
		ids = append(ids, p.ID)
		if err := m.AddScore(&model.Score{PlayerID: p.ID, Points: points, TimeSec: 60}); err != nil {
			t.Fatal(err)
		}
	}
	for want, id := range []string{ids[1], ids[2], ids[0]} {
		r, err := m.PlayerRank(id, "", model.WindowAll)
		if err != nil {
			t.Fatalf("PlayerRank: %v", err)
		}
		if r.Position != want+1 {
			t.Errorf("pilot %d placed %d, want %d", want, r.Position, want+1)
		}
	}
	// A pilot with no score has no place, rather than last place.
	quiet := mustPlayer(t, m, "quiet")
	if _, err := m.PlayerRank(quiet.ID, "", model.WindowAll); err != ErrNotFound {
		t.Errorf("a pilot who has not flown was ranked: %v", err)
	}
}

func TestPlayerRankIsPerModAndPerWindow(t *testing.T) {
	m := NewMemory()
	at := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	m.now = func() time.Time { return at }

	big := mustPlayer(t, m, "big")
	small := mustPlayer(t, m, "small")
	if err := m.AddScore(&model.Score{PlayerID: big.ID, Points: 9000, TimeSec: 60}); err != nil {
		t.Fatal(err)
	}
	at = at.Add(48 * time.Hour)
	if err := m.AddScore(&model.Score{PlayerID: small.ID, Points: 10, TimeSec: 60}); err != nil {
		t.Fatal(err)
	}

	// All time: the big score leads. Last day: it has aged out, so the
	// small one does.
	if r, _ := m.PlayerRank(big.ID, "", model.WindowAll); r.Position != 1 {
		t.Errorf("all-time: the big score placed %d", r.Position)
	}
	if r, _ := m.PlayerRank(small.ID, "", model.WindowDay); r == nil || r.Position != 1 {
		t.Error("in the last day, the only recent score did not place first")
	}
	if _, err := m.PlayerRank(big.ID, "", model.WindowDay); err != ErrNotFound {
		t.Error("a two-day-old score still placed in the last day")
	}
	// A mod board nobody has played is empty rather than wrong.
	if _, err := m.PlayerRank(big.ID, "some-mod", model.WindowAll); err != ErrNotFound {
		t.Error("a score placed on a mod board it was not set on")
	}
}

func TestPlayerScoresAreTheirOwn(t *testing.T) {
	m := NewMemory()
	mine := mustPlayer(t, m, "mine")
	theirs := mustPlayer(t, m, "theirs")
	for i := 0; i < 5; i++ {
		if err := m.AddScore(&model.Score{PlayerID: mine.ID, Points: 100 * i, TimeSec: 10}); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.AddScore(&model.Score{PlayerID: theirs.ID, Points: 99999, TimeSec: 10}); err != nil {
		t.Fatal(err)
	}

	got, err := m.PlayerScores(mine.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 5 {
		t.Fatalf("got %d scores, want 5", len(got))
	}
	for _, s := range got {
		if s.PlayerID != mine.ID {
			t.Error("somebody else's score came back in this pilot's history")
		}
	}

	// The limit is honoured, and a silly one falls back rather than
	// returning everything or nothing.
	if got, _ := m.PlayerScores(mine.ID, 2); len(got) != 2 {
		t.Errorf("limit 2 returned %d", len(got))
	}
	for _, limit := range []int{0, -1, 1000} {
		got, err := m.PlayerScores(mine.ID, limit)
		if err != nil {
			t.Fatalf("limit %d: %v", limit, err)
		}
		if len(got) != 5 {
			t.Errorf("limit %d returned %d scores, want all 5 under the default", limit, len(got))
		}
	}
	// A pilot nobody has heard of has no history, not an error.
	if got, err := m.PlayerScores("nobody", 10); err != nil || len(got) != 0 {
		t.Errorf("an unknown pilot gave %d scores, %v", len(got), err)
	}
}

func TestListModsSortsAndLimits(t *testing.T) {
	m := NewMemory()
	p := mustPlayer(t, m, "author")
	for i, name := range []string{"quiet", "popular", "middling"} {
		mod := &model.Mod{ID: name, Name: name, AuthorID: p.ID}
		if err := m.CreateMod(mod); err != nil {
			t.Fatal(err)
		}
		for j := 0; j < i*5; j++ {
			if err := m.IncrementPlays(name); err != nil {
				t.Fatal(err)
			}
		}
	}

	byPlays, err := m.ListMods(10, "plays")
	if err != nil {
		t.Fatal(err)
	}
	if len(byPlays) != 3 {
		t.Fatalf("listed %d mods, want 3", len(byPlays))
	}
	if byPlays[0].ID != "middling" {
		t.Errorf("sorted by plays, the most played is %q", byPlays[0].ID)
	}
	if byPlays[0].Plays != 10 {
		t.Errorf("play count is %d, want 10", byPlays[0].Plays)
	}

	if got, _ := m.ListMods(1, "plays"); len(got) != 1 {
		t.Error("the limit was not honoured")
	}
	for _, limit := range []int{0, -5, 9999} {
		if got, _ := m.ListMods(limit, "plays"); len(got) != 3 {
			t.Errorf("limit %d returned %d mods", limit, len(got))
		}
	}
	if err := m.IncrementPlays("no-such-mod"); err != ErrNotFound {
		t.Errorf("IncrementPlays on a missing mod gave %v, want ErrNotFound", err)
	}
}
