package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/rom/rivets_n_ruin/internal/model"
)

// Memory is an in-process store guarded by a single RWMutex, with the whole
// dataset snapshotted to JSON.
//
// This is deliberate for a game at this stage: it has no dependencies, it
// handles many concurrent players correctly because a leaderboard is tiny and
// read-dominated, and the Store interface means moving to SQL later is a
// localised change. What it does NOT do: survive beyond one process (no
// horizontal scaling), bound memory (everything is resident), or index
// anything (top lists sort on read). At a few hundred thousand scores that
// stops being acceptable and the sort wants replacing with a heap per bucket.
type Memory struct {
	mu sync.RWMutex

	players  map[string]*model.Player
	byToken  map[string]string // tokenHash -> playerID
	byName   map[string]string // lowercased name -> playerID
	scores   []*model.Score
	mods     map[string]*model.Mod
	presence map[string]model.Presence
	now      func() time.Time
}

func NewMemory() *Memory {
	return &Memory{
		players:  map[string]*model.Player{},
		byToken:  map[string]string{},
		byName:   map[string]string{},
		mods:     map[string]*model.Mod{},
		presence: map[string]model.Presence{},
		now:      time.Now,
	}
}

// SetClock is for tests.
func (m *Memory) SetClock(f func() time.Time) { m.now = f }

// ------------------------------------------------------------------ players

func (m *Memory) CreatePlayer(name, tokenHash string) (*model.Player, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := strings.ToLower(name)
	if _, taken := m.byName[key]; taken {
		return nil, ErrNameTaken
	}
	p := &model.Player{
		ID:        newID(),
		Name:      name,
		TokenHash: tokenHash,
		Created:   m.now(),
		LastSeen:  m.now(),
	}
	m.players[p.ID] = p
	m.byToken[tokenHash] = p.ID
	m.byName[key] = p.ID
	return clonePlayer(p), nil
}

func (m *Memory) PlayerByID(id string) (*model.Player, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	p, ok := m.players[id]
	if !ok {
		return nil, ErrNotFound
	}
	return clonePlayer(p), nil
}

func (m *Memory) PlayerByTokenHash(hash string) (*model.Player, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id, ok := m.byToken[hash]
	if !ok {
		return nil, ErrNotFound
	}
	return clonePlayer(m.players[id]), nil
}

func (m *Memory) TouchPlayer(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.players[id]
	if !ok {
		return ErrNotFound
	}
	p.LastSeen = m.now()
	return nil
}

// ------------------------------------------------------------------- scores

func (m *Memory) AddScore(s *model.Score) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	p, ok := m.players[s.PlayerID]
	if !ok {
		return ErrNotFound
	}
	if s.ID == "" {
		s.ID = newID()
	}
	if s.Created.IsZero() {
		s.Created = m.now()
	}
	s.Name = p.Name
	m.scores = append(m.scores, s)

	p.Runs++
	p.LastSeen = m.now()
	if s.Points > p.Best {
		p.Best = s.Points
	}
	if s.ModID != "" {
		if mod, ok := m.mods[s.ModID]; ok {
			mod.Plays++
		}
	}
	return nil
}

// matches reports whether a score belongs in a given query's bucket.
func matches(s *model.Score, modID string, since time.Time) bool {
	if modID != "*" && s.ModID != modID {
		return false
	}
	if !since.IsZero() && s.Created.Before(since) {
		return false
	}
	return true
}

// best returns one entry per player — their highest score in the bucket —
// sorted descending. A leaderboard where one strong pilot owns all ten rows
// is not a leaderboard.
func (m *Memory) best(modID string, since time.Time) []*model.Score {
	bestBy := map[string]*model.Score{}
	for _, s := range m.scores {
		if !matches(s, modID, since) {
			continue
		}
		cur, ok := bestBy[s.PlayerID]
		if !ok || s.Points > cur.Points || (s.Points == cur.Points && s.TimeSec < cur.TimeSec) {
			bestBy[s.PlayerID] = s
		}
	}
	out := make([]*model.Score, 0, len(bestBy))
	for _, s := range bestBy {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Points != out[j].Points {
			return out[i].Points > out[j].Points
		}
		if out[i].TimeSec != out[j].TimeSec {
			return out[i].TimeSec < out[j].TimeSec // faster wins a tie
		}
		return out[i].Created.Before(out[j].Created) // then whoever got there first
	})
	return out
}

func (m *Memory) Top(q TopQuery) ([]model.Rank, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if q.Limit <= 0 || q.Limit > 100 {
		q.Limit = 20
	}
	ranked := m.best(q.ModID, q.Window.Since(m.now()))
	out := make([]model.Rank, 0, q.Limit)
	for i, s := range ranked {
		if i >= q.Limit {
			break
		}
		out = append(out, model.Rank{Position: i + 1, Score: cloneScore(s)})
	}
	return out, nil
}

func (m *Memory) PlayerRank(playerID, modID string, w model.Window) (*model.Rank, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ranked := m.best(modID, w.Since(m.now()))
	for i, s := range ranked {
		if s.PlayerID == playerID {
			return &model.Rank{Position: i + 1, Score: cloneScore(s)}, nil
		}
	}
	return nil, ErrNotFound
}

func (m *Memory) PlayerScores(playerID string, limit int) ([]model.Score, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	out := []model.Score{}
	for i := len(m.scores) - 1; i >= 0 && len(out) < limit; i-- {
		if m.scores[i].PlayerID == playerID {
			out = append(out, *m.scores[i])
		}
	}
	return out, nil
}

// --------------------------------------------------------------------- mods

func (m *Memory) CreateMod(mod *model.Mod) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if mod.ID == "" {
		mod.ID = newID()
	}
	if _, clash := m.mods[mod.ID]; clash {
		return ErrConflict
	}
	if mod.Created.IsZero() {
		mod.Created = m.now()
	}
	m.mods[mod.ID] = mod
	return nil
}

func (m *Memory) ModByID(id string) (*model.Mod, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	mod, ok := m.mods[id]
	if !ok {
		return nil, ErrNotFound
	}
	c := *mod
	return &c, nil
}

func (m *Memory) ListMods(limit int, sortBy string) ([]model.Mod, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	out := make([]model.Mod, 0, len(m.mods))
	for _, mod := range m.mods {
		out = append(out, *mod)
	}
	switch sortBy {
	case "plays":
		sort.Slice(out, func(i, j int) bool { return out[i].Plays > out[j].Plays })
	case "name":
		sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	default: // newest
		sort.Slice(out, func(i, j int) bool { return out[i].Created.After(out[j].Created) })
	}
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *Memory) IncrementPlays(modID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	mod, ok := m.mods[modID]
	if !ok {
		return ErrNotFound
	}
	mod.Plays++
	return nil
}

// ----------------------------------------------------------------- presence

func (m *Memory) Heartbeat(p model.Presence) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	p.Updated = m.now()
	m.presence[p.PlayerID] = p
	return nil
}

func (m *Memory) LivePresence() []model.Presence {
	m.mu.Lock()
	defer m.mu.Unlock()
	cutoff := m.now().Add(-PresenceTTL)
	out := []model.Presence{}
	for id, p := range m.presence {
		if p.Updated.Before(cutoff) {
			delete(m.presence, id) // sweep on read; there is no separate reaper
			continue
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Progress > out[j].Progress })
	return out
}

// -------------------------------------------------------------------- stats

func (m *Memory) Stats() Stats {
	live := m.LivePresence()

	m.mu.RLock()
	defer m.mu.RUnlock()

	dayAgo := m.now().Add(-24 * time.Hour)
	st := Stats{
		Players:   len(m.players),
		Runs:      len(m.scores),
		Mods:      len(m.mods),
		FlyingNow: len(live),
	}
	for _, s := range m.scores {
		if s.Created.After(dayAgo) {
			st.RunsToday++
		}
		if s.Points > st.BestScore {
			st.BestScore = s.Points
			st.BestPilot = s.Name
		}
	}
	return st
}

// -------------------------------------------------------------- persistence

type snapshot struct {
	Players []*model.Player   `json:"players"`
	Tokens  map[string]string `json:"tokens"`
	Scores  []*model.Score    `json:"scores"`
	Mods    []*model.Mod      `json:"mods"`
}

// Snapshot writes the dataset via a temp file and rename, so a crash midway
// through cannot leave a half-written file where the data used to be.
func (m *Memory) Snapshot(path string) error {
	m.mu.RLock()
	snap := snapshot{Tokens: map[string]string{}}
	for _, p := range m.players {
		snap.Players = append(snap.Players, p)
		snap.Tokens[p.TokenHash] = p.ID
	}
	snap.Scores = append(snap.Scores, m.scores...)
	for _, mod := range m.mods {
		snap.Mods = append(snap.Mods, mod)
	}
	m.mu.RUnlock()

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(snap); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

func (m *Memory) Load(path string) error {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // first run
		}
		return err
	}
	var snap snapshot
	if err := json.Unmarshal(b, &snap); err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range snap.Players {
		m.players[p.ID] = p
		m.byName[strings.ToLower(p.Name)] = p.ID
	}
	for hash, id := range snap.Tokens {
		m.byToken[hash] = id
		if p, ok := m.players[id]; ok {
			p.TokenHash = hash
		}
	}
	m.scores = append(m.scores, snap.Scores...)
	for _, mod := range snap.Mods {
		m.mods[mod.ID] = mod
	}
	return nil
}

func clonePlayer(p *model.Player) *model.Player { c := *p; return &c }
func cloneScore(s *model.Score) *model.Score    { c := *s; return &c }
