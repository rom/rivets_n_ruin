package api

import (
	"net/http"

	"github.com/rom/rivets_n_ruin/internal/model"
	"github.com/rom/rivets_n_ruin/internal/store"
	"github.com/rom/rivets_n_ruin/internal/validate"
)

type submitScoreReq struct {
	ModID     string  `json:"modId"`
	Points    int     `json:"points"`
	TimeSec   float64 `json:"timeSec"`
	Turrets   int     `json:"turrets"`
	Deaths    int     `json:"deaths"`
	Completed bool    `json:"completed"`
	Levels    int     `json:"levels"`
	RunID     string  `json:"runId"`
	Sig       string  `json:"sig"`
}

func (s *Server) submitScore(w http.ResponseWriter, r *http.Request) {
	p := s.authed(w, r)
	if p == nil {
		return
	}
	var req submitScoreReq
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body: "+err.Error())
		return
	}

	// Cross-checks that do not need re-simulation: the run must have been
	// opened, not already submitted, signed with its own secret, and have
	// taken at least as long in wall clock as it claims in flight time.
	// See runs.go for exactly how far this does and does not go.
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
		s.runs.consume(req.RunID) // only now is the run spent
	} else if s.requireRuns {
		writeErr(w, http.StatusBadRequest, "a run must be opened before a score can be submitted")
		return
	}

	if err := validate.Score(validate.Submission{
		Points: req.Points, TimeSec: req.TimeSec, Turrets: req.Turrets,
		Deaths: req.Deaths, Completed: req.Completed, Levels: req.Levels,
	}); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if req.ModID != "" {
		if _, err := s.store.ModByID(req.ModID); err != nil {
			writeErr(w, http.StatusBadRequest, "no such mod")
			return
		}
	}

	sc := &model.Score{
		PlayerID: p.ID, ModID: req.ModID, Points: req.Points,
		TimeSec: req.TimeSec, Turrets: req.Turrets, Deaths: req.Deaths,
		Completed: req.Completed, Levels: req.Levels,
	}
	if err := s.store.AddScore(sc); err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}

	// Hand back the new standing, so the client can say "7th" without a
	// second round trip.
	rank, _ := s.store.PlayerRank(p.ID, req.ModID, model.WindowAll)
	writeJSON(w, http.StatusCreated, map[string]any{"score": sc, "rank": rank})
}

// topRuns lists the best individual runs, without folding to one per
// player. Same query parameters as /top.
func (s *Server) topRuns(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	top, err := s.store.TopRuns(store.TopQuery{
		ModID:  q.Get("mod"),
		Window: model.ParseWindow(q.Get("window")),
		Limit:  intParam(r, "limit", 10),
	})
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"top": top})
}

func (s *Server) topScores(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	top, err := s.store.Top(store.TopQuery{
		ModID:  q.Get("mod"),
		Window: model.ParseWindow(q.Get("window")),
		Limit:  intParam(r, "limit", 20),
	})
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"top": top})
}
