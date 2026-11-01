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
	"io"
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
		addr  = flag.String("addr", "127.0.0.1:8000", "address to listen on (use 0.0.0.0:8000 to expose on your network)")
		dir   = flag.String("dir", ".", "directory of static game files; never written to, may be read-only")
		state = flag.String("state", "",
			"directory for leaderboards, open runs and the log (default \"state\")")
		accounts = flag.String("accounts", "",
			"directory for the account database, which holds password and token hashes (default \"accounts\")")
		data = flag.String("data", "",
			"DEPRECATED single-file snapshot; use -state and -accounts")
		logFile    = flag.Bool("log-file", false, "also write the log to <state>/server.log")
		hsts       = flag.Bool("hsts", false, "send Strict-Transport-Security on HTTPS requests; only for a TLS deployment")
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

	paths, err := ResolvePaths(*dir, *state, *accounts, *data, *logFile)
	if err != nil {
		log.Error("resolving paths", "err", err)
		os.Exit(1)
	}
	root := paths.Content
	if _, err := os.Stat(filepath.Join(root, "index.html")); err != nil {
		log.Error("no index.html found — run this from the repository root", "dir", root)
		os.Exit(1)
	}
	if err := paths.EnsureDirs(); err != nil {
		log.Error("preparing writable directories", "err", err)
		os.Exit(1)
	}
	if loose := paths.LoosePerms(); len(loose) > 0 {
		log.Warn("a writable directory is readable by other users on this machine; "+
			"the account database in it holds password hashes",
			"dirs", strings.Join(loose, " "), "fix", "chmod 700")
	}
	if *data != "" {
		log.Warn("-data is deprecated: the account database and the leaderboards are now "+
			"separate so they can have separate permissions and separate disks",
			"use", "-state <dir> -accounts <dir>")
	}
	if *logFile {
		f, err := os.OpenFile(paths.Log, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
		if err != nil {
			log.Error("opening the log file", "path", paths.Log, "err", err)
			os.Exit(1)
		}
		defer f.Close()
		log = slog.New(slog.NewTextHandler(io.MultiWriter(os.Stderr, f),
			&slog.HandlerOptions{Level: level}))
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
	// Two files, or one when -data put them in the same place. Loading
	// the same path twice would append every score to itself.
	load := []string{paths.AccountsFile}
	if paths.Scores != paths.AccountsFile {
		load = append(load, paths.Scores)
	}
	for _, f := range load {
		if err := st.Load(f); err != nil {
			log.Error("loading snapshot", "path", f, "err", err)
			os.Exit(1)
		}
	}
	log.Info("store loaded", "accounts", paths.AccountsFile, "scores", paths.Scores,
		"stats", st.Stats())

	apiSrv := api.New(st, log, api.Config{RateLimitPerSec: *rlRate, RateBurst: *rlBurst, RequireRuns: *strictRuns})

	// Open runs, restored alongside the store. A campaign takes longer
	// than a deploy, so without this a restart voided every run in flight
	// and the player's submission came back "no such run" — the same
	// failure as the leaderboard rejecting an honest score, and just as
	// invisible from where they are sitting.
	runPath := paths.Runs
	if n, err := apiSrv.LoadRuns(runPath); err != nil {
		log.Warn("could not restore open runs", "path", runPath, "err", err)
	} else if n > 0 {
		log.Info("runs restored", "path", runPath, "runs", n)
	}

	mux := http.NewServeMux()
	mux.Handle("/api/", apiSrv.Routes())
	mux.Handle("/", noCache(staticLog(log, *verbose,
		hideData(root, paths.Hidden(), http.FileServer(http.Dir(root))))))

	// Say it out loud when anything the server writes sits inside the
	// directory it serves. Those paths are blocked either way, but an
	// operator who has not thought about it should be told where their
	// password hashes are, and the default layout does exactly this.
	if len(paths.Exposed) > 0 {
		log.Warn("the server writes inside its own web root; those paths are blocked from "+
			"being served, but the account database holds password hashes and belongs outside",
			"paths", strings.Join(paths.Exposed, " "), "root", root,
			"fix", "-state /var/lib/rivets-n-ruin -accounts /var/lib/rivets-n-ruin/private")
	}
	handler := secureHeaders(*hsts, mux)

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
	// Content read-only, and only the two state roots writable. The
	// server has no reason to write into the directory it serves, and
	// saying so here is what lets that directory be a read-only mount.
	report, err := hardening.Apply(hardening.Config{
		Mode:          mode,
		ReadDirs:      []string{root},
		ReadWriteDirs: paths.WritableDirs(),
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
				if err := saveAll(st, apiSrv, paths); err != nil {
					log.Error("snapshot failed", "err", err)
				}
			case <-stopSaver:
				return
			}
		}
	}()

	go func() {
		log.Info("rivets 'n ruin up", "addr", "http://"+*addr, "static", root,
			"state", paths.State, "accounts", paths.Accounts)
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
	if err := saveAll(st, apiSrv, paths); err != nil {
		log.Error("final snapshot failed", "err", err)
		os.Exit(1)
	}
	log.Info("saved", "accounts", paths.AccountsFile, "scores", paths.Scores, "runs", paths.Runs)
}

// Writes everything that has to survive a restart.
//
// Three files, or two when -data has put the accounts and the scores in
// the same one. Open runs are in the third because a restart is the
// common case they exist for, and a restart that drops them is exactly
// as bad as a crash that does.
func saveAll(st *store.Memory, srv *api.Server, paths Paths) error {
	if paths.Scores == paths.AccountsFile {
		if err := st.Snapshot(paths.AccountsFile); err != nil {
			return err
		}
	} else {
		if err := st.SnapshotPart(paths.AccountsFile, store.Accounts); err != nil {
			return err
		}
		if err := st.SnapshotPart(paths.Scores, store.Public); err != nil {
			return err
		}
	}
	return srv.SaveRuns(paths.Runs)
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
// The policy, as one string so it can be asserted on in a test rather
// than reconstructed by one.
//
// No 'unsafe-inline' anywhere. style-src used to carry it because the
// page had a <style> block; the CSS moved to src/game.css precisely so
// this line could say 'self' and mean it. A policy with an exception in
// it protects against the attacks nobody was going to try.
const CSP = "default-src 'self'; " +
	"script-src 'self'; " +
	"style-src 'self'; " +
	"img-src 'self' data:; " +
	"connect-src 'self'; " +
	"font-src 'self'; " +
	"media-src 'self'; " +
	"worker-src 'self'; " +
	"manifest-src 'self'; " +
	"object-src 'none'; " +
	"base-uri 'none'; " +
	"form-action 'none'; " +
	"frame-ancestors 'none'; " +
	"upgrade-insecure-requests"

func secureHeaders(hsts bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", CSP)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		// frame-ancestors above is the modern spelling and this is the
		// one older browsers obey. Both, because the cost is 24 bytes.
		h.Set("X-Frame-Options", "DENY")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		// The game loads nothing from anywhere else, so it can say so
		// and get a properly isolated context for free.
		h.Set("Cross-Origin-Embedder-Policy", "require-corp")
		h.Set("X-DNS-Prefetch-Control", "off")
		// Nothing here wants a camera, a microphone, a location or a
		// payment handler, and saying so stops a future bug asking.
		h.Set("Permissions-Policy",
			"accelerometer=(), camera=(), geolocation=(), gyroscope=(), "+
				"magnetometer=(), microphone=(), payment=(), usb=(), "+
				"interest-cohort=(), browsing-topics=()")
		// Behind a flag, and only ever sent over TLS. Announced on a
		// plain-HTTP origin it is ignored by the browser, but a
		// misconfigured proxy that terminates TLS and forwards cleartext
		// would make it stick — and an HSTS pin you did not mean is a
		// site you cannot reach.
		if hsts && (r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https") {
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
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
