package validate

import (
	"strings"
	"testing"
)

func TestMinCompletionSec(t *testing.T) {
	got := MinCompletionSec()
	// ~22.9k px of travel at 310 px/s. Sanity-bound it so a tuning change
	// that makes this absurd fails here rather than silently letting
	// impossible runs onto the board.
	if got < 60 || got > 120 {
		t.Fatalf("minimum completion %.1fs is outside the plausible 60-120s band", got)
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
	min := MinCompletionSec()
	if err := Score(Submission{Points: 9000, TimeSec: min - 0.1, Completed: true}); err == nil {
		t.Fatal("accepted a completion just under the physical minimum")
	}
	if err := Score(Submission{Points: 9000, TimeSec: min + 0.1, Completed: true}); err != nil {
		t.Fatalf("rejected a completion just over the physical minimum: %v", err)
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
