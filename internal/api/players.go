package api

import (
	"net/http"

	"github.com/rom/rivets_n_ruin/internal/validate"
)

type createPlayerReq struct {
	Name string `json:"name"`
}

type createPlayerResp struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Token string `json:"token"` // shown exactly once
}

func (s *Server) createPlayer(w http.ResponseWriter, r *http.Request) {
	var req createPlayerReq
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body: "+err.Error())
		return
	}
	name, err := validate.PlayerName(req.Name)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	tok, err := newToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not mint a token")
		return
	}
	p, err := s.store.CreatePlayer(name, hashToken(tok))
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, createPlayerResp{ID: p.ID, Name: p.Name, Token: tok})
}

func (s *Server) getPlayer(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.PlayerByID(r.PathValue("id"))
	if err != nil {
		writeErr(w, statusFor(err), "no such player")
		return
	}
	recent, _ := s.store.PlayerScores(p.ID, intParam(r, "limit", 10))
	writeJSON(w, http.StatusOK, map[string]any{"player": p, "recent": recent})
}

func (s *Server) getMe(w http.ResponseWriter, r *http.Request) {
	p := s.authed(w, r)
	if p == nil {
		return
	}
	recent, _ := s.store.PlayerScores(p.ID, 10)
	writeJSON(w, http.StatusOK, map[string]any{"player": p, "recent": recent})
}
