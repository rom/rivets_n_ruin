package main

import (
	"net/http"
	"path/filepath"
	"strings"
)

// Keep everything the server writes off the web.
//
// The static handler serves the whole directory it is pointed at, and the
// defaults point both things at the same place: -dir is "." and -data is
// "data/rnr.json" underneath it. Run the release tree the way its own
// README says to — ./rnr-server from inside it — and the snapshot lands
// in the served directory, where anyone could fetch it:
//
//	GET /data/rnr.json -> 200
//
// That file holds every player's PBKDF2 password hash and the token
// table. The snapshot is written 0600 and the directory 0700, which is
// worth doing and does nothing here: the web server is the owner, so it
// reads the file happily and hands it to whoever asked. Found by
// extracting the 1.0.0 archive, running it as documented, and fetching
// the path the startup log prints.
//
// Blocking the path rather than refusing to start: the default layout is
// the one almost everyone will use, and a server that exits on first run
// teaches people to pass flags they have not thought about. This way the
// default is simply safe.
func hideData(root string, paths []string, next http.Handler) http.Handler {
	rootAbs := absOr(root)
	hide := make([]string, 0, len(paths))
	for _, p := range paths {
		if p == "" {
			continue
		}
		abs := absOr(p)
		// Hiding the web root would hide the game. Anyone who points
		// -state at -dir gets the individual files hidden instead,
		// which the caller arranges by listing them.
		if abs == rootAbs {
			continue
		}
		hide = append(hide, abs)
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hidden(rootAbs, hide, r.URL.Path) {
			// 404 and not 403: a refusal confirms the file is there,
			// and there is nothing to be gained by confirming it.
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Whether a request resolves to anything the server writes.
func hidden(root string, hide []string, urlPath string) bool {
	// The same resolution net/http does before it opens anything, so the
	// decision is made about the file that would actually be served
	// rather than about the spelling of the request.
	target := filepath.Join(root, filepath.Clean("/"+urlPath))

	for _, h := range hide {
		// Equal, inside it, or a sidecar of it. The sidecar rule has to
		// end at a dot: scores.json.tmp and runs.json share a stem with
		// the files they sit beside, but a bare prefix test also hides
		// statements.html next to a `state` directory, which is a
		// legitimate page answering 404 for no reason anybody could
		// diagnose.
		if target == h ||
			strings.HasPrefix(target, h+string(filepath.Separator)) ||
			strings.HasPrefix(target, h+".") {
			return true
		}
	}
	return false
}
