// Package adminui is the operator's page, compiled into the binary.
//
// Embedded rather than served from disk, for three reasons:
//
//  1. The game's static root is a directory the operator points at and
//     may be a read-only mount or a CDN's origin. Anything in it is
//     reachable from the game's port. An admin page on disk inside that
//     root would be served to the internet by the public listener,
//     which is the exact thing moving the admin surface to its own port
//     was for.
//  2. There is nothing to deploy. The admin tool exists wherever the
//     binary does, at the version the binary is.
//  3. It cannot be edited in place on a running server, which for the
//     page that holds a session token to a surface that deletes
//     accounts is worth having.
package adminui

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed page
var files embed.FS

// Handler serves the page. Everything under /, because this is the
// whole of what the admin listener serves apart from /api/admin/*.
func Handler() http.Handler {
	sub, err := fs.Sub(files, "page")
	if err != nil {
		// Unreachable: the embed is checked at compile time. Panicking
		// is right anyway — a binary whose admin page did not compile
		// in should not pretend to have one.
		panic(err)
	}
	return http.FileServer(http.FS(sub))
}

// FS exposes the embedded files, for tests that want to assert on what
// was shipped rather than on what a request returned.
func FS() fs.FS {
	sub, _ := fs.Sub(files, "page")
	return sub
}
