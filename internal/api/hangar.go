package api

import (
	"net/http"

	"github.com/rom/rivets_n_ruin/internal/model"
)

// The hangar: what a pilot owns between runs.
//
// Coins, gold bars and the permanent systems bought with them are the
// one piece of progress the game promises survives a lost ship. It
// lived only in the browser's localStorage, so it did not survive a new
// browser, a cleared cache or a second machine — which is most of what
// an account is for. An account that preserves nothing is a username.
//
// Client-authoritative, exactly as the localStorage copy was. A pilot
// who forges a balance buys themselves a better ship, which affects
// their own run and nothing else; submitted scores go through the run
// validator regardless. What the server does is clamp, so that a
// corrupt or hand-edited value cannot reach the HUD or the shop.

func (s *Server) getHangar(w http.ResponseWriter, r *http.Request) {
	p := s.bearer(r)
	if p == nil {
		writeErr(w, http.StatusUnauthorized, "sign in to reach your hangar")
		return
	}
	writeJSON(w, http.StatusOK, s.store.Hangar(p.ID))
}

func (s *Server) putHangar(w http.ResponseWriter, r *http.Request) {
	p := s.bearer(r)
	if p == nil {
		writeErr(w, http.StatusUnauthorized, "sign in to reach your hangar")
		return
	}
	var in model.Hangar
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body: "+err.Error())
		return
	}
	// The clamped value goes back in the response rather than a bare
	// 204, so a client that sent something out of range learns what was
	// actually kept instead of drifting out of step with the server.
	writeJSON(w, http.StatusOK, s.store.SetHangar(p.ID, &in))
}
