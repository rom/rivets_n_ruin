package store

import (
	"sort"
	"strings"

	"github.com/rom/rivets_n_ruin/internal/model"
)

// Co-op runs: their own table, their own board.
//
// Why not the scores table with a second name on the row:
//
//   A solo score answers "how far did this pilot get". A co-op score
//   answers "how far did these two get", which is a different question
//   with a different answer, and the moment they share a board one of
//   them is wrong. Ranked together, a pair would beat a soloist for
//   having twice the guns; folded into one pilot's card, the other
//   pilot vanishes from a run they flew half of.
//
//   So: separate table, separate board, and a pilot's solo card --
//   Player.Runs, Player.Best -- is untouched by anything here. The two
//   numbers stay comparable to themselves.
//
// What is shared is the pilot's identity. A co-op run holds both ids,
// so deleting either pilot takes the run with them, exactly as
// DeletePlayer does for solo runs and for the same reason: a delete
// that leaves the name on a published page has not deleted the only
// part anybody could see.

func (m *Memory) AddCoopScore(s *model.CoopScore) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	host, ok := m.players[s.HostID]
	if !ok {
		return ErrNotFound
	}
	guest, ok := m.players[s.GuestID]
	if !ok {
		return ErrNotFound
	}
	// A pilot cannot fly co-op with themselves. Two browsers, one
	// account is a real thing people will try, and a board row naming
	// the same pilot twice is not a pair.
	if s.HostID == s.GuestID {
		return ErrConflict
	}
	if s.ID == "" {
		s.ID = newID()
	}
	if s.Created.IsZero() {
		s.Created = m.now()
	}
	// Names from the accounts, not from the request: the submitting
	// client has no business naming the other pilot.
	s.HostName = host.Name
	s.GuestName = guest.Name
	m.coop = append(m.coop, s)
	// Both pilots were here, whoever posted it.
	host.LastSeen = m.now()
	guest.LastSeen = m.now()
	return nil
}

// coopOrder is the ranking: points, then the faster run, then whoever
// got there first, then the id. The first three are the solo board's
// own tie-breaks, so a reader does not have to learn a second set.
//
// The id is the last resort and exists because sort.Slice is not
// stable: two runs identical in points, time and timestamp -- which is
// one clock tick away from ordinary, and exactly what a test with a
// pinned clock produces -- would otherwise order differently from one
// call to the next, so the board would reshuffle under the reader and
// CoopPosition would disagree with it.
func coopOrder(a, b *model.CoopScore) bool {
	if a.Points != b.Points {
		return a.Points > b.Points
	}
	if a.TimeSec != b.TimeSec {
		return a.TimeSec < b.TimeSec
	}
	if !a.Created.Equal(b.Created) {
		return a.Created.Before(b.Created)
	}
	return a.ID < b.ID
}

func (m *Memory) TopCoop(q TopQuery) ([]model.CoopRank, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if q.Limit <= 0 || q.Limit > 100 {
		q.Limit = 10
	}
	since := q.Window.Since(m.now())
	runs := make([]*model.CoopScore, 0, len(m.coop))
	for _, c := range m.coop {
		if !since.IsZero() && c.Created.Before(since) {
			continue
		}
		runs = append(runs, c)
	}
	sort.Slice(runs, func(i, j int) bool { return coopOrder(runs[i], runs[j]) })

	out := make([]model.CoopRank, 0, q.Limit)
	for i, c := range runs {
		if i >= q.Limit {
			break
		}
		out = append(out, model.CoopRank{Position: i + 1, Score: cloneCoop(c)})
	}
	return out, nil
}

// CoopPosition is where a run stands on the all-time board: one more
// than the number of runs that come before it.
//
// It takes the run rather than its points, and asks coopOrder rather
// than comparing points, so it cannot disagree with TopCoop. Counting
// higher-scoring runs alone was wrong twice over: a run that ties the
// leader was told it placed first, when the board puts the incumbent
// there, and because this is called after the row is stored, a
// greater-or-equal count would have counted the row against itself.
// coopOrder has neither problem, because a run never orders before
// itself.
func (m *Memory) CoopPosition(s *model.CoopScore) int {
	if s == nil {
		return 0
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	n := 0
	for _, c := range m.coop {
		if c.ID != s.ID && coopOrder(c, s) {
			n++
		}
	}
	return n + 1
}

// PlayerCoopScores is one pilot's co-op runs, newest first, whichever
// side of the pair they flew.
func (m *Memory) PlayerCoopScores(playerID string, limit int) []model.CoopScore {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	out := []model.CoopScore{}
	for i := len(m.coop) - 1; i >= 0 && len(out) < limit; i-- {
		if m.coop[i].Flew(playerID) {
			out = append(out, *m.coop[i])
		}
	}
	return out
}

// --- the operator's view

// ListCoopScores is the admin's view: newest first, across every pair.
// The second return is the total that matched before the page was cut.
func (m *Memory) ListCoopScores(query string, limit, offset int) ([]model.CoopScore, int) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	q := strings.ToLower(strings.TrimSpace(query))
	out := []model.CoopScore{}
	total := 0
	for i := len(m.coop) - 1; i >= 0; i-- {
		c := m.coop[i]
		if q != "" && !matchesCoop(c, q) {
			continue
		}
		total++
		if total <= offset || len(out) >= limit {
			continue
		}
		out = append(out, *c)
	}
	return out, total
}

// Does this run answer an operator's search?
//
// Either pilot's name matches anywhere inside it, because an operator
// types a fragment of a name and does not know which side they flew.
// Ids match only from the start, for the reason matchesScore gives: an
// id is 32 hex characters, so a two-letter query matching anywhere
// inside one lands on a scattering of unrelated runs.
func matchesCoop(c *model.CoopScore, q string) bool {
	return strings.Contains(strings.ToLower(c.HostName), q) ||
		strings.Contains(strings.ToLower(c.GuestName), q) ||
		strings.HasPrefix(strings.ToLower(c.HostID), q) ||
		strings.HasPrefix(strings.ToLower(c.GuestID), q) ||
		strings.HasPrefix(strings.ToLower(c.ID), q)
}

func (m *Memory) CoopScoreByID(id string) (*model.CoopScore, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, c := range m.coop {
		if c.ID == id {
			return cloneCoop(c), nil
		}
	}
	return nil, ErrNotFound
}

// DeleteCoopScore removes one co-op run.
//
// No counter to rebuild: a co-op run never contributed to either
// pilot's Runs or Best, so there is nothing cached that could be left
// disagreeing with the table.
func (m *Memory) DeleteCoopScore(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, c := range m.coop {
		if c.ID == id {
			m.coop = append(m.coop[:i], m.coop[i+1:]...)
			return nil
		}
	}
	return ErrNotFound
}

// dropCoopLocked removes every co-op run a pilot flew, either side.
// Caller holds the write lock.
func (m *Memory) dropCoopLocked(playerID string) {
	kept := m.coop[:0]
	for _, c := range m.coop {
		if !c.Flew(playerID) {
			kept = append(kept, c)
		}
	}
	// The tail still points at the removed entries; clearing it lets
	// them be collected instead of being held alive by the backing
	// array for the life of the process.
	for i := len(kept); i < len(m.coop); i++ {
		m.coop[i] = nil
	}
	m.coop = kept
}
