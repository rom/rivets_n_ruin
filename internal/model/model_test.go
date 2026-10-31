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
