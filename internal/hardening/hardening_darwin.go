//go:build darwin

package hardening

import (
	"fmt"
	"syscall"
)

// macOS has a sandbox — the one `sandbox_init(3)` and the seatbelt
// profiles drive — and this server cannot reach it. It is a C API with
// no syscall ABI anyone should rely on, Apple deprecated the public
// entry point years ago, and getting at it means cgo. The server is Go
// stdlib only with no cgo, and that property is worth more here than a
// deprecated sandbox would be: it is what makes `make build` produce a
// static binary with no supply chain at all.
//
// So on macOS this does the two things it can do honestly, and says
// plainly what it cannot. The deployment answer on macOS is to run the
// binary under a launchd job with its own user and a `sandbox-exec`
// profile, which is documented in the README rather than pretended at
// here. A hardening layer that claims to have done something it has not
// is worse than one that says it did nothing.
// Supported: the portable parts always work; the filesystem sandbox
// never does here.
func Supported() bool { return false }

func applyPlatform(cfg Config, rep *Report) error {
	// No core dumps: this process's heap holds bearer tokens and
	// password hashes, and a core file is those at rest.
	var lim syscall.Rlimit
	if err := syscall.Getrlimit(syscall.RLIMIT_CORE, &lim); err == nil {
		lim.Cur = 0
		if err := syscall.Setrlimit(syscall.RLIMIT_CORE, &lim); err == nil {
			rep.Applied = append(rep.Applied, "no core dumps")
		} else {
			rep.Skipped = append(rep.Skipped, fmt.Sprintf("no core dumps (%v)", err))
		}
	} else {
		rep.Skipped = append(rep.Skipped, fmt.Sprintf("no core dumps (%v)", err))
	}

	rep.Skipped = append(rep.Skipped,
		"filesystem sandbox (needs sandbox-exec or a launchd profile; see the README)")
	return nil
}
