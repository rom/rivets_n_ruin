package api

import (
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/rom/rivets_n_ruin/internal/model"
	"github.com/rom/rivets_n_ruin/internal/validate"
)

// The operator's door.
//
// Four decisions worth stating, because each of them is the difference
// between an admin surface and a back door:
//
//  1. It does not exist unless a password is configured. No default
//     credential, no "admin/admin", no first-run wizard that half the
//     deployments never finish. With RNR_ADMIN_PASSWORD unset the routes
//     are not registered at all, so there is nothing to find and nothing
//     to brute-force.
//
//  2. The password arrives in the environment, never in a flag. A flag
//     is visible in ps to every user on the machine.
//
//  3. Loopback only, by default. Most of what these routes do is
//     irreversible, and an operator who wants them reachable from
//     elsewhere should have to say so and put a TLS terminator and an
//     allowlist in front.
//
//  4. Every action is logged with the actor's address, before it
//     happens. An audit line written after the fact is missing exactly
//     the operations that crashed halfway.
//
// Sessions are bearer tokens with a short life, kept in memory. A
// restart logs the operator out, which for a surface that deletes
// accounts is the right default.

const adminSessionTTL = 30 * time.Minute

type adminSession struct {
	hash    string
	expires time.Time
}

func (s *Server) adminEnabled() bool { return s.adminHash != "" }

// The clock, injectable so session expiry can be tested without a
// thirty-minute sleep. A TTL nobody can test is a TTL that quietly
// stops working.
func (s *Server) now() time.Time {
	if s.clock != nil {
		return s.clock()
	}
	return time.Now()
}

// SetClock replaces the server's clock. Tests only.
func (s *Server) SetClock(fn func() time.Time) { s.clock = fn }

// adminCaller returns the session for a request, or nil. It checks the
// address before the token: an off-network caller should learn nothing
// about whether their guess was right.
func (s *Server) adminCaller(r *http.Request) *adminSession {
	if !s.adminEnabled() {
		return nil
	}
	if !s.adminAllowRemote && !isLoopback(r.RemoteAddr) {
		return nil
	}
	h := r.Header.Get("Authorization")
	if len(h) < 8 || h[:7] != "Bearer " {
		return nil
	}
	hash := hashToken(h[7:])

	s.adminMu.Lock()
	defer s.adminMu.Unlock()
	sess, ok := s.adminSessions[hash]
	if !ok {
		return nil
	}
	if s.now().After(sess.expires) {
		delete(s.adminSessions, hash)
		return nil
	}
	return sess
}

// requireAdmin wraps a handler. Everything it rejects answers 404, not
// 401 or 403: a surface that announces itself is a surface worth
// attacking, and an operator who has mistyped the address is not the
// person this is protecting against.
func (s *Server) requireAdmin(fn func(http.ResponseWriter, *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.adminCaller(r) == nil {
			http.NotFound(w, r)
			return
		}
		fn(w, r)
	}
}

func (s *Server) audit(r *http.Request, action string, args ...any) {
	s.log.Info("admin "+action, append([]any{"from", r.RemoteAddr}, args...)...)
}

// --- login

func (s *Server) adminLogin(w http.ResponseWriter, r *http.Request) {
	if !s.adminAllowRemote && !isLoopback(r.RemoteAddr) {
		http.NotFound(w, r)
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body")
		return
	}
	// Always spend the verification, so a wrong password and a missing
	// one cannot be told apart by how long the answer took.
	ok := verifyPassword(s.adminHash, req.Password)
	if !ok {
		s.log.Warn("admin login refused", "from", r.RemoteAddr)
		writeErr(w, http.StatusUnauthorized, "no")
		return
	}
	tok, hash, err := mintToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not mint a token")
		return
	}
	s.adminMu.Lock()
	exp := s.now().Add(adminSessionTTL)
	// Drop the dead ones while we are holding the lock anyway. Nothing
	// else does: a session is only ever removed when its own token comes
	// back or on an explicit logout, so an operator who logs in daily
	// and closes the terminal grew this map for the life of the process.
	now := s.now()
	for k, v := range s.adminSessions {
		if now.After(v.expires) {
			delete(s.adminSessions, k)
		}
	}
	s.adminSessions[hash] = &adminSession{hash: hash, expires: exp}
	s.adminMu.Unlock()
	s.audit(r, "login")
	writeJSON(w, http.StatusOK, map[string]any{"token": tok, "expires": exp.UTC()})
}

func (s *Server) adminLogout(w http.ResponseWriter, r *http.Request) {
	h := r.Header.Get("Authorization")
	if len(h) > 7 {
		s.adminMu.Lock()
		delete(s.adminSessions, hashToken(h[7:]))
		s.adminMu.Unlock()
	}
	s.audit(r, "logout")
	w.WriteHeader(http.StatusNoContent)
}

// --- pilots

func (s *Server) adminListPlayers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	players := s.store.ListPlayers(q, limit)
	s.audit(r, "list players", "q", q, "returned", len(players))
	writeJSON(w, http.StatusOK, map[string]any{"players": players, "count": len(players)})
}

func (s *Server) adminGetPlayer(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.PlayerByID(r.PathValue("id"))
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	scores, _ := s.store.PlayerScores(p.ID, 20)
	hangar := s.store.Hangar(p.ID)

	var best, total int
	var completed int
	for _, sc := range scores {
		total += sc.Points
		if sc.Points > best {
			best = sc.Points
		}
		if sc.Completed {
			completed++
		}
	}
	s.audit(r, "read player", "id", p.ID, "name", p.Name)
	writeJSON(w, http.StatusOK, map[string]any{
		"player": p,
		"hangar": hangar,
		// What the game actually has, so the page offers a list rather
		// than a text box an operator can misspell a system into.
		"systems": Systems,
		"stats": map[string]any{
			"runs":           p.Runs,
			"best":           best,
			"totalPoints":    total,
			"completedRuns":  completed,
			"scoresRecorded": len(scores),
			"hasPassword":    p.HasPass,
			"created":        p.Created,
			"lastSeen":       p.LastSeen,
		},
		"recentScores": scores,
	})
}

func (s *Server) adminCreatePlayer(w http.ResponseWriter, r *http.Request) {
	var req authReq
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body")
		return
	}
	name, err := validate.PlayerName(req.Name)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Password != "" {
		if err := validatePassword(req.Password); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	tok, hash, err := mintToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not mint a token")
		return
	}
	p, err := s.store.CreatePlayer(name, hash)
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	if req.Password != "" {
		ph, err := hashPassword(req.Password)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not hash the password")
			return
		}
		if err := s.store.SetPassword(p.ID, ph); err != nil {
			writeErr(w, statusFor(err), err.Error())
			return
		}
	}
	s.audit(r, "create player", "id", p.ID, "name", p.Name, "withPassword", req.Password != "")
	// The token is shown once, here, because an operator creating an
	// account for somebody has to have something to hand them.
	writeJSON(w, http.StatusCreated, authResp{ID: p.ID, Name: p.Name, Token: tok})
}

func (s *Server) adminDeletePlayer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	p, err := s.store.PlayerByID(id)
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	// Logged before it happens: an audit line written afterwards is
	// missing exactly the operations that failed halfway through.
	s.audit(r, "delete player", "id", id, "name", p.Name)
	if err := s.store.DeletePlayer(id); err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminResetPlayer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	p, err := s.store.PlayerByID(id)
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	s.audit(r, "reset player", "id", id, "name", p.Name)
	if err := s.store.ResetPlayer(id); err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reset": id})
}

func (s *Server) adminSetPassword(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Password string `json:"password"`
	}
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body")
		return
	}
	if err := validatePassword(req.Password); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	p, err := s.store.PlayerByID(id)
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	ph, err := hashPassword(req.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not hash the password")
		return
	}
	if err := s.store.SetPassword(id, ph); err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	// A changed password invalidates the pilot's token too. Leaving it
	// alive would mean resetting the credential of a compromised
	// account changed nothing for whoever was already in it.
	tok, hash, err := mintToken()
	if err == nil {
		_ = s.store.SetToken(id, hash)
	}
	s.audit(r, "set password", "id", id, "name", p.Name)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "name": p.Name, "token": tok})
}

// --- stats

func (s *Server) adminStats(w http.ResponseWriter, r *http.Request) {
	st := s.store.Stats()
	s.adminMu.Lock()
	sessions := len(s.adminSessions)
	s.adminMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"store":         st,
		"adminSessions": sessions,
		"hardening":     s.hardening,
		// What is running, since when, and who is talking to it. Three
		// questions that were unanswerable from outside the process:
		// has it restarted, what build is this, and is anybody still
		// on an old client.
		"server":         s.buildInfo(),
		"clientVersions": s.clientVersionsSeen(),
	})
}

// isLoopback reports whether an address is on this machine. A malformed
// RemoteAddr is treated as remote: the safe answer when the question
// cannot be answered is no.
func isLoopback(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback()
}

// --- the recorded runs
//
// "Information on specific game runs" is the operator question the
// public API cannot answer at all: /api/scores/top folds to one row per
// pilot and shows the best, which is the opposite of what someone
// investigating a suspicious number needs.

func (s *Server) adminListRuns(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit := intParam(r, "limit", 50)
	offset := intParam(r, "offset", 0)
	runs, total := s.store.ListScores(q, limit, offset)
	s.audit(r, "list runs", "q", q, "returned", len(runs), "total", total)
	writeJSON(w, http.StatusOK, map[string]any{
		"runs": runs, "total": total, "offset": offset, "limit": limit,
	})
}

func (s *Server) adminGetRun(w http.ResponseWriter, r *http.Request) {
	sc, err := s.store.ScoreByID(r.PathValue("id"))
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	// The pilot it belongs to, and where this run sits among their
	// others — which is most of what makes one run interesting. A
	// missing player is not an error here: a run can outlive the
	// account on a store that did not cascade, and an operator looking
	// at an orphan should see the orphan rather than a 404.
	var player any
	var siblings []int
	if p, err := s.store.PlayerByID(sc.PlayerID); err == nil {
		player = p
		if list, err := s.store.PlayerScores(p.ID, 100); err == nil {
			for _, o := range list {
				siblings = append(siblings, o.Points)
			}
		}
	}
	// Points per second, which is the first thing to look at on a run
	// that does not smell right.
	rate := 0.0
	if sc.TimeSec > 0 {
		rate = float64(sc.Points) / sc.TimeSec
	}
	s.audit(r, "read run", "id", sc.ID, "player", sc.PlayerID, "points", sc.Points)
	writeJSON(w, http.StatusOK, map[string]any{
		"run":           sc,
		"player":        player,
		"otherRuns":     siblings,
		"pointsPerSec":  rate,
		"pointsPerHull": perHull(sc),
	})
}

func perHull(sc *model.Score) float64 {
	if sc.Levels <= 0 {
		return 0
	}
	return float64(sc.Points) / float64(sc.Levels)
}

func (s *Server) adminDeleteRun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	sc, err := s.store.ScoreByID(id)
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	s.audit(r, "delete run", "id", id, "player", sc.PlayerID, "name", sc.Name, "points", sc.Points)
	if err := s.store.DeleteScore(id); err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	// What the pilot's card says now the run is gone. The store
	// recomputes it; echoing it back is what lets the page update
	// without a second round trip and lets the operator see that the
	// number they were removing actually went.
	var best, runs int
	if p, err := s.store.PlayerByID(sc.PlayerID); err == nil {
		best, runs = p.Best, p.Runs
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"deleted": id, "playerId": sc.PlayerID, "best": best, "runs": runs,
	})
}

// adminResetScores wipes the board.
//
// Guarded by a confirmation in the body rather than by the method,
// because DELETE on a collection is one mistyped URL away from a
// DELETE on a row, and this one cannot be undone. The page asks for
// the word; curl has to send it too.
func (s *Server) adminResetScores(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Confirm string `json:"confirm"`
	}
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body")
		return
	}
	if req.Confirm != "RESET" {
		writeErr(w, http.StatusBadRequest, `send {"confirm":"RESET"} to wipe every recorded run`)
		return
	}
	s.audit(r, "reset all scores")
	n := s.store.ResetScores()
	s.log.Warn("admin wiped the leaderboard", "from", r.RemoteAddr, "runs", n)
	writeJSON(w, http.StatusOK, map[string]any{"deleted": n})
}

// adminSetStats edits a pilot's counters.
//
// Runs and Best are a cache maintained by AddScore so that reading a
// player does not mean walking the score table; the leaderboard itself
// is computed from the runs. Setting a best here that no recorded run
// supports makes the card and the board disagree, which is sometimes
// the point — tidying a counter after removing a run — and sometimes a
// mistake. So the answer carries both numbers: what the card now says,
// and what the runs on record actually add up to.
func (s *Server) adminSetStats(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Runs *int `json:"runs"`
		Best *int `json:"best"`
	}
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body")
		return
	}
	p, err := s.store.PlayerByID(id)
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	runs, best := p.Runs, p.Best
	if req.Runs != nil {
		runs = *req.Runs
	}
	if req.Best != nil {
		best = *req.Best
	}
	s.audit(r, "set stats", "id", id, "name", p.Name,
		"runs", runs, "was", p.Runs, "best", best, "wasBest", p.Best)
	if err := s.store.SetPlayerStats(id, runs, best); err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	after, err := s.store.PlayerByID(id)
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"player":   after,
		"onRecord": recordedStats(s, id),
	})
}

// recordedStats is what the runs on record add up to, independent of
// the counters. The page shows it beside them so a disagreement is
// visible rather than discovered later from the leaderboard.
func recordedStats(s *Server, playerID string) map[string]any {
	list, _ := s.store.PlayerScores(playerID, 1000)
	best := 0
	for _, sc := range list {
		if sc.Points > best {
			best = sc.Points
		}
	}
	return map[string]any{"runs": len(list), "best": best}
}

// --- what is going wrong out there
//
// The reports themselves, which /api/stats deliberately withholds.

func (s *Server) adminErrors(w http.ResponseWriter, r *http.Request) {
	limit := intParam(r, "limit", 50)
	writeJSON(w, http.StatusOK, map[string]any{
		"summary": s.errs.summary(),
		"recent":  s.errs.recent(limit),
	})
}

// --- who is flying right now

func (s *Server) adminPresence(w http.ResponseWriter, r *http.Request) {
	live := s.store.LivePresence()
	writeJSON(w, http.StatusOK, map[string]any{"flying": live, "count": len(live)})
}

// adminSetHangar replaces a pilot's belongings: coins, gold bars and
// the permanent systems they own.
//
// Straight through store.SetHangar, the same call the pilot's own
// client uses, so an operator gets the same clamping and cannot write
// a value the game could not have produced. An admin door that can put
// the shop into a state it cannot render is a worse tool than one that
// refuses.
//
// A full replace rather than a patch, because that is what the shape
// is: mods is a map, and "merge these levels in" has no sensible answer
// for a mod the operator left out. The page sends the whole thing back,
// which is what it was given.
func (s *Server) adminSetHangar(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	p, err := s.store.PlayerByID(id)
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	var in model.Hangar
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body: "+err.Error())
		return
	}
	before := s.store.Hangar(id)
	s.audit(r, "set hangar", "id", id, "name", p.Name,
		"coins", in.Coins, "wasCoins", before.Coins,
		"bars", in.Bars, "wasBars", before.Bars,
		"mods", len(in.Mods), "wasMods", len(before.Mods))
	// What was kept, not what was sent: an operator who typed more than
	// the cap should see the cap rather than discover it later.
	writeJSON(w, http.StatusOK, s.store.SetHangar(id, &in))
}
