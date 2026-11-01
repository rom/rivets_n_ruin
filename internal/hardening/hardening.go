// Package hardening asks the operating system to take privileges away
// from this process, before it starts answering requests.
//
// The server is small and stdlib-only, which is a good start and is not
// the same thing as being hard to misuse. If a bug in it ever does let
// someone run code or read a path, what decides how bad that is, is what
// the kernel will still let the process do. Everything here is about
// narrowing that, and all of it happens in main() after the listener and
// the data file are open and before the first request is served.
//
// Three principles, because they are what make this safe to turn on by
// default:
//
//  1. **Degrade, do not fail.** An old kernel, a container without the
//     syscall, a platform with none of this — the server starts anyway
//     and says what it could not apply. A game server that refuses to
//     boot because a kernel is from 2019 is worse than one that is
//     merely less hardened. `-harden=require` inverts that for the
//     people who want it inverted.
//  2. **Apply late, and only what is still needed.** Landlock in
//     particular is irreversible, so it goes on after the data file and
//     the listener exist, and the kept paths are exactly the two
//     directories the process must still reach.
//  3. **Say what happened.** A hardening layer nobody can see the state
//     of gets quietly broken and stays broken. Report() returns the
//     applied and skipped lists, main() logs them, and /api/stats
//     carries the summary.
package hardening

import (
	"fmt"
	"os"
	"runtime"
	"strings"
)

// Mode decides what happens when the platform cannot do something.
type Mode int

const (
	// Auto applies everything available and ignores what is not.
	Auto Mode = iota
	// Require fails the process if anything is unavailable. For someone
	// who would rather not start than start unprotected.
	Require
	// Off applies nothing. For debugging, and for the strace case.
	Off
)

func ParseMode(s string) (Mode, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "auto":
		return Auto, nil
	case "require", "strict":
		return Require, nil
	case "off", "none":
		return Off, nil
	}
	return Auto, fmt.Errorf("unknown hardening mode %q: want auto, require or off", s)
}

// Config is what the process still needs to be able to do once it is
// locked down.
type Config struct {
	Mode Mode
	// ReadDirs are served to clients; ReadWriteDirs hold the snapshot and
	// the run file. Everything else becomes unreachable where the
	// platform can express that.
	ReadDirs      []string
	ReadWriteDirs []string
	// AllowRoot suppresses the refusal to run as uid 0. Running a public
	// listener as root is a choice, not a default.
	AllowRoot bool
}

// Report is what was actually done, so it can be logged and surfaced
// rather than assumed.
type Report struct {
	Platform string   `json:"platform"`
	Mode     string   `json:"mode"`
	Applied  []string `json:"applied"`
	Skipped  []string `json:"skipped"`
}

func (r Report) String() string {
	a := "none"
	if len(r.Applied) > 0 {
		a = strings.Join(r.Applied, ", ")
	}
	s := ""
	if len(r.Skipped) > 0 {
		s = "; unavailable: " + strings.Join(r.Skipped, ", ")
	}
	return a + s
}

func (m Mode) String() string {
	switch m {
	case Require:
		return "require"
	case Off:
		return "off"
	default:
		return "auto"
	}
}

// Apply narrows what this process can do, as far as the platform allows.
// It is called once, from main, after everything that needs a wide view
// of the filesystem has already happened.
func Apply(cfg Config) (Report, error) {
	rep := Report{Platform: runtime.GOOS, Mode: cfg.Mode.String()}
	if cfg.Mode == Off {
		rep.Skipped = append(rep.Skipped, "all (mode=off)")
		return rep, nil
	}

	// Portable first: these two are worth having everywhere and need no
	// kernel feature at all.
	// Running a public listener as uid 0 is a choice rather than a
	// default, and worth saying out loud every time. Not fatal under
	// `auto`, though: containers very often start as root, and a server
	// that will not boot there is a server people run with hardening
	// switched off entirely. Under `require` it is fatal, which is what
	// `require` is for.
	if os.Geteuid() == 0 && !cfg.AllowRoot {
		if cfg.Mode == Require {
			return rep, fmt.Errorf(
				"running as root, which this does not need. Give it its own user, " +
					"or pass -allow-root to say you meant it")
		}
		rep.Skipped = append(rep.Skipped,
			"running as ROOT — give it its own user; nothing here needs uid 0")
	} else {
		rep.Applied = append(rep.Applied, "unprivileged uid")
	}

	if err := applyPlatform(cfg, &rep); err != nil {
		return rep, err
	}

	if cfg.Mode == Require && len(rep.Skipped) > 0 {
		return rep, fmt.Errorf(
			"-harden=require, but this platform cannot apply: %s",
			strings.Join(rep.Skipped, ", "))
	}
	return rep, nil
}
