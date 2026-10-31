package api

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Run sessions.
//
// READ THIS BEFORE TRUSTING A SCORE.
//
// You cannot verify a score from a client you do not control. The only
// actual verification is re-simulating the run server-side from an input
// trace, and this does not do that — the game is 7,000 lines of JavaScript
// and the server is Go.
//
// What this does is make cheating cost something, by removing the easy
// routes in roughly ascending order of effort to defeat:
//
//   1. A run must be opened before it can be submitted, and each run can be
//      submitted once. Replaying a captured request stops working.
//   2. The server times the run itself. A claimed 400-second campaign that
//      took eleven seconds of wall clock is rejected — this is the check
//      that catches a tampered clock, which the physics bounds cannot.
//   3. The submission is signed with a secret issued at run start and never
//      stored in the page's own source. Forging a request now requires
//      reading it out of a live session rather than reading the code.
//   4. Progress heartbeats are counted. A long run that never once reported
//      being in flight did not happen the way it says it did.
//
// Someone running a modified client can still defeat all four, by playing
// slowly and lying at the end. That is inherent, and the honest position is
// to say so rather than to imply the leaderboard is proof of anything.

const (
	runTTL         = 8 * time.Hour
	clockSlackSec  = 25.0 // allows for pauses, load, and a sloppy frame clock
	minBeatsPerMin = 3.0
)

type runSession struct {
	ID       string
	PlayerID string
	Secret   []byte
	ModID    string
	Started  time.Time
	Beats    int
	LastBeat time.Time
	MaxLevel int
	Used     bool
}

type runStore struct {
	mu   sync.Mutex
	runs map[string]*runSession
}

func newRunStore() *runStore {
	rs := &runStore{runs: map[string]*runSession{}}
	go rs.sweep()
	return rs
}

func (rs *runStore) sweep() {
	for range time.Tick(15 * time.Minute) {
		cut := time.Now().Add(-runTTL)
		rs.mu.Lock()
		for id, r := range rs.runs {
			if r.Started.Before(cut) {
				delete(rs.runs, id)
			}
		}
		rs.mu.Unlock()
	}
}

func (rs *runStore) open(playerID, modID string) (*runSession, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return nil, err
	}
	r := &runSession{
		ID:       hex.EncodeToString(id),
		PlayerID: playerID,
		Secret:   secret,
		ModID:    modID,
		Started:  time.Now(),
	}
	rs.mu.Lock()
	rs.runs[r.ID] = r
	rs.mu.Unlock()
	return r, nil
}

func (rs *runStore) get(id string) *runSession {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	return rs.runs[id]
}

func (rs *runStore) beat(id string, level int) bool {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	r := rs.runs[id]
	if r == nil {
		return false
	}
	r.Beats++
	r.LastBeat = time.Now()
	if level > r.MaxLevel {
		r.MaxLevel = level
	}
	return true
}

// claim looks up a run that has not yet been submitted, without consuming
// it. Checks run against this; only a submission that passes them all is
// then consumed.
func (rs *runStore) claim(id string) (*runSession, error) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	r := rs.runs[id]
	if r == nil {
		return nil, fmt.Errorf("no such run, or it has expired")
	}
	if r.Used {
		return nil, fmt.Errorf("this run has already been submitted")
	}
	return r, nil
}

// consume marks a run submitted, so a captured request cannot be replayed
// for a second entry on the board.
//
// Deliberately separate from the checks, and called only once they pass. If
// a failed check burned the run, one malformed request — a client bug, a
// truncated body, a proxy mangling a header — would void a legitimate
// campaign. Nothing is gained by it either: without the secret an attacker
// cannot do better by retrying, and the secret is 256 bits.
func (rs *runStore) consume(id string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if r := rs.runs[id]; r != nil {
		r.Used = true
	}
}

// sign is the canonical form the client must reproduce.
func sign(secret []byte, runID string, points int, timeSec float64, levels int) string {
	mac := hmac.New(sha256.New, secret)
	fmt.Fprintf(mac, "%s|%d|%.2f|%d", runID, points, timeSec, levels)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// checkRun applies every cross-check that does not require re-simulation.
func checkRun(r *runSession, playerID string, points int, timeSec float64, levels int, sig string) error {
	if r.PlayerID != playerID {
		return fmt.Errorf("this run belongs to another pilot")
	}
	want := sign(r.Secret, r.ID, points, timeSec, levels)
	if !hmac.Equal([]byte(want), []byte(sig)) {
		return fmt.Errorf("signature does not match the submitted figures")
	}

	elapsed := time.Since(r.Started).Seconds()
	if timeSec > elapsed+clockSlackSec {
		return fmt.Errorf(
			"claimed %.0fs of flight but the run has only been open for %.0fs",
			timeSec, elapsed)
	}

	// A run of any length should have reported being in flight. The rate is
	// deliberately forgiving: a dropped connection should not void a run.
	if timeSec > 60 {
		want := (timeSec / 60) * minBeatsPerMin
		if float64(r.Beats) < want {
			return fmt.Errorf(
				"claimed %.0fs of flight with only %d progress reports, expected at least %.0f",
				timeSec, r.Beats, want)
		}
	}
	if levels > r.MaxLevel+1 {
		return fmt.Errorf("claimed %d hulls but only reached %d", levels, r.MaxLevel+1)
	}
	return nil
}

// --- handlers

type startRunResp struct {
	RunID  string `json:"runId"`
	Secret string `json:"secret"`
	Server int64  `json:"serverTime"`
}

func (s *Server) startRun(w http.ResponseWriter, r *http.Request) {
	p := s.authed(w, r)
	if p == nil {
		return
	}
	var req struct {
		ModID string `json:"modId"`
	}
	if r.ContentLength > 0 {
		if err := readJSON(w, r, &req); err != nil {
			writeErr(w, http.StatusBadRequest, "malformed body: "+err.Error())
			return
		}
	}
	run, err := s.runs.open(p.ID, req.ModID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not open a run")
		return
	}
	writeJSON(w, http.StatusCreated, startRunResp{
		RunID:  run.ID,
		Secret: base64.RawURLEncoding.EncodeToString(run.Secret),
		Server: time.Now().UnixMilli(),
	})
}
