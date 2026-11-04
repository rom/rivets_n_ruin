package main

// The build's version, stamped in at link time.
//
// Set with -ldflags "-X main.version=1.2.3"; see the Makefile, which
// takes it from src/config.js so the server and the game it serves
// always report the same number. A parity test keeps that honest.
//
// Empty in a plain `go build` or `go run`, where the honest answer is
// that this build has no version rather than a number it invented.
var version string

func buildVersion() string {
	if version == "" {
		return "dev"
	}
	return version
}
