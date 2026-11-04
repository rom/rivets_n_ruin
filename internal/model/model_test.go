package model

import (
	"testing"
	"time"
)

func TestWindowSince(t *testing.T) {
	now := time.Date(2026, 3, 14, 15, 9, 26, 0, time.UTC)
	cases := []struct {
		w    Window
		want time.Time
	}{
		{WindowDay, now.Add(-24 * time.Hour)},
		{WindowWeek, now.Add(-7 * 24 * time.Hour)},
		// The zero time means "no cutoff", which is what every caller
		// tests for. A window that returned `now` for all-time would
		// quietly hide every score ever set.
		{WindowAll, time.Time{}},
		{Window("nonsense"), time.Time{}},
		{Window(""), time.Time{}},
	}
	for _, c := range cases {
		if got := c.w.Since(now); !got.Equal(c.want) {
			t.Errorf("Window(%q).Since = %v, want %v", c.w, got, c.want)
		}
	}
	if !WindowAll.Since(now).IsZero() {
		t.Error("all-time has a cutoff, so it is not all time")
	}
}

// Lenient on purpose: a query string is user input, and an unrecognised
// window should show the all-time board rather than 400.
func TestParseWindowIsLenient(t *testing.T) {
	cases := map[string]Window{
		"day": WindowDay, "week": WindowWeek, "all": WindowAll,
		"": WindowAll, "DAY": WindowAll, "month": WindowAll,
		"../../etc/passwd": WindowAll, "all; drop table": WindowAll,
	}
	for in, want := range cases {
		if got := ParseWindow(in); got != want {
			t.Errorf("ParseWindow(%q) = %q, want %q", in, got, want)
		}
	}
}

// Flew is what makes a co-op run findable from either pilot's side, and
// what makes deleting a pilot take it with them. An empty id matching
// anything would quietly delete every co-op run on the board the first
// time a caller passed one in.
func TestFlewNamesEitherPilotAndNobodyElse(t *testing.T) {
	c := &CoopScore{HostID: "h", GuestID: "g"}
	for _, id := range []string{"h", "g"} {
		if !c.Flew(id) {
			t.Fatalf("%q flew this run and Flew says otherwise", id)
		}
	}
	for _, id := range []string{"", "x", "H", "hg"} {
		if c.Flew(id) {
			t.Fatalf("%q did not fly this run and Flew says they did", id)
		}
	}
	// Both sides empty is the shape a half-built row has; an empty id
	// must still not match it.
	if (&CoopScore{}).Flew("") {
		t.Fatal("an empty id matched an empty row")
	}
}
