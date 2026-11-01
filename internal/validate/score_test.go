package validate

import (
	"strings"
	"testing"
)

func TestMinCompletionSec(t *testing.T) {
	// A hull is flown one way now, not out and back, so the floor for the
	// first one is roughly half what it was. The band is still a sanity
	// check on the model rather than a measurement: 12,000px at the
	// starting top speed cannot be under half a minute, and if it ever
	// reads over a minute the distance or the speed is wrong.
	one := MinCompletionSec(1)
	if one < 30 || one > 60 {
		t.Fatalf("one-hull minimum %.1fs is outside the plausible 30-60s band", one)
	}
	// More hulls must take strictly longer, even though the ship speeds up.
	prev := one
	for n := 2; n <= NumLevels(); n++ {
		got := MinCompletionSec(n)
		if got <= prev {
			t.Fatalf("minimum for %d hulls (%.1fs) is not greater than for %d (%.1fs)", n, got, n-1, prev)
		}
		prev = got
	}
	// Out-of-range inputs clamp rather than panic.
	if MinCompletionSec(0) != one {
		t.Fatal("levels=0 should be treated as 1")
	}
	if MinCompletionSec(99) != MinCompletionSec(NumLevels()) {
		t.Fatal("levels beyond the campaign should clamp")
	}
}

// A full campaign accumulates score across hulls while its clock keeps
// running; the ceiling has to admit that or every finished run is rejected.
func TestFullCampaignAccepted(t *testing.T) {
	s := Submission{Points: 41892, TimeSec: 300, Turrets: 60, Completed: true, Levels: 3}
	if err := Score(s); err != nil {
		t.Fatalf("rejected a legitimate three-hull campaign: %v", err)
	}
}

func TestCampaignCompletionBoundary(t *testing.T) {
	min := MinCompletionSec(3)
	if err := Score(Submission{Points: 40000, TimeSec: min - 1, Completed: true, Levels: 3}); err == nil {
		t.Fatal("accepted a three-hull campaign faster than physically possible")
	}
	if err := Score(Submission{Points: 40000, TimeSec: min + 1, Completed: true, Levels: 3}); err != nil {
		t.Fatalf("rejected a campaign just over the minimum: %v", err)
	}
}

// Bosses are a large chunk of a finished run's score. A campaign that kills
// all three must fit under the ceiling, or every completed run is rejected.
func TestBossScoresFitTheCeiling(t *testing.T) {
	bosses := 0
	for _, r := range BossRewards {
		bosses += r
	}
	if bosses < 20000 {
		t.Fatalf("boss rewards total %d, which looks out of step with src/config.js", bosses)
	}
	s := Submission{Points: 60444, TimeSec: 400, Turrets: 60, Completed: true, Levels: 3}
	if err := Score(s); err != nil {
		t.Fatalf("rejected a campaign that killed all three bosses: %v", err)
	}
	// and it must still be a ceiling, not a blank cheque. The bound moved
	// a long way out when the loot economy was finally modelled — a real
	// single-hull run scores 4.6 million — so the absurd figure it has to
	// reject moved with it.
	ceiling := MaxPlausiblePoints(s)
	if err := Score(Submission{Points: ceiling * 4, TimeSec: 400, Completed: true, Levels: 3}); err == nil {
		t.Fatalf("ceiling of %d no longer rejects four times itself", ceiling)
	}
}

func TestTooManyLevelsRejected(t *testing.T) {
	if err := Score(Submission{Points: 10, TimeSec: 100, Levels: 99}); err == nil {
		t.Fatal("accepted more hulls than the campaign has")
	}
}

func TestScoreAcceptsRealisticRuns(t *testing.T) {
	cases := []struct {
		name string
		s    Submission
	}{
		{"failed early run", Submission{Points: 300, TimeSec: 12, Turrets: 2}},
		{"solid completed run", Submission{Points: 14039, TimeSec: 95, Turrets: 11, Completed: true}},
		{"long grind", Submission{Points: 40000, TimeSec: 600, Turrets: 25, Deaths: 2}},
		{"pickup-heavy run", Submission{Points: 120000, TimeSec: 300, Turrets: 30, Completed: true}},
		{"zero everything", Submission{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := Score(c.s); err != nil {
				t.Fatalf("rejected a legitimate run: %v", err)
			}
		})
	}
}

func TestScoreRejectsImpossibleRuns(t *testing.T) {
	cases := []struct {
		name string
		s    Submission
		want string
	}{
		{"negative points", Submission{Points: -1}, "negative"},
		{"negative time", Submission{TimeSec: -5}, "negative"},
		{"absurd score", Submission{Points: 1 << 30, TimeSec: 90, Completed: true}, "exceeds"},
		{"too many turrets", Submission{Turrets: 5000}, "exceeds"},
		{"completed faster than physics allows", Submission{Points: 9000, TimeSec: 3, Completed: true}, "full throttle"},
		{"negative deaths", Submission{Deaths: -2}, "negative"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := Score(c.s)
			if err == nil {
				t.Fatalf("accepted an impossible run")
			}
			if !strings.Contains(err.Error(), c.want) {
				t.Fatalf("error %q does not mention %q", err, c.want)
			}
		})
	}
}

// The boundary is the interesting part: one tick under the physical minimum
// must fail, one tick over must pass.
func TestCompletionBoundary(t *testing.T) {
	min := MinCompletionSec(1)
	if err := Score(Submission{Points: 9000, TimeSec: min - 0.1, Completed: true}); err == nil {
		t.Fatal("accepted a completion just under the physical minimum")
	}
	if err := Score(Submission{Points: 9000, TimeSec: min + 0.1, Completed: true}); err != nil {
		t.Fatalf("rejected a completion just over the physical minimum: %v", err)
	}
}

// Pickups raise the ceiling; a run that collects every drop must still be
// accepted, and the ceiling must still be finite.
func TestPickupsRaiseTheCeiling(t *testing.T) {
	base := Submission{TimeSec: 120, Completed: true}
	ceiling := MaxPlausiblePoints(base)
	if ceiling < 50000 {
		t.Fatalf("ceiling %d looks too low to admit a pickup-heavy run", ceiling)
	}
	// The band is wide because the economy is: a real two-minute hull has
	// scored 4.6 million, so a ceiling under about ten million would be
	// rejecting people who actually played. Above about forty million it
	// stops bounding anything worth bounding.
	if ceiling < 10_000_000 {
		t.Fatalf("ceiling %d would reject a real 4.6-million single-hull run", ceiling)
	}
	if ceiling > 40_000_000 {
		t.Fatalf("ceiling %d is so loose it validates nothing", ceiling)
	}
	if err := Score(Submission{Points: ceiling - 1, TimeSec: 120, Completed: true}); err != nil {
		t.Fatalf("rejected a run just under the ceiling: %v", err)
	}
	if err := Score(Submission{Points: ceiling + 1, TimeSec: 120, Completed: true}); err == nil {
		t.Fatal("accepted a run just over the ceiling")
	}
}

func TestPlayerName(t *testing.T) {
	ok := []string{"rom", "  padded  ", "Ace", "日本語", "x_y-z 12"}
	for _, n := range ok {
		if _, err := PlayerName(n); err != nil {
			t.Errorf("PlayerName(%q) rejected: %v", n, err)
		}
	}
	bad := []string{"", "a", strings.Repeat("x", 17), "bad\x00name", "nul\nnewline", "zero​width"}
	for _, n := range bad {
		if _, err := PlayerName(n); err == nil {
			t.Errorf("PlayerName(%q) accepted but should not be", n)
		}
	}
	got, err := PlayerName("  spaced  ")
	if err != nil || got != "spaced" {
		t.Errorf("PlayerName did not trim: got %q err %v", got, err)
	}
}

// The run that found all of this. A player restarted on AURUM (the eighth
// hull), flew that one hull, finished it in 256.8s and scored 4,650,367 —
// and the validator threw it away twice over: it read "levels: 8" as eight
// hulls flown and demanded 370s for them, and its points ceiling was a
// third of what the hull can actually pay out. The end screen then showed
// SENDING RUN... forever, so the rejection was invisible.
//
// Every number here is from that submission. If this test ever fails, a
// real player's best run is being refused again.
func TestTheRunThatWasWronglyRefused(t *testing.T) {
	real := Submission{
		Points: 4650367, TimeSec: 256.8, Turrets: 314, Deaths: 1,
		Completed: true, Levels: 8, HullsFlown: 1,
	}
	if err := Score(real); err != nil {
		t.Fatalf("refused a run that was really flown: %v", err)
	}

	// Same run claiming it flew all eight hulls in that time: impossible,
	// and still caught.
	lying := real
	lying.HullsFlown = 8
	if err := Score(lying); err == nil {
		t.Fatal("accepted eight hulls flown in 256.8s")
	}

	// A client that does not send hullsFlown at all is assumed to have
	// flown everything it reached — the old, strict reading. That must
	// stay available, or old clients start getting 422s.
	old := real
	old.HullsFlown = 0
	if err := Score(old); err == nil {
		t.Fatal("accepted eight implied hulls in 256.8s")
	}
}

// hullsFlown is a claim by the client, so it has to be bounded: a run
// cannot have flown more hulls than it reached, and a nonsense value must
// fall back to the strict reading rather than widening the window.
func TestHullsFlownIsBounded(t *testing.T) {
	for _, n := range []int{-5, 0, 99, 1 << 20} {
		s := Submission{Levels: 4, HullsFlown: n}
		if got := s.hullsFlown(); got != 4 {
			t.Errorf("HullsFlown %d: got %d hulls, want the strict 4", n, got)
		}
	}
	if got := (Submission{Levels: 4, HullsFlown: 2}).hullsFlown(); got != 2 {
		t.Errorf("an honest claim of 2 hulls read as %d", got)
	}
}

// The floor must be a one-way trip. It once modelled a return leg that the
// game no longer has, which was harmless over one hull and rejected honest
// completions over twenty-five.
//
// The bound checked here does not restate the formula: whatever the model
// says, no hull can take longer to cross than its full length at the
// slowest the ship ever flies, because the ship is never slower than
// BaseMaxVX and never has to cover more than the whole hull. A floor above
// that line is refusing runs that physics allows.
func TestMinRunSecIsAOneWayTrip(t *testing.T) {
	for n := range HullLengths {
		floor := minHullSec(n)
		ceiling := HullLengths[n] / BaseMaxVX
		if floor >= ceiling {
			t.Errorf("hull %d: floor %.1fs is not under %.1fs, the whole hull at base speed",
				n, floor, ceiling)
		}
	}
}

// A run over more hulls must take longer, and the window must only ever
// cover the hulls actually flown.
func TestMinRunSecCoversOnlyTheHullsFlown(t *testing.T) {
	one := minRunSec(0, 0)
	if one <= 0 {
		t.Fatalf("one hull has no minimum time: %v", one)
	}
	all := minRunSec(0, len(HullLengths)-1)
	if all <= one {
		t.Fatalf("flying every hull (%.1fs) is not slower than one (%.1fs)", all, one)
	}
	// Starting late must cost less than starting at the beginning, or
	// restarting on a later hull is punished for hulls it never flew.
	late := minRunSec(len(HullLengths)-1, len(HullLengths)-1)
	if late >= all {
		t.Fatalf("one late hull (%.1fs) is not cheaper than the campaign (%.1fs)", late, all)
	}
	// Out-of-range ends clamp rather than panic or run away.
	if got := minRunSec(-3, 0); got != one {
		t.Errorf("minRunSec(-3, 0) = %.3f, want the clamped %.3f", got, one)
	}
	if got := minRunSec(0, 1<<20); got != all {
		t.Errorf("minRunSec(0, huge) = %.3f, want the clamped %.3f", got, all)
	}
}

// ModName is the one validator the mod endpoints use and nothing else
// covered it, so a mod could be published under a name no leaderboard
// could render.
func TestModName(t *testing.T) {
	ok := []string{"SCRAPYARD", "a b", "日本語", "x-y_z 12", "  trimmed  "}
	for _, n := range ok {
		if _, err := ModName(n); err != nil {
			t.Errorf("ModName(%q) rejected: %v", n, err)
		}
	}
	bad := []string{"", "a", strings.Repeat("x", 200), "nul\x00byte", "two\nlines"}
	for _, n := range bad {
		if _, err := ModName(n); err == nil {
			t.Errorf("ModName(%q) accepted", n)
		}
	}
	got, err := ModName("  spaced  ")
	if err != nil || got != "spaced" {
		t.Errorf("ModName did not trim: %q, %v", got, err)
	}
}
