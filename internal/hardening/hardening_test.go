package hardening

import (
	"strings"
	"testing"
)

// The portable half: mode parsing, the report, and the root policy.
// These run on every platform, because the decisions they encode are
// not platform-specific and getting them wrong is how a server ends up
// either refusing to boot or quietly unprotected.

func TestParseMode(t *testing.T) {
	for in, want := range map[string]Mode{
		"": Auto, "auto": Auto, "AUTO": Auto, "  auto  ": Auto,
		"require": Require, "strict": Require,
		"off": Off, "none": Off,
	} {
		got, err := ParseMode(in)
		if err != nil {
			t.Errorf("ParseMode(%q): %v", in, err)
		}
		if got != want {
			t.Errorf("ParseMode(%q) = %v, want %v", in, got, want)
		}
	}
	if _, err := ParseMode("yes-please"); err == nil {
		t.Error("an unknown mode was accepted, so a typo would silently disable hardening")
	}
}

func TestOffAppliesNothingAndSaysSo(t *testing.T) {
	rep, err := Apply(Config{Mode: Off})
	if err != nil {
		t.Fatalf("mode=off should never fail: %v", err)
	}
	if len(rep.Applied) != 0 {
		t.Errorf("mode=off applied %v", rep.Applied)
	}
	if len(rep.Skipped) == 0 {
		t.Error("mode=off reported nothing at all, so the state is invisible")
	}
}

// Running as root is worth shouting about and not worth refusing over by
// default: containers very commonly start as root, and a server that
// will not boot there is one people run with -harden=off instead.
func TestRootIsReportedNotFatalUnderAuto(t *testing.T) {
	rep, err := Apply(Config{Mode: Auto, AllowRoot: false})
	if err != nil {
		t.Fatalf("auto mode should not fail on the root check: %v", err)
	}
	all := strings.Join(append(rep.Applied, rep.Skipped...), " ")
	if !strings.Contains(all, "ROOT") && !strings.Contains(all, "unprivileged") {
		t.Errorf("the report says nothing about privilege: %v", rep)
	}
}

func TestAllowRootSuppressesTheComplaint(t *testing.T) {
	rep, err := Apply(Config{Mode: Auto, AllowRoot: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range rep.Skipped {
		if strings.Contains(s, "ROOT") {
			t.Errorf("-allow-root was set and it still complained: %q", s)
		}
	}
}

func TestReportReadsAsASentence(t *testing.T) {
	// It goes into a log line and into /api/stats; "" or "[]" there is
	// how a hardening layer becomes invisible and then becomes broken.
	rep := Report{Applied: []string{"a", "b"}, Skipped: []string{"c"}}
	s := rep.String()
	for _, want := range []string{"a", "b", "c", "unavailable"} {
		if !strings.Contains(s, want) {
			t.Errorf("Report.String() = %q, missing %q", s, want)
		}
	}
	if (Report{}).String() != "none" {
		t.Errorf("an empty report reads as %q", (Report{}).String())
	}
}

func TestModeNames(t *testing.T) {
	for m, want := range map[Mode]string{Auto: "auto", Require: "require", Off: "off"} {
		if m.String() != want {
			t.Errorf("Mode(%d).String() = %q, want %q", m, m.String(), want)
		}
	}
}
