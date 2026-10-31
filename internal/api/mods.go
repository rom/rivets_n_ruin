package api

import (
	"encoding/json"
	"net/http"

	"github.com/rom/rivets_n_ruin/internal/model"
	"github.com/rom/rivets_n_ruin/internal/store"
	"github.com/rom/rivets_n_ruin/internal/validate"
)

// MaxModConfigBytes bounds the override blob. The whole of src/config.js is
// about 2.5KB, so 8KB is already generous.
const MaxModConfigBytes = 8 << 10

type createModReq struct {
	Name   string          `json:"name"`
	Seed   int64           `json:"seed"`
	Config json.RawMessage `json:"config"`
	Notes  string          `json:"notes"`
}

func (s *Server) createMod(w http.ResponseWriter, r *http.Request) {
	p := s.authed(w, r)
	if p == nil {
		return
	}
	var req createModReq
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body: "+err.Error())
		return
	}
	name, err := validate.ModName(req.Name)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.Notes) > 500 {
		writeErr(w, http.StatusBadRequest, "notes must be at most 500 characters")
		return
	}
	if len(req.Config) > MaxModConfigBytes {
		writeErr(w, http.StatusBadRequest, "config is too large")
		return
	}
	if len(req.Config) == 0 {
		req.Config = json.RawMessage("{}")
	}
	// The client will merge this over its own config, so it must be an
	// object. Reject anything else here rather than breaking the game later.
	var probe map[string]any
	if err := json.Unmarshal(req.Config, &probe); err != nil {
		writeErr(w, http.StatusBadRequest, "config must be a JSON object")
		return
	}

	mod := &model.Mod{
		Name: name, Author: p.Name, AuthorID: p.ID,
		Seed: req.Seed, Config: req.Config, Notes: req.Notes,
	}
	if err := s.store.CreateMod(mod); err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, mod)
}

func (s *Server) listMods(w http.ResponseWriter, r *http.Request) {
	mods, err := s.store.ListMods(intParam(r, "limit", 30), r.URL.Query().Get("sort"))
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mods": mods})
}

func (s *Server) getMod(w http.ResponseWriter, r *http.Request) {
	mod, err := s.store.ModByID(r.PathValue("id"))
	if err != nil {
		writeErr(w, statusFor(err), "no such mod")
		return
	}
	writeJSON(w, http.StatusOK, mod)
}

func (s *Server) modTop(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.store.ModByID(id); err != nil {
		writeErr(w, statusFor(err), "no such mod")
		return
	}
	top, err := s.store.Top(store.TopQuery{
		ModID:  id,
		Window: model.ParseWindow(r.URL.Query().Get("window")),
		Limit:  intParam(r, "limit", 20),
	})
	if err != nil {
		writeErr(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"top": top})
}
