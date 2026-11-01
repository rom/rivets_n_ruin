// Package api serves the Rivets 'n Ruin backend: players, scores, top lists,
// mods and live presence.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/rom/rivets_n_ruin/internal/store"
)

// MaxBodyBytes caps every request body. Mod configs are the largest thing
// anyone legitimately posts and they are small.
const MaxBodyBytes = 64 << 10

// Config tunes the server. Zero values mean sensible defaults.
type Config struct {
	RateLimitPerSec float64 // sustained requests per second, per IP
	RateBurst       float64 // requests allowed back-to-back, per IP
	// RequireRuns rejects any score not tied to an opened run. Off by
	// default so an existing client keeps working; on, it closes the
	// simplest bypass, which is not opening a run at all.
	RequireRuns bool

	// AdminPasswordHash enables the operator routes. Empty — the
	// default — means they are not registered at all, so there is no
	// surface to find and nothing to brute-force. There is deliberately
	// no built-in credential.
	AdminPasswordHash string
	// AdminLocalOnly restricts those routes to loopback. Defaults to on
	// via NewWithAdmin; most of what they do is irreversible.
	AdminLocalOnly bool
}

type Server struct {
	store       store.Store
	log         *slog.Logger
	rl          *rateLimiter
	runs        *runStore
	errs        *errorRing
	requireRuns bool

	adminHash      string
	adminLocalOnly bool
	adminMu        sync.Mutex
	adminSessions  map[string]*adminSession
	clock          func() time.Time
	// A bucket of its own for the name check, far tighter than the rest
	// of the API. See available.go.
	nameRL *rateLimiter
	// What the OS agreed to take away, for /api/stats. A hardening layer
	// nobody can see the state of gets quietly broken and stays broken.
	hardening any
}

// SetHardening records what internal/hardening managed to apply, so the
// running server can be asked rather than assumed about.
func (s *Server) SetHardening(v any) { s.hardening = v }

func New(s store.Store, log *slog.Logger, cfg Config) *Server {
	return &Server{
		store:       s,
		log:         log,
		rl:          newRateLimiter(cfg.RateLimitPerSec, cfg.RateBurst),
		runs:        newRunStore(),
		errs:        newErrorRing(),
		requireRuns: cfg.RequireRuns,

		adminHash:      cfg.AdminPasswordHash,
		adminLocalOnly: cfg.AdminLocalOnly,
		adminSessions:  map[string]*adminSession{},
		nameRL:         newRateLimiter(NameCheckPerSec, NameCheckBurst),
	}
}

// Routes returns the API handler, already wrapped in middleware.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/stats", s.stats)

	mux.HandleFunc("POST /api/players", s.createPlayer)
	mux.HandleFunc("POST /api/auth/register", s.register)
	mux.HandleFunc("POST /api/auth/login", s.login)
	// One bit, one name at a time, behind its own tight limiter. See
	// available.go for why it is shaped the way it is.
	mux.HandleFunc("POST /api/auth/available", s.nameAvailable)
	mux.HandleFunc("POST /api/runs/start", s.startRun)
	mux.HandleFunc("GET /api/players/{id}", s.getPlayer)
	mux.HandleFunc("GET /api/me", s.getMe)
	mux.HandleFunc("GET /api/me/hangar", s.getHangar)
	mux.HandleFunc("PUT /api/me/hangar", s.putHangar)

	mux.HandleFunc("POST /api/scores", s.submitScore)
	mux.HandleFunc("GET /api/scores/top", s.topScores)
	mux.HandleFunc("GET /api/scores/runs", s.topRuns)

	mux.HandleFunc("GET /api/mods", s.listMods)
	mux.HandleFunc("POST /api/mods", s.createMod)
	mux.HandleFunc("GET /api/mods/{id}", s.getMod)
	mux.HandleFunc("GET /api/mods/{id}/top", s.modTop)

	mux.HandleFunc("POST /api/errors", s.reportErrors)

	// --- the operator's door
	//
	// Registered only when a password was configured, so an unconfigured
	// server has no admin surface at all rather than a disabled one.
	// Everything behind requireAdmin answers 404 when it refuses.
	if s.adminEnabled() {
		mux.HandleFunc("POST /api/admin/login", s.adminLogin)
		mux.HandleFunc("POST /api/admin/logout", s.requireAdmin(s.adminLogout))
		mux.HandleFunc("GET /api/admin/stats", s.requireAdmin(s.adminStats))
		mux.HandleFunc("GET /api/admin/players", s.requireAdmin(s.adminListPlayers))
		mux.HandleFunc("POST /api/admin/players", s.requireAdmin(s.adminCreatePlayer))
		mux.HandleFunc("GET /api/admin/players/{id}", s.requireAdmin(s.adminGetPlayer))
		mux.HandleFunc("DELETE /api/admin/players/{id}", s.requireAdmin(s.adminDeletePlayer))
		mux.HandleFunc("POST /api/admin/players/{id}/reset", s.requireAdmin(s.adminResetPlayer))
		mux.HandleFunc("POST /api/admin/players/{id}/password", s.requireAdmin(s.adminSetPassword))
	}

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
	st := s.store.Stats()
	// How much is going wrong in people's browsers, as a count rather than
	// the reports themselves: those hold stack traces from other people's
	// machines, and there is no admin tier here to put them behind. The
	// contents go to the server log.
	writeJSON(w, http.StatusOK, struct {
		store.Stats
		ClientErrors map[string]any `json:"clientErrors"`
		Hardening    any            `json:"hardening,omitempty"`
	}{st, s.errs.summary(), s.hardening})
}
