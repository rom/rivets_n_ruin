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
