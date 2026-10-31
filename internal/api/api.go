// Package api serves the Rivets 'n Ruin backend: players, scores, top lists,
// mods and live presence.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/rom/rivets_n_ruin/internal/store"
)

// MaxBodyBytes caps every request body. Mod configs are the largest thing
// anyone legitimately posts and they are small.
const MaxBodyBytes = 64 << 10

// Config tunes the server. Zero values mean sensible defaults.
type Config struct {
	RateLimitPerSec float64 // sustained requests per second, per IP
	RateBurst       float64 // requests allowed back-to-back, per IP
}

type Server struct {
	store store.Store
	log   *slog.Logger
	rl    *rateLimiter
}

func New(s store.Store, log *slog.Logger, cfg Config) *Server {
	return &Server{
		store: s,
		log:   log,
		rl:    newRateLimiter(cfg.RateLimitPerSec, cfg.RateBurst),
	}
}

// Routes returns the API handler, already wrapped in middleware.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/stats", s.stats)

	mux.HandleFunc("POST /api/players", s.createPlayer)
	mux.HandleFunc("GET /api/players/{id}", s.getPlayer)
	mux.HandleFunc("GET /api/me", s.getMe)

	mux.HandleFunc("POST /api/scores", s.submitScore)
	mux.HandleFunc("GET /api/scores/top", s.topScores)

	mux.HandleFunc("GET /api/mods", s.listMods)
	mux.HandleFunc("POST /api/mods", s.createMod)
	mux.HandleFunc("GET /api/mods/{id}", s.getMod)
	mux.HandleFunc("GET /api/mods/{id}/top", s.modTop)

	mux.HandleFunc("POST /api/presence", s.heartbeat)
	mux.HandleFunc("GET /api/presence", s.livePresence)

	return recoverer(s.log)(logging(s.log)(cors(s.rl.middleware(mux))))
}

// ------------------------------------------------------------------ helpers

type errBody struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, errBody{Error: msg})
}

// readJSON enforces the body cap and rejects unknown fields, so a client
// typo fails loudly here instead of being silently dropped.
func readJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	return nil
}

func intParam(r *http.Request, key string, def int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func statusFor(err error) int {
	switch {
	case errors.Is(err, store.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, store.ErrNameTaken), errors.Is(err, store.ErrConflict):
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.store.Stats())
}
