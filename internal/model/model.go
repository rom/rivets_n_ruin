// Package model holds the types shared by the store and the HTTP API.
package model

import (
	"encoding/json"
	"time"
)

// Player is an identity. There are no passwords: registration mints a bearer
// token, the server keeps only its hash, and the client keeps the token in
// localStorage. That is the right weight for a score board — it stops casual
// impersonation and nothing more.
type Player struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	TokenHash string    `json:"-"` // never leaves the process
	PassHash  string    `json:"-"` // likewise; empty for legacy token-only pilots
	Created   time.Time `json:"created"`
	LastSeen  time.Time `json:"lastSeen"`
	Runs      int       `json:"runs"`
	Best      int       `json:"best"`
	HasPass   bool      `json:"hasPassword"`
}

// Hangar is what a pilot owns between runs: banked currency and the
// permanent systems they have bought. It is the one piece of progress
// the game describes as surviving a lost ship, and until now it lived
// only in the browser's localStorage — so it did not survive a new
// browser, a cleared cache or a second machine, which is most of what
// an account is for.
//
// Stored with the account rather than with the leaderboards: it is
// per-pilot data, it follows the account's backup policy, and deleting
// a pilot has to take it with them.
//
// Client-authoritative, like the localStorage copy it replaces. A pilot
// who edits it gives themselves a better ship, which affects their own
// run and nothing else; submitted scores go through the run validator
// either way. The caps exist so a corrupt or hand-edited value cannot
// put the HUD or the shop into a state it cannot render.
type Hangar struct {
	Coins   int            `json:"coins"`
	Bars    int            `json:"bars"`
	Mods    map[string]int `json:"mods"`
	Updated time.Time      `json:"updated"`
}

// Score is one completed or failed run.
type Score struct {
	ID        string    `json:"id"`
	PlayerID  string    `json:"playerId"`
	Name      string    `json:"name"`  // denormalised: top lists are read far more than written
	ModID     string    `json:"modId"` // "" means the stock hull
	Points    int       `json:"points"`
	TimeSec   float64   `json:"timeSec"`
	Turrets   int       `json:"turrets"`
	Deaths    int       `json:"deaths"`
	Completed bool      `json:"completed"`
	Levels    int       `json:"levels"` // hulls reached this run
	Created   time.Time `json:"created"`
}

// CoopScore is one co-op run: two pilots, one hull, one score.
//
// A separate type and a separate board, not a Score with a second name
// bolted on. The reason is the one the README used to give for not
// recording co-op at all: a solo score answers "how far did this pilot
// get", and a pair's score answers a different question. Folding them
// together would mean either crediting one pilot for two people's work
// or splitting a score that was never two scores. So co-op runs are
// recorded in full, on their own board, and they do not touch a
// pilot's solo card -- Player.Runs and Player.Best stay solo.
//
// Both ids are kept, so either pilot's page can find the run and
// deleting either pilot takes it with them. Both names are
// denormalised for the same reason Score.Name is: the board is read
// far more often than it is written.
type CoopScore struct {
	ID        string  `json:"id"`
	HostID    string  `json:"hostId"`
	HostName  string  `json:"hostName"`
	GuestID   string  `json:"guestId"`
	GuestName string  `json:"guestName"`
	Points    int     `json:"points"`
	TimeSec   float64 `json:"timeSec"`
	Turrets   int     `json:"turrets"`
	Deaths    int     `json:"deaths"`
	Completed bool    `json:"completed"`
	Levels    int     `json:"levels"`
	// How long the two were actually connected to each other, in
	// seconds. Recorded rather than assumed: a guest who drops out at
	// the first hull did not fly the run the board says they did, and
	// the honest thing is to keep the number that shows it. See
	// submitCoopScore for the rule it has to clear.
	PairedSec float64   `json:"pairedSec"`
	Created   time.Time `json:"created"`
}

// Flew reports whether a pilot was one of this run's two.
func (c *CoopScore) Flew(playerID string) bool {
	return playerID != "" && (c.HostID == playerID || c.GuestID == playerID)
}

// Mod is a shareable variant of the game. The game is already seed-driven and
// entirely configured from src/config.js, so a mod is exactly those two things:
// a hull seed plus a set of config overrides.
type Mod struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Author   string          `json:"author"`
	AuthorID string          `json:"authorId"`
	Seed     int64           `json:"seed"`
	Config   json.RawMessage `json:"config"`
	Notes    string          `json:"notes"`
	Created  time.Time       `json:"created"`
	Plays    int             `json:"plays"`
}

// Presence is a live pilot. Entries expire; see store.PresenceTTL.
type Presence struct {
	PlayerID string    `json:"playerId"`
	Name     string    `json:"name"`
	ModID    string    `json:"modId"`
	Progress float64   `json:"progress"` // 0..1 along the hull
	Score    int       `json:"score"`
	Updated  time.Time `json:"updated"`
}

// Window selects a time range for a top list.
type Window string

const (
	WindowDay  Window = "day"
	WindowWeek Window = "week"
	WindowAll  Window = "all"
)

// Since converts a window to its cutoff. The zero time means "no cutoff".
func (w Window) Since(now time.Time) time.Time {
	switch w {
	case WindowDay:
		return now.Add(-24 * time.Hour)
	case WindowWeek:
		return now.Add(-7 * 24 * time.Hour)
	default:
		return time.Time{}
	}
}

// ParseWindow is lenient: anything unrecognised means all-time.
func ParseWindow(s string) Window {
	switch Window(s) {
	case WindowDay:
		return WindowDay
	case WindowWeek:
		return WindowWeek
	default:
		return WindowAll
	}
}

// CoopRank is a co-op leaderboard entry.
//
// Its own type rather than a Rank holding an `any`: the co-op board has
// one row per run and two names on it, and a reader of the JSON should
// not have to work out which shape arrived.
type CoopRank struct {
	Position int        `json:"position"`
	Score    *CoopScore `json:"score"`
}

// Rank is a leaderboard entry: a score plus its position.
type Rank struct {
	Position int    `json:"position"`
	Score    *Score `json:"score"`
}
