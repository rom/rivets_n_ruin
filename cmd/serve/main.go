// Command serve is the development static file server for Rivets 'n Ruin.
//
// The game is entirely client-side; this exists only because ES modules will
// not load over file://. It is a dev tool, not a backend — it binds loopback
// by default and disables caching so a reload always picks up your edits.
package main

import (
	"flag"
	"fmt"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	port := flag.Int("port", 8000, "port to listen on")
	host := flag.String("host", "127.0.0.1", "address to bind (use 0.0.0.0 to expose on your network)")
	dir := flag.String("dir", ".", "directory to serve")
	flag.Parse()

	root, err := filepath.Abs(*dir)
	if err != nil {
		log.Fatalf("resolving -dir: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "index.html")); err != nil {
		log.Fatalf("no index.html in %s — run this from the repository root", root)
	}

	// A browser rejects an ES module served as anything but a JavaScript MIME
	// type, and a container without /etc/mime.types will happily serve .js as
	// text/plain. Pin the types the game needs rather than trusting the system.
	for ext, typ := range map[string]string{
		".js":   "text/javascript; charset=utf-8",
		".mjs":  "text/javascript; charset=utf-8",
		".html": "text/html; charset=utf-8",
		".css":  "text/css; charset=utf-8",
		".json": "application/json; charset=utf-8",
		".wasm": "application/wasm",
		".png":  "image/png",
		".svg":  "image/svg+xml",
	} {
		if err := mime.AddExtensionType(ext, typ); err != nil {
			log.Fatalf("registering mime type %s: %v", ext, err)
		}
	}

	fs := http.FileServer(http.Dir(root))
	mux := http.NewServeMux()
	mux.Handle("/", noCache(logging(fs)))

	addr := net.JoinHostPort(*host, fmt.Sprint(*port))
	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("cannot bind %s: %v", addr, err)
	}

	fmt.Printf("\n  RIVETS 'N RUIN — serving %s\n  http://%s\n\n  ctrl-c to stop\n\n", root, addr)
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// noCache keeps the browser from serving a stale module after an edit, which
// is the single most confusing thing that can happen while playtesting.
func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(rec, r)
		if rec.status >= 400 || !strings.HasPrefix(r.URL.Path, "/src/") {
			log.Printf("%3d  %-28s %s", rec.status, r.URL.Path, time.Since(start).Round(time.Microsecond))
		}
	})
}
