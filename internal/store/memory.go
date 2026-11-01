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
	hangars  map[string]*model.Hangar // playerID -> what they own between runs
	presence map[string]model.Presence
	now      func() time.Time
}

func NewMemory() *Memory {
	return &Memory{
		players:  map[string]*model.Player{},
		hangars:  map[string]*model.Hangar{},
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

func (m *Memory) PlayerByName(name string) (*model.Player, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id, ok := m.byName[strings.ToLower(name)]
	if !ok {
		return nil, ErrNotFound
	}
	return clonePlayer(m.players[id]), nil
}

func (m *Memory) SetPassword(id, passHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.players[id]
	if !ok {
		return ErrNotFound
	}
	p.PassHash = passHash
	p.HasPass = passHash != ""
	return nil
}

// Rotating the token invalidates the old one, which is what a fresh login
// should do: signing in elsewhere signs you out here.
func (m *Memory) SetToken(id, tokenHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.players[id]
	if !ok {
		return ErrNotFound
	}
	delete(m.byToken, p.TokenHash)
	p.TokenHash = tokenHash
	m.byToken[tokenHash] = id
	return nil
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

// TopRuns ranks individual runs rather than players. The leaderboard that
// folds to one row per player answers "who is best"; this answers "what are
// the best runs", and a pilot having three of them is the point.
func (m *Memory) TopRuns(q TopQuery) ([]model.Rank, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if q.Limit <= 0 || q.Limit > 100 {
		q.Limit = 10
	}
	since := q.Window.Since(m.now())
	runs := make([]*model.Score, 0, len(m.scores))
	for _, s := range m.scores {
		if matches(s, q.ModID, since) {
			runs = append(runs, s)
		}
	}
	sort.Slice(runs, func(i, j int) bool {
		if runs[i].Points != runs[j].Points {
			return runs[i].Points > runs[j].Points
		}
		if runs[i].TimeSec != runs[j].TimeSec {
			return runs[i].TimeSec < runs[j].TimeSec
		}
		return runs[i].Created.Before(runs[j].Created)
	})

	out := make([]model.Rank, 0, q.Limit)
	for i, s := range runs {
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

// One struct, two files.
//
// The credential half — players, password hashes, token hashes — and the
// published half — scores and mods — are written separately so they can
// live on different disks with different permissions and different
// backups. They share a shape because a single-file snapshot is still a
// valid thing to read: that is what every deployment before the split
// has on disk, and omitempty means a file written by either half parses
// as the other with nothing in it.
type snapshot struct {
	Players []*model.Player          `json:"players,omitempty"`
	Pass    map[string]string        `json:"pass,omitempty"`
	Tokens  map[string]string        `json:"tokens,omitempty"`
	Hangars map[string]*model.Hangar `json:"hangars,omitempty"`
	Scores  []*model.Score           `json:"scores,omitempty"`
	Mods    []*model.Mod             `json:"mods,omitempty"`
}

// What a snapshot file is for. Accounts holds what can log you in;
// Public holds what the API already serves to anybody.
type Part int

const (
	Accounts Part = iota
	Public
	Everything
)

// Snapshot writes the whole dataset to one file. Kept for the single-file
// layout that predates the account/state split.
func (m *Memory) Snapshot(path string) error { return m.SnapshotPart(path, Everything) }

// SnapshotPart writes the dataset via a temp file and rename, so a crash
// midway through cannot leave a half-written file where the data used to
// be. part says which half goes in.
func (m *Memory) SnapshotPart(path string, part Part) error {
	m.mu.RLock()
	snap := snapshot{}
	if part == Accounts || part == Everything {
		snap.Tokens = map[string]string{}
		snap.Pass = map[string]string{}
		// With the players, not with the scores: a hangar is per-pilot
		// data, it has to follow the account's backup policy, and
		// deleting a pilot has to be able to take it with them.
		snap.Hangars = map[string]*model.Hangar{}
		for id, h := range m.hangars {
			snap.Hangars[id] = h
		}
		for _, p := range m.players {
			snap.Players = append(snap.Players, p)
			snap.Tokens[p.TokenHash] = p.ID
			if p.PassHash != "" {
				snap.Pass[p.ID] = p.PassHash
			}
		}
	}
	if part == Public || part == Everything {
		snap.Scores = append(snap.Scores, m.scores...)
		for _, mod := range m.mods {
			snap.Mods = append(snap.Mods, mod)
		}
	}
	m.mu.RUnlock()

	// 0700 and 0600, not the 0755/0644 os.Create gives you. This file
	// holds every pilot's token hash and password hash; on a shared box
	// the default made them world-readable, which is the whole database
	// available to anyone with a login. The run file beside it was
	// already 0600 and this one was not, which is the kind of
	// inconsistency that is only ever an oversight.
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
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
	for id, hash := range snap.Pass {
		if p, ok := m.players[id]; ok {
			p.PassHash = hash
			p.HasPass = true
		}
	}
	for hash, id := range snap.Tokens {
		m.byToken[hash] = id
		if p, ok := m.players[id]; ok {
			p.TokenHash = hash
		}
	}
	for id, h := range snap.Hangars {
		if h != nil {
			m.hangars[id] = h
		}
	}
	m.scores = append(m.scores, snap.Scores...)
	for _, mod := range snap.Mods {
		m.mods[mod.ID] = mod
	}
	return nil
}

// --- hangars

// Caps on what can be read back in or written. Not game rules — there is
// no coin cap in play — but a hand-edited or corrupted value must not be
// able to put the HUD into a state it cannot render or the shop into one
// where everything is free. The same numbers as src/hangar.js, and
// parity.test.mjs checks they stay the same.
const (
	MaxCoins    = 1_000_000_000
	MaxModLevel = 99
	MaxMods     = 64
)

// Hangar returns what a pilot owns. Always a usable value, never nil, so
// a pilot who has never banked anything reads as empty rather than
// missing.
func (m *Memory) Hangar(playerID string) *model.Hangar {
	m.mu.RLock()
	defer m.mu.RUnlock()
	h, ok := m.hangars[playerID]
	if !ok {
		return &model.Hangar{Mods: map[string]int{}}
	}
	c := *h
	c.Mods = map[string]int{}
	for k, v := range h.Mods {
		c.Mods[k] = v
	}
	return &c
}

// SetHangar clamps and stores. Everything here arrives from a client and
// nothing from a client is trusted: a negative balance, a level that is
// not a number, a thousand invented mod ids and a coin count of 1e308
// are all things an HTTP body can hold and the game cannot.
func (m *Memory) SetHangar(playerID string, in *model.Hangar) *model.Hangar {
	clean := &model.Hangar{Mods: map[string]int{}, Updated: m.now()}
	if in != nil {
		clean.Coins = clampInt(in.Coins, 0, MaxCoins)
		clean.Bars = clampInt(in.Bars, 0, MaxCoins)
		n := 0
		for id, lvl := range in.Mods {
			if n >= MaxMods || id == "" || len(id) > 64 || lvl < 1 {
				continue
			}
			clean.Mods[id] = clampInt(lvl, 1, MaxModLevel)
			n++
		}
	}
	m.mu.Lock()
	m.hangars[playerID] = clean
	m.mu.Unlock()
	return m.Hangar(playerID)
}

// DeleteHangar drops a pilot's belongings. Called when the pilot goes.
func (m *Memory) DeleteHangar(playerID string) {
	m.mu.Lock()
	delete(m.hangars, playerID)
	m.mu.Unlock()
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clonePlayer(p *model.Player) *model.Player { c := *p; return &c }
func cloneScore(s *model.Score) *model.Score    { c := *s; return &c }

// --- administration

// ListPlayers returns pilots, newest first, optionally filtered by a
// case-insensitive substring of the name.
//
// This is enumeration, and that is the point: it exists for an operator
// holding the admin credential and is deliberately unreachable from
// anything a pilot can call. The public API has no route that lists
// players, and must not grow one.
func (m *Memory) ListPlayers(query string, limit int) []model.Player {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	q := strings.ToLower(strings.TrimSpace(query))

	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]model.Player, 0, len(m.players))
	for _, p := range m.players {
		if q != "" && !strings.Contains(strings.ToLower(p.Name), q) {
			continue
		}
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created.After(out[j].Created) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// DeletePlayer removes a pilot and everything of theirs.
//
// Scores go with the account. A delete that left them behind would
// leave the pilot's name behind with them, on the leaderboard, which is
// the one page that is published — so "delete this user" would not have
// deleted the only part anybody could see.
func (m *Memory) DeletePlayer(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.players[id]
	if !ok {
		return ErrNotFound
	}
	delete(m.players, id)
	delete(m.byName, strings.ToLower(p.Name))
	delete(m.byToken, p.TokenHash)
	delete(m.hangars, id)
	m.dropScoresLocked(id)
	return nil
}

// ResetPlayer clears a pilot's history and belongings and keeps the
// account, for the case where someone wants a clean slate rather than
// to be gone. The credential is untouched: they can still log in.
func (m *Memory) ResetPlayer(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.players[id]
	if !ok {
		return ErrNotFound
	}
	m.dropScoresLocked(id)
	delete(m.hangars, id)
	p.Runs = 0
	p.Best = 0
	return nil
}

// Caller holds the write lock.
func (m *Memory) dropScoresLocked(playerID string) {
	kept := m.scores[:0]
	for _, s := range m.scores {
		if s.PlayerID != playerID {
			kept = append(kept, s)
		}
	}
	// The tail still points at the removed entries; clearing it lets
	// them be collected instead of being kept alive by the backing
	// array for as long as the process runs.
	for i := len(kept); i < len(m.scores); i++ {
		m.scores[i] = nil
	}
	m.scores = kept
}
