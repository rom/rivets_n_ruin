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

	mux := http.NewServeMux()
	mux.Handle("/api/", apiSrv.Routes())
	mux.Handle("/", noCache(staticLog(log, *verbose, http.FileServer(http.Dir(root)))))

	srv := &http.Server{
		Addr:              *addr,
		Handler:           mux,
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
	log.Info("saved", "path", *data)
}

// noCache stops the browser serving a stale module after an edit, which is
// the most confusing thing that can happen while playtesting.
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
