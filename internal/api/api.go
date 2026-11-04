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

// How hard the admin login may be hammered. An operator mistypes a
// password two or three times and then gets it right; nobody works
// through a word list at one attempt every five seconds. Deliberately
// not configurable: a knob here is a knob somebody turns up.
const (
	AdminLoginPerSec = 0.2
	AdminLoginBurst  = 5
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
	// AdminAllowRemote lets the operator routes answer requests from
	// off this machine. Named for the dangerous option rather than the
	// safe one, so the zero value is loopback-only: most of what those
	// routes do cannot be undone, and a caller who forgets the field
	// should get the restriction, not the exposure. It read
	// AdminLocalOnly before, whose zero value was "reachable from
	// anywhere" while its comment claimed the opposite.
	AdminAllowRemote bool

	// Version is this build, set at link time; see the Makefile. Empty
	// in a `go run`, where the server says so rather than claiming a
	// number it does not have.
	Version string
	// MinClientVersion refuses writes from a game older than this.
	// Empty — the default — is no gate at all: a server that locks out
	// every client the moment it is upgraded is worse than one that
	// lets an old build keep playing. Reads are never gated; see
	// requireCurrentClient.
	MinClientVersion string
	// Started is when the process came up. Zero means now, which is
	// right for everything but a test.
	Started time.Time
}

type Server struct {
	store       store.Store
	log         *slog.Logger
	rl          *rateLimiter
	runs        *runStore
	errs        *errorRing
	requireRuns bool

	adminHash        string
	adminAllowRemote bool
	adminMu          sync.Mutex
	adminSessions    map[string]*adminSession
	clock            func() time.Time
	// A bucket of its own for the name check, far tighter than the rest
	// of the API. See available.go.
	nameRL *rateLimiter
	// And one for the admin login, tighter still. See AdminRoutes.
	adminRL *rateLimiter
	// What the OS agreed to take away, for /api/stats. A hardening layer
	// nobody can see the state of gets quietly broken and stays broken.
	hardening any

	build     Build
	minClient string
	versions  *versionTally
	coop      *coopRegistry
}

// SetHardening records what internal/hardening managed to apply, so the
// running server can be asked rather than assumed about.
func (s *Server) SetHardening(v any) { s.hardening = v }

func New(s store.Store, log *slog.Logger, cfg Config) *Server {
	srv := &Server{
		store:       s,
		log:         log,
		rl:          newRateLimiter(cfg.RateLimitPerSec, cfg.RateBurst),
		runs:        newRunStore(),
		errs:        newErrorRing(),
		requireRuns: cfg.RequireRuns,

		adminHash:        cfg.AdminPasswordHash,
		adminAllowRemote: cfg.AdminAllowRemote,
		adminSessions:    map[string]*adminSession{},
		nameRL:           newRateLimiter(NameCheckPerSec, NameCheckBurst),
		adminRL:          newRateLimiter(AdminLoginPerSec, AdminLoginBurst),
	}
	srv.build = Build{Version: cfg.Version, Started: cfg.Started}
	if srv.build.Started.IsZero() {
		srv.build.Started = time.Now()
	}
	srv.minClient = cfg.MinClientVersion
	srv.versions = newVersionTally(srv.now)
	srv.coop = newCoopRegistry(srv.now)
	go srv.sweepCoop()
	return srv
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
	mux.HandleFunc("POST /api/runs/start", s.requireCurrentClient(s.startRun))
	mux.HandleFunc("GET /api/players/{id}", s.getPlayer)
	mux.HandleFunc("GET /api/me", s.getMe)
	mux.HandleFunc("GET /api/me/hangar", s.getHangar)
	mux.HandleFunc("PUT /api/me/hangar", s.requireCurrentClient(s.putHangar))

	mux.HandleFunc("POST /api/scores", s.requireCurrentClient(s.submitScore))
	mux.HandleFunc("GET /api/scores/top", s.topScores)
	mux.HandleFunc("GET /api/scores/runs", s.topRuns)
	mux.HandleFunc("POST /api/coop/scores", s.requireCurrentClient(s.submitCoopScore))
	mux.HandleFunc("GET /api/coop/scores/top", s.topCoopScores)

	mux.HandleFunc("GET /api/mods", s.listMods)
	mux.HandleFunc("POST /api/mods", s.requireCurrentClient(s.createMod))
	mux.HandleFunc("GET /api/mods/{id}", s.getMod)
	mux.HandleFunc("GET /api/mods/{id}/top", s.modTop)

	mux.HandleFunc("POST /api/errors", s.reportErrors)

	// --- co-op
	//
	// Two browsers, one scrolling view, a ship each. The server pairs
	// them and relays bytes; the game's rules stay in the game. See
	// coop.go for why it is host-authoritative rather than lockstep.
	mux.HandleFunc("POST /api/coop/open", s.coopOpen)
	mux.HandleFunc("GET /api/coop/{code}", s.coopPeek)
	mux.HandleFunc("POST /api/coop/{code}/join", s.coopJoin)
	mux.HandleFunc("GET /api/coop/{code}/host", s.coopSocket(sideHost))
	mux.HandleFunc("GET /api/coop/{code}/guest", s.coopSocket(sideGuest))

	mux.HandleFunc("POST /api/presence", s.heartbeat)
	mux.HandleFunc("GET /api/presence", s.livePresence)

	return recoverer(s.log)(logging(s.log)(cors(s.rl.middleware(s.noteVersion(mux)))))
}

// noteVersion tallies which game builds are talking to this server.
//
// Outside the rate limiter on purpose: a client being throttled is
// still a client on that version, and the point of the tally is to
// notice who has not upgraded.
func (s *Server) noteVersion(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.versions.note(r.Header.Get(ClientVersionHeader))
		next.ServeHTTP(w, r)
	})
}

// AdminRoutes is the operator's door, and it is a different door.
//
// It used to be eight routes on the public mux, which meant the only
// thing standing between the internet and DELETE /api/admin/players/{id}
// was a password check inside the handler — one routing mistake, one
// middleware ordering change, one proxy rule deep. Now the game's
// listener does not have these routes at all: a request for one gets
// the static file handler's 404 because nothing is registered, not
// because something decided to refuse it.
//
// It returns nil when no password is configured, and cmd/server does
// not open the second listener at all in that case. An unconfigured
// server has no admin surface rather than a disabled one.
//
// `ui` is the operator's page, served at the root of this listener. It
// is passed in rather than imported so that this package stays free of
// the UI, and nil is allowed: the API alone is a usable tool with curl.
func (s *Server) AdminRoutes(ui http.Handler) http.Handler {
	if !s.adminEnabled() {
		return nil
	}
	mux := http.NewServeMux()

	// Login is the one unauthenticated route here, so it gets a bucket
	// of its own, far tighter than the API's. The global limiter is
	// per-IP and this listener is normally loopback-only, which means
	// every attempt shares one bucket — generous enough for an operator
	// mistyping a password and useless for working through a list.
	mux.Handle("POST /api/admin/login", s.adminRL.middleware(http.HandlerFunc(s.adminLogin)))
	mux.HandleFunc("POST /api/admin/logout", s.requireAdmin(s.adminLogout))

	mux.HandleFunc("GET /api/admin/stats", s.requireAdmin(s.adminStats))
	mux.HandleFunc("GET /api/admin/errors", s.requireAdmin(s.adminErrors))
	mux.HandleFunc("GET /api/admin/presence", s.requireAdmin(s.adminPresence))

	mux.HandleFunc("GET /api/admin/players", s.requireAdmin(s.adminListPlayers))
	mux.HandleFunc("POST /api/admin/players", s.requireAdmin(s.adminCreatePlayer))
	mux.HandleFunc("GET /api/admin/players/{id}", s.requireAdmin(s.adminGetPlayer))
	mux.HandleFunc("DELETE /api/admin/players/{id}", s.requireAdmin(s.adminDeletePlayer))
	mux.HandleFunc("POST /api/admin/players/{id}/reset", s.requireAdmin(s.adminResetPlayer))
	mux.HandleFunc("POST /api/admin/players/{id}/password", s.requireAdmin(s.adminSetPassword))
	mux.HandleFunc("POST /api/admin/players/{id}/stats", s.requireAdmin(s.adminSetStats))
	mux.HandleFunc("PUT /api/admin/players/{id}/hangar", s.requireAdmin(s.adminSetHangar))

	mux.HandleFunc("GET /api/admin/runs", s.requireAdmin(s.adminListRuns))
	mux.HandleFunc("GET /api/admin/runs/{id}", s.requireAdmin(s.adminGetRun))
	mux.HandleFunc("DELETE /api/admin/runs/{id}", s.requireAdmin(s.adminDeleteRun))
	mux.HandleFunc("GET /api/admin/coop", s.requireAdmin(s.adminListCoop))
	mux.HandleFunc("DELETE /api/admin/coop/{id}", s.requireAdmin(s.adminDeleteCoop))
	mux.HandleFunc("POST /api/admin/scores/reset", s.requireAdmin(s.adminResetScores))

	if ui != nil {
		mux.Handle("/", s.adminPage(ui))
	}

	// No cors(): nothing should be reaching this from a page served
	// anywhere else, and the operator's own page is same-origin.
	return recoverer(s.log)(logging(s.log)(mux))
}

// adminPage serves the operator's UI, with the headers a page holding a
// session token for a surface that deletes accounts ought to have. The
// page loads nothing from anywhere, so the policy can say so flatly.
func (s *Server) adminPage(ui http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Address-checked like everything else on this listener, so a
		// remote caller cannot even learn that the page exists.
		if !s.adminAllowRemote && !isLoopback(r.RemoteAddr) {
			http.NotFound(w, r)
			return
		}
		h := w.Header()
		h.Set("Content-Security-Policy",
			"default-src 'none'; script-src 'self'; style-src 'self'; "+
				"connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Cache-Control", "no-store")
		ui.ServeHTTP(w, r)
	})
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
		// What this build is, when it came up, how long it has been
		// there and which clients it will take writes from. The game
		// shows the last of those on the title screen when it is too
		// old, which is the only way a player finds out.
		Server buildInfo `json:"server"`
	}{st, s.errs.summary(), s.hardening, s.buildInfo()})
}
