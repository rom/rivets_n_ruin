package api

import (
	"net/http"

	"github.com/rom/rivets_n_ruin/internal/model"
)

type heartbeatReq struct {
	ModID    string  `json:"modId"`
	Progress float64 `json:"progress"`
	Score    int     `json:"score"`
}

// heartbeat records that this pilot is currently flying. This is what makes
// "multiple players at once" visible: everyone flies their own run, and the
// shared state is who is out there and how far along they are.
func (s *Server) heartbeat(w http.ResponseWriter, r *http.Request) {
	p := s.authed(w, r)
	if p == nil {
		return
	}
	var req heartbeatReq
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body: "+err.Error())
		return
	}
	if req.Progress < 0 {
		req.Progress = 0
	}
	if req.Progress > 1 {
		req.Progress = 1
	}
	if err := s.store.Heartbeat(model.Presence{
		PlayerID: p.ID, Name: p.Name, ModID: req.ModID,
		Progress: req.Progress, Score: req.Score,
	}); err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) livePresence(w http.ResponseWriter, r *http.Request) {
	live := s.store.LivePresence()
	writeJSON(w, http.StatusOK, map[string]any{"flying": live, "count": len(live)})
}
