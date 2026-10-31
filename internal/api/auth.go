package api

import (
	"errors"
	"net/http"

	"github.com/rom/rivets_n_ruin/internal/model"
	"github.com/rom/rivets_n_ruin/internal/store"
	"github.com/rom/rivets_n_ruin/internal/validate"
)

// Registration and login.
//
// The old token-only flow still works: a pilot created before passwords
// existed keeps their token and their scores, and can set a password later
// by registering the same name with the token they already hold. Breaking
// those players to tidy the code up would be the wrong trade.

type authReq struct {
	Name     string `json:"name"`
	Password string `json:"password"`
}

type authResp struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Token string `json:"token"`
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var req authReq
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body: "+err.Error())
		return
	}
	name, err := validate.PlayerName(req.Name)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validatePassword(req.Password); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	// Claiming an existing name is allowed only by the pilot who already
	// holds it, proving it with their current token. That is how an
	// anonymous pilot adopts a password without losing their history.
	if existing, err := s.store.PlayerByName(name); err == nil {
		holder := s.bearer(r)
		if holder == nil || holder.ID != existing.ID {
			writeErr(w, http.StatusConflict, "that name is taken")
			return
		}
		if existing.HasPass {
			writeErr(w, http.StatusConflict, "that pilot already has a password")
			return
		}
		ph, err := hashPassword(req.Password)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not store the password")
			return
		}
		if err := s.store.SetPassword(existing.ID, ph); err != nil {
			writeErr(w, statusFor(err), err.Error())
			return
		}
		tok, hash, err := mintToken()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not mint a token")
			return
		}
		if err := s.store.SetToken(existing.ID, hash); err != nil {
			writeErr(w, statusFor(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, authResp{ID: existing.ID, Name: existing.Name, Token: tok})
		return
	}

	ph, err := hashPassword(req.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not store the password")
		return
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
	if err := s.store.SetPassword(p.ID, ph); err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, authResp{ID: p.ID, Name: p.Name, Token: tok})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var req authReq
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body: "+err.Error())
		return
	}

	p, err := s.store.PlayerByName(req.Name)
	// One message and one code for every failure, so the endpoint cannot be
	// used to enumerate which pilot names exist.
	const denied = "wrong pilot name or password"
	if err != nil {
		if !errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusInternalServerError, "lookup failed")
			return
		}
		// Still spend the time a real verification would, so the failure
		// cannot be told apart by how long it took.
		verifyPassword("pbkdf2-sha256$240000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", req.Password)
		writeErr(w, http.StatusUnauthorized, denied)
		return
	}
	if p.PassHash == "" || !verifyPassword(p.PassHash, req.Password) {
		writeErr(w, http.StatusUnauthorized, denied)
		return
	}

	tok, hash, err := mintToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not mint a token")
		return
	}
	if err := s.store.SetToken(p.ID, hash); err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, authResp{ID: p.ID, Name: p.Name, Token: tok})
}

// bearer resolves a token without writing a response, for the places that
// want to know who is calling but do not require it.
func (s *Server) bearer(r *http.Request) *model.Player {
	h := r.Header.Get("Authorization")
	if len(h) < 8 || h[:7] != "Bearer " {
		return nil
	}
	p, err := s.store.PlayerByTokenHash(hashToken(h[7:]))
	if err != nil {
		return nil
	}
	return p
}

func mintToken() (tok, hash string, err error) {
	tok, err = newToken()
	if err != nil {
		return "", "", err
	}
	return tok, hashToken(tok), nil
}
