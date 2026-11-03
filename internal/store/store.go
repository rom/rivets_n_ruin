// Package store defines persistence for players, scores, mods and presence.
//
// The interface exists so the memory implementation can be swapped for SQL
// without touching the API layer. See memory.go for what the current one does
// and does not promise.
package store

import (
	"errors"
	"time"

	"github.com/rom/rivets_n_ruin/internal/model"
)

// PresenceTTL is how long a pilot stays "flying" after their last heartbeat.
// The client beats every 5s, so this tolerates two dropped beats.
const PresenceTTL = 16 * time.Second

var (
	ErrNotFound  = errors.New("not found")
	ErrNameTaken = errors.New("name already taken")
	ErrConflict  = errors.New("conflict")
)

// TopQuery selects a slice of the leaderboard.
type TopQuery struct {
	ModID  string // "" = stock hull; "*" = every mod pooled
	Window model.Window
	Limit  int
}

type Store interface {
	CreatePlayer(name, tokenHash string) (*model.Player, error)
	PlayerByID(id string) (*model.Player, error)
	PlayerByTokenHash(hash string) (*model.Player, error)
	TouchPlayer(id string) error
	PlayerByName(name string) (*model.Player, error)
	SetPassword(id, passHash string) error
	SetToken(id, tokenHash string) error

	AddScore(s *model.Score) error
	Top(q TopQuery) ([]model.Rank, error)
	// TopRuns is Top without the per-player fold: the best individual runs,
	// so one exceptional pilot can hold several places.
	TopRuns(q TopQuery) ([]model.Rank, error)
	PlayerRank(playerID, modID string, w model.Window) (*model.Rank, error)
	PlayerScores(playerID string, limit int) ([]model.Score, error)

	CreateMod(m *model.Mod) error
	ModByID(id string) (*model.Mod, error)
	ListMods(limit int, sortBy string) ([]model.Mod, error)
	IncrementPlays(modID string) error

	// --- administration
	//
	// Deliberately not reachable from any pilot-facing route. Listing
	// is the one operation the public API must never offer, because it
	// is enumeration by definition; an operator holding the admin
	// credential is the one caller for whom that is the point.
	ListPlayers(query string, limit int) []model.Player
	// DeletePlayer removes the pilot and everything of theirs: scores,
	// hangar, token and password. A delete that leaves the scores
	// behind leaves the name behind with them, on the one page that is
	// published.
	DeletePlayer(id string) error
	// ResetPlayer clears a pilot's history and belongings but keeps the
	// account and its credential, for the case where someone wants a
	// clean slate rather than to be gone.
	ResetPlayer(id string) error
	// SetPlayerStats overwrites a pilot's counters. The counters are a
	// cache: the leaderboard is computed from the recorded runs, and
	// nothing here touches those. An operator who sets a best that no
	// recorded run supports has made the two disagree on purpose, so
	// the API hands back both numbers rather than hiding one.
	SetPlayerStats(id string, runs, best int) error

	// --- the recorded runs, as an operator sees them
	//
	// ListScores is the admin's view of the whole table, newest first:
	// everything AddScore has ever taken, not one player's slice of it
	// and not the leaderboard's fold. `query` matches a pilot name or
	// an id, either partially.
	ListScores(query string, limit, offset int) ([]model.Score, int)
	ScoreByID(id string) (*model.Score, error)
	// DeleteScore removes one recorded run and recomputes the owner's
	// counters from what is left. A delete that left Best alone would
	// leave the cheated number on the pilot's card after the run behind
	// it was gone, which is the one thing this is for.
	DeleteScore(id string) error
	// ResetScores drops every recorded run and zeroes every pilot's
	// counters, leaving the accounts themselves alone. Returns how many
	// runs went. This is the blunt instrument; DeleteScore is the one
	// to reach for first.
	ResetScores() int

	// What a pilot owns between runs. Never nil: a pilot who has banked
	// nothing reads as empty rather than missing, so every caller has
	// one case fewer.
	Hangar(playerID string) *model.Hangar
	// SetHangar clamps before it stores and returns what was kept, so a
	// client that sent something out of range learns it rather than
	// drifting out of step.
	SetHangar(playerID string, h *model.Hangar) *model.Hangar
	DeleteHangar(playerID string)

	Heartbeat(p model.Presence) error
	LivePresence() []model.Presence

	Stats() Stats

	Snapshot(path string) error
	Load(path string) error
}

// Stats is the global counter block the client shows on the title screen.
type Stats struct {
	Players   int    `json:"players"`
	Runs      int    `json:"runs"`
	RunsToday int    `json:"runsToday"`
	Mods      int    `json:"mods"`
	FlyingNow int    `json:"flyingNow"`
	BestScore int    `json:"bestScore"`
	BestPilot string `json:"bestPilot"`
}
