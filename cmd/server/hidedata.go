package main

import (
	"net/http"
	"path/filepath"
	"strings"
)

// Keep the persistence snapshot off the web.
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
func hideData(root, dataPath string, next http.Handler) http.Handler {
	data := absOr(dataPath)
	dir := filepath.Dir(data)
	rootAbs := absOr(root)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hidden(rootAbs, data, dir, r.URL.Path) {
			// 404 and not 403: a refusal confirms the file is there,
			// and there is nothing to be gained by confirming it.
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Whether a request path resolves to the snapshot, something sitting
// beside it, or the directory holding it.
func hidden(root, data, dir, urlPath string) bool {
	// The same resolution net/http does before it opens anything, so the
	// decision is made about the file that would actually be served
	// rather than about the spelling of the request.
	target := filepath.Join(root, filepath.Clean("/"+urlPath))

	// The snapshot, and the files that live alongside it under the same
	// stem: rnr.json.runs is written next to rnr.json, and a save in
	// progress leaves a temporary file there too. Matching on the prefix
	// covers all of them, including ones added later.
	if target == data || strings.HasPrefix(target, data) {
		return true
	}

	// The directory itself, so a listing cannot even show the snapshot is
	// there. Skipped when the snapshot sits directly in the web root,
	// because then "the directory holding it" is the game.
	if dir != root &&
		(target == dir || strings.HasPrefix(target, dir+string(filepath.Separator))) {
		return true
	}
	return false
}
