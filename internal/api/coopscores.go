package api

import (
	"net/http"
	"time"

	"github.com/rom/rivets_n_ruin/internal/model"
	"github.com/rom/rivets_n_ruin/internal/store"
	"github.com/rom/rivets_n_ruin/internal/validate"
)

// The co-op board.
//
// READ THE NOTE IN runs.go FIRST. Everything it says about not being
// able to verify a score from a client you do not control applies here
// unchanged, and a co-op run adds one question on top of it: there are
// two names on the row, and only one machine posting it.
//
// The host posts. It has to be the host: it is the side that actually
// simulated the run, so its figures are the ones the game produced,
// and two submissions for one run would mean either two board rows or
// a dedupe rule that has to decide which of two disagreeing clients to
// believe. The guest posts nothing and is told so on its end screen.
//
// Which leaves: what stops a host naming a partner who was never
// there, or crediting a pilot who left after thirty seconds?
//
//  1. The partner is not in the request. The server takes the guest's
//     identity from the room, where it was recorded by an
//     authenticated POST to /api/coop/{code}/join. A host cannot name
//     anybody; it can only post the run it actually played.
//  2. The room must still be the one the host opened, and the host must
//     be the pilot who opened it.
//  3. The pair must have been connected to each other for at least
//     half the claimed flight time. The room counts that itself, on the
//     server's clock, from the sockets. A guest who dropped out early
//     does not get a board row for a run they did not fly, and the
//     number that proves it is stored on the row.
//  4. Everything in runs.go still applies: the run must have been
//     opened, signed, not already submitted, and no faster in wall
//     clock than it claims.
//
// A modified host client can still play slowly and lie at the end,
// exactly as in single player. The honest position is to say so.

// minPairedFraction is how much of a run the two have to have flown
// together for the board to credit both of them.
//
// Half, rather than all of it, because the alternative punishes the
// honest case: a dropped connection and a reconnect in the middle of a
// twenty-minute campaign is a bad network, not a fraud, and voiding
// that run costs the pilots something they earned. Half is enough to
// make "join, leave, and collect a board row" useless, which is the
// thing worth stopping.
const minPairedFraction = 0.5

// pairedGraceSec is the floor under that rule. A short run has so
// little time in it that a second of socket setup is a large fraction
// of the whole, and a pair who died on the first hull should not be
// refused for it.
const pairedGraceSec = 20.0

type submitCoopReq struct {
	// The room the run was played in. The pilots come from the room,
	// not from here; see the note above.
	Code       string  `json:"code"`
	Points     int     `json:"points"`
	TimeSec    float64 `json:"timeSec"`
	Turrets    int     `json:"turrets"`
	Deaths     int     `json:"deaths"`
	Completed  bool    `json:"completed"`
	Levels     int     `json:"levels"`
	HullsFlown int     `json:"hullsFlown"`
	RunID      string  `json:"runId"`
	Sig        string  `json:"sig"`
}

func (s *Server) submitCoopScore(w http.ResponseWriter, r *http.Request) {
	p := s.authed(w, r)
	if p == nil {
		return
	}
	var req submitCoopReq
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body: "+err.Error())
		return
	}

	room := s.coop.find(normaliseCode(req.Code))
	if room == nil {
		writeErr(w, http.StatusConflict,
			"that co-op game is no longer open, so the run cannot be posted")
		return
	}
	room.mu.Lock()
	hostID, guestID, guestName := room.hostID, room.guestID, room.guestName
	room.mu.Unlock()
	if hostID != p.ID {
		writeErr(w, http.StatusForbidden, "only the pilot hosting a co-op game posts its run")
		return
	}
	if guestID == "" || guestName == "" {
		writeErr(w, http.StatusUnprocessableEntity,
			"the second pilot never signed in, so the run cannot be credited to them")
		return
	}

	// The same cross-checks as a solo submission. Same order, too: the
	// run is claimed but not consumed until everything passes, so one
	// malformed request cannot void a legitimate campaign.
	var run *runSession
	if req.RunID != "" {
		var err error
		run, err = s.runs.claim(req.RunID)
		if err != nil {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		if err := checkRun(run, p.ID, req.Points, req.TimeSec, req.Levels, req.Sig); err != nil {
			writeErr(w, http.StatusUnprocessableEntity, err.Error())
			return
		}
	} else if s.requireRuns {
		writeErr(w, http.StatusBadRequest, "a run must be opened before a score can be submitted")
		return
	}

	if err := validate.Score(validate.Submission{
		Points: req.Points, TimeSec: req.TimeSec, Turrets: req.Turrets,
		Deaths: req.Deaths, Completed: req.Completed, Levels: req.Levels,
		HullsFlown: req.HullsFlown,
	}); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	// Did they actually fly it together?
	paired := room.pairedFor(s.now()).Seconds()
	if want := req.TimeSec * minPairedFraction; paired < want && req.TimeSec > pairedGraceSec {
		writeErr(w, http.StatusUnprocessableEntity, pairedShortfall(paired, req.TimeSec, want))
		return
	}

	if req.RunID != "" {
		s.runs.consume(req.RunID) // only now is the run spent
	}

	sc := &model.CoopScore{
		HostID: p.ID, GuestID: guestID,
		Points: req.Points, TimeSec: req.TimeSec, Turrets: req.Turrets,
		Deaths: req.Deaths, Completed: req.Completed, Levels: req.Levels,
		PairedSec: round2(paired),
	}
	if err := s.store.AddCoopScore(sc); err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	s.log.Info("co-op run recorded",
		"host", sc.HostName, "guest", sc.GuestName, "points", sc.Points)
	writeJSON(w, http.StatusCreated, map[string]any{
		"score": sc,
		"rank":  &model.CoopRank{Position: s.store.CoopPosition(sc), Score: sc},
	})
}

// pairedShortfall says what was wrong in the pilots' own terms. A bare
// 422 on the one route that two people are waiting on is worth a
// sentence.
func pairedShortfall(paired, timeSec, want float64) string {
	return "the two of you were only connected for " +
		dur(paired) + " of a " + dur(timeSec) +
		" run; a co-op run needs " + dur(want) + " flown together to be posted"
}

func dur(sec float64) string {
	return time.Duration(sec * float64(time.Second)).Round(time.Second).String()
}

func round2(v float64) float64 {
	return float64(int64(v*100+0.5)) / 100
}

// topCoopScores is the co-op top ten. Same query parameters as the
// solo boards, and the same default shape, so a client that can draw
// one can draw this.
func (s *Server) topCoopScores(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	top, err := s.store.TopCoop(store.TopQuery{
		Window: model.ParseWindow(q.Get("window")),
		Limit:  intParam(r, "limit", 10),
	})
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"top": top})
}
