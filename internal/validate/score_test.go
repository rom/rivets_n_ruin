package validate

import (
	"strings"
	"testing"
)

func TestMinCompletionSec(t *testing.T) {
	one := MinCompletionSec(1)
	if one < 60 || one > 120 {
		t.Fatalf("one-hull minimum %.1fs is outside the plausible 60-120s band", one)
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
	// and it must still be a ceiling, not a blank cheque
	if err := Score(Submission{Points: 50_000_000, TimeSec: 400, Completed: true, Levels: 3}); err == nil {
		t.Fatal("ceiling no longer rejects an absurd score")
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
		{"completed faster than physics allows", Submission{Points: 9000, TimeSec: 3, Completed: true}, "cannot be flown"},
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
	if ceiling > 5_000_000 {
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
