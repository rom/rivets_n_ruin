// Command server runs Rivets 'n Ruin: the static game files and the backend
// API that keeps high scores, top lists, mods and live presence.
//
// One process serves both, so there is one thing to run and no CORS to think
// about in development. The API is also usable standalone — the client falls
// back to offline play when it cannot reach it.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/rom/rivets_n_ruin/internal/api"
	"github.com/rom/rivets_n_ruin/internal/hardening"
	"github.com/rom/rivets_n_ruin/internal/store"
)

func main() {
	var (
		addr       = flag.String("addr", "127.0.0.1:8000", "address to listen on (use 0.0.0.0:8000 to expose on your network)")
		dir        = flag.String("dir", ".", "directory of static game files")
		data       = flag.String("data", "data/rnr.json", "path to the persistence snapshot")
		saveTick   = flag.Duration("save-interval", 30*time.Second, "how often to snapshot to disk")
		verbose    = flag.Bool("v", false, "log every request, including static assets")
		rlRate     = flag.Float64("rate-limit", 10, "sustained API requests per second, per IP")
		rlBurst    = flag.Float64("rate-burst", 40, "API requests allowed back-to-back, per IP")
		strictRuns = flag.Bool("require-runs", false,
			"reject scores not tied to an opened run session (see internal/api/runs.go)")
		harden = flag.String("harden", "auto",
			"OS hardening: auto applies what the platform offers, require fails without it, off applies none")
		allowRoot = flag.Bool("allow-root", false,
			"permit running as uid 0, which this does not need")
	)
	flag.Parse()

	level := slog.LevelInfo
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))

	root, err := filepath.Abs(*dir)
	if err != nil {
		log.Error("resolving -dir", "err", err)
		os.Exit(1)
	}
	if _, err := os.Stat(filepath.Join(root, "index.html")); err != nil {
		log.Error("no index.html found — run this from the repository root", "dir", root)
		os.Exit(1)
	}

	// A browser rejects an ES module served as anything but a JavaScript MIME
	// type, and a container without /etc/mime.types will serve .js as
	// text/plain. Pin what the game needs rather than trusting the system.
	for ext, typ := range map[string]string{
		".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
		".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
		".json": "application/json; charset=utf-8", ".wasm": "application/wasm",
		".png": "image/png", ".svg": "image/svg+xml",
		".ico": "image/x-icon",
	} {
		if err := mime.AddExtensionType(ext, typ); err != nil {
			log.Error("registering mime type", "ext", ext, "err", err)
			os.Exit(1)
		}
	}

	st := store.NewMemory()
	if err := st.Load(*data); err != nil {
		log.Error("loading snapshot", "path", *data, "err", err)
		os.Exit(1)
	}
	log.Info("store loaded", "path", *data, "stats", st.Stats())

	apiSrv := api.New(st, log, api.Config{RateLimitPerSec: *rlRate, RateBurst: *rlBurst, RequireRuns: *strictRuns})

	// Open runs, restored alongside the store. A campaign takes longer
	// than a deploy, so without this a restart voided every run in flight
	// and the player's submission came back "no such run" — the same
	// failure as the leaderboard rejecting an honest score, and just as
	// invisible from where they are sitting.
	runPath := *data + ".runs"
	if n, err := apiSrv.LoadRuns(runPath); err != nil {
		log.Warn("could not restore open runs", "path", runPath, "err", err)
	} else if n > 0 {
		log.Info("runs restored", "path", runPath, "runs", n)
	}

	mux := http.NewServeMux()
	mux.Handle("/api/", apiSrv.Routes())
	mux.Handle("/", noCache(staticLog(log, *verbose,
		hideData(root, *data, http.FileServer(http.Dir(root))))))

	// Say it out loud when the two defaults overlap. The path is blocked
	// either way, but an operator who believes the snapshot is reachable
	// over HTTP may have built something around that, and an operator who
	// has not thought about it at all should be told where the file is.
	if dataAbs := absOr(*data); strings.HasPrefix(dataAbs, root+string(filepath.Separator)) {
		log.Warn("the snapshot sits inside the web root; it is blocked from being served, "+
			"but it holds password hashes and belongs outside",
			"data", dataAbs, "root", root, "fix", "-data /var/lib/rivets-n-ruin/rnr.json")
	}
	handler := secureHeaders(mux)

	srv := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Error("cannot bind", "addr", *addr, "err", err)
		os.Exit(1)
	}

	// Give privileges back to the kernel, now that everything needing a
	// wide view of the filesystem has happened: the snapshot is loaded,
	// the runs are restored, the port is bound. After this the process
	// cannot reach anything outside the web root and the data directory,
	// where the platform can express that. See internal/hardening.
	mode, err := hardening.ParseMode(*harden)
	if err != nil {
		log.Error("bad -harden value", "err", err)
		os.Exit(1)
	}
	report, err := hardening.Apply(hardening.Config{
		Mode:          mode,
		ReadDirs:      []string{root},
		ReadWriteDirs: []string{filepath.Dir(absOr(*data))},
		AllowRoot:     *allowRoot,
	})
	if err != nil {
		log.Error("hardening", "err", err)
		os.Exit(1)
	}
	apiSrv.SetHardening(report)
	log.Info("hardened", "mode", report.Mode, "applied", report.Applied,
		"unavailable", report.Skipped)

	// Periodic snapshots, so an abrupt kill loses at most one interval.
	stopSaver := make(chan struct{})
	go func() {
		t := time.NewTicker(*saveTick)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				if err := st.Snapshot(*data); err != nil {
					log.Error("snapshot failed", "err", err)
				}
				if err := apiSrv.SaveRuns(runPath); err != nil {
					log.Error("run snapshot failed", "err", err)
				}
			case <-stopSaver:
				return
			}
		}
	}()

	go func() {
		log.Info("rivets 'n ruin up", "addr", "http://"+*addr, "static", root, "data", *data)
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("serve", "err", err)
			os.Exit(1)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig

	log.Info("shutting down")
	close(stopSaver)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error("graceful shutdown failed", "err", err)
	}
	// Final snapshot after connections are drained, so nothing in flight is lost.
	if err := st.Snapshot(*data); err != nil {
		log.Error("final snapshot failed", "err", err)
		os.Exit(1)
	}
	// Open runs too. A restart is the common case this exists for, and a
	// restart that drops them is exactly as bad as a crash that does.
	if err := apiSrv.SaveRuns(runPath); err != nil {
		log.Error("final run snapshot failed", "err", err)
	}
	log.Info("saved", "path", *data, "runs", runPath)
}

// noCache stops the browser serving a stale module after an edit, which is
// the most confusing thing that can happen while playtesting.
// absOr is only for naming a directory to the sandbox: a path that will
// not resolve is passed through and fails loudly there rather than
// silently granting the wrong directory.
func absOr(p string) string {
	a, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return a
}

// Headers that cost nothing and remove whole classes of problem from a
// page that loads its own modules and talks to its own origin.
//
// The content security policy is as tight as the game allows: everything
// comes from this origin, there is no inline script, no plugin, no
// frame, and nothing may frame it. The game has no third-party anything
// — no fonts, no analytics, no CDN — so the policy has no exceptions,
// which is the only kind of policy worth writing.
func secureHeaders(next http.Handler) http.Handler {
	const csp = "default-src 'self'; " +
		"script-src 'self'; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data:; " +
		"connect-src 'self'; " +
		"object-src 'none'; " +
		"base-uri 'none'; " +
		"form-action 'none'; " +
		"frame-ancestors 'none'"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		// Nothing here wants a camera, a microphone, a location or a
		// payment handler, and saying so stops a future bug asking.
		h.Set("Permissions-Policy",
			"accelerometer=(), camera=(), geolocation=(), gyroscope=(), "+
				"magnetometer=(), microphone=(), payment=(), usb=()")
		next.ServeHTTP(w, r)
	})
}

func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, must-revalidate")
		next.ServeHTTP(w, r)
	})
}

func staticLog(log *slog.Logger, verbose bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if verbose || !strings.HasPrefix(r.URL.Path, "/src/") {
			log.Debug("static", "path", r.URL.Path)
		}
		next.ServeHTTP(w, r)
	})
}
