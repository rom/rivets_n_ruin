//go:build linux

package hardening

import (
	"encoding/binary"
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

// Linux gives this process three things worth taking, in ascending order
// of how much they help and how new a kernel they need.
//
// Raw syscalls rather than golang.org/x/sys, because the server is Go
// stdlib only and that property is worth more than the convenience: a
// game server with no dependencies cannot have a supply-chain problem.
// The numbers below are the same on every architecture Linux has added
// them to, which is why they can be written down.
const (
	sysLandlockCreateRuleset = 444
	sysLandlockAddRule       = 445
	sysLandlockRestrictSelf  = 446

	prSetDumpable   = 4
	prSetNoNewPrivs = 38

	// Not in the stdlib's syscall package, and the same value on every
	// Linux architecture. O_PATH names a directory to Landlock without
	// asking for permission to read it.
	oPath             = 0o10000000
	landlockRuleAttr  = 1 // LANDLOCK_RULE_PATH_BENEATH
	createRulesetVers = 1 // LANDLOCK_CREATE_RULESET_VERSION
)

// Filesystem access bits, ABI v1 unless noted. Anything the running
// kernel does not know about is masked out before use: handing Landlock
// a bit from a newer ABI makes it reject the whole ruleset, which would
// turn "your kernel is newer than this code expected" into "no sandbox
// at all".
const (
	accExecute = 1 << iota
	accWriteFile
	accReadFile
	accReadDir
	accRemoveDir
	accRemoveFile
	accMakeChar
	accMakeDir
	accMakeReg
	accMakeSock
	accMakeFifo
	accMakeBlock
	accMakeSym
	accRefer    // ABI 2
	accTruncate // ABI 3
	accIoctlDev // ABI 5
)

// What the ruleset takes responsibility for, per ABI level. Anything
// handled and not then granted on a path becomes impossible.
func handledFor(abi int) uint64 {
	h := uint64(accExecute | accWriteFile | accReadFile | accReadDir |
		accRemoveDir | accRemoveFile | accMakeChar | accMakeDir |
		accMakeReg | accMakeSock | accMakeFifo | accMakeBlock | accMakeSym)
	if abi >= 2 {
		h |= accRefer
	}
	if abi >= 3 {
		h |= accTruncate
	}
	if abi >= 5 {
		h |= accIoctlDev
	}
	return h
}

const (
	readAccess  = accReadFile | accReadDir | accExecute
	writeAccess = readAccess | accWriteFile | accMakeReg | accMakeDir |
		accRemoveFile | accRemoveDir | accTruncate | accRefer
)

// Both of the things applied here are **per-thread** flags in the
// kernel's task_struct, and the Go runtime multiplexes goroutines across
// however many OS threads it feels like. A plain syscall from a
// goroutine therefore hardens exactly one thread — an unpredictable one
// — and leaves the rest of the process as it was.
//
// This is not theoretical. The first version of this code used
// syscall.Syscall, reported "no_new_privs applied" every time, and
// failed its own check against /proc/self/status about one run in four:
// whichever thread the check happened to land on was usually not the
// thread that had been hardened. A sandbox that reports success and
// protects a quarter of the process is worse than none, because nobody
// goes looking.
//
// syscall.AllThreadsSyscall exists for exactly this. It is refused in
// programs that use cgo, which this one does not, and the refusal is
// reported rather than ignored.
func allThreads(trap, a1, a2, a3 uintptr) error {
	_, _, e := syscall.AllThreadsSyscall(trap, a1, a2, a3)
	if e == syscall.ENOTSUP {
		// The runtime refuses this in any binary that links cgo, and the
		// default `go build` does on Linux because net can use the cgo
		// resolver. Worth saying rather than reporting a bare
		// "operation not supported", because the fix is one environment variable
		// and nobody guesses it.
		return fmt.Errorf("needs a CGO_ENABLED=0 build (this binary links cgo)")
	}
	if e != 0 {
		return e
	}
	return nil
}

// Supported reports whether the per-thread syscalls this package needs
// are usable in this binary at all. Tests skip rather than fail when
// they are not: `go test -race` links cgo by construction, and a test
// that cannot pass under the race detector would just get deleted.
func Supported() bool {
	_, _, e := syscall.AllThreadsSyscall(syscall.SYS_PRCTL, 39, 0, 0) // PR_GET_NO_NEW_PRIVS
	return e != syscall.ENOTSUP
}

func prctl(op, arg uintptr) error {
	return allThreads(syscall.SYS_PRCTL, op, arg, 0)
}

func applyPlatform(cfg Config, rep *Report) error {
	// No new privileges. Cheap, universal since 3.5, and a prerequisite
	// for Landlock on an unprivileged process. Nothing this server runs
	// should ever gain privilege through an exec, and it does not exec.
	if err := prctl(prSetNoNewPrivs, 1); err != nil {
		rep.Skipped = append(rep.Skipped, fmt.Sprintf("no_new_privs (%v)", err))
	} else {
		rep.Applied = append(rep.Applied, "no_new_privs")
	}

	// No core dumps, and no ptrace from a same-uid process. The heap of
	// this process holds bearer tokens and password hashes; a core file
	// in /var/crash is those at rest, world-readable on some systems.
	if err := prctl(prSetDumpable, 0); err != nil {
		rep.Skipped = append(rep.Skipped, fmt.Sprintf("non-dumpable (%v)", err))
	} else {
		rep.Applied = append(rep.Applied, "non-dumpable")
	}

	// Landlock. The big one: after this the process cannot read or write
	// anything outside the two directories it was given, whatever bug it
	// has. Irreversible, which is the point, and the reason it is last.
	if err := landlock(cfg, rep); err != nil {
		rep.Skipped = append(rep.Skipped, fmt.Sprintf("landlock (%v)", err))
	}
	return nil
}

func landlockABI() (int, error) {
	v, _, e := syscall.Syscall(sysLandlockCreateRuleset, 0, 0, createRulesetVers)
	if e != 0 {
		return 0, e
	}
	return int(v), nil
}

func landlock(cfg Config, rep *Report) error {
	abi, err := landlockABI()
	if err != nil {
		return fmt.Errorf("not supported by this kernel: %w", err)
	}
	if abi < 1 {
		return fmt.Errorf("reported ABI %d", abi)
	}

	handled := handledFor(abi)

	// struct landlock_ruleset_attr { __u64 handled_access_fs; }
	attr := make([]byte, 8)
	binary.LittleEndian.PutUint64(attr, handled)
	fd, _, e := syscall.Syscall(sysLandlockCreateRuleset,
		uintptr(unsafe.Pointer(&attr[0])), uintptr(len(attr)), 0)
	if e != 0 {
		return fmt.Errorf("create ruleset: %w", e)
	}
	rfd := int(fd)
	defer syscall.Close(rfd)

	grant := func(dir string, access uint64) error {
		// O_PATH is enough to name a directory to Landlock and does not
		// need read permission on it.
		dfd, err := syscall.Open(dir, oPath|syscall.O_CLOEXEC, 0)
		if err != nil {
			return fmt.Errorf("open %s: %w", dir, err)
		}
		defer syscall.Close(dfd)

		// struct landlock_path_beneath_attr {
		//     __u64 allowed_access; __s32 parent_fd;
		// } __attribute__((packed));   -- 12 bytes, no tail padding
		var pb [12]byte
		binary.LittleEndian.PutUint64(pb[0:8], access&handled)
		binary.LittleEndian.PutUint32(pb[8:12], uint32(int32(dfd)))
		if _, _, e := syscall.Syscall6(sysLandlockAddRule, fd, landlockRuleAttr,
			uintptr(unsafe.Pointer(&pb[0])), 0, 0, 0); e != 0 {
			return fmt.Errorf("add rule for %s: %w", dir, e)
		}
		return nil
	}

	kept := 0
	for _, d := range cfg.ReadDirs {
		if d == "" {
			continue
		}
		if err := grant(d, readAccess); err != nil {
			return err
		}
		kept++
	}
	for _, d := range cfg.ReadWriteDirs {
		if d == "" {
			continue
		}
		// The directory has to exist before it can be named; the data
		// file's parent is created by main before this runs.
		if _, err := os.Stat(d); err != nil {
			return fmt.Errorf("stat %s: %w", d, err)
		}
		if err := grant(d, writeAccess); err != nil {
			return err
		}
		kept++
	}
	if kept == 0 {
		return fmt.Errorf("nothing to keep: refusing to lock the process out of everything")
	}

	// Per-thread, like the prctls above: restricting only the calling
	// thread would leave every other goroutine's thread free to read
	// the whole filesystem.
	if err := allThreads(sysLandlockRestrictSelf, fd, 0, 0); err != nil {
		return fmt.Errorf("restrict self: %w", err)
	}
	rep.Applied = append(rep.Applied,
		fmt.Sprintf("landlock ABI %d (%d path%s)", abi, kept, plural(kept)))
	return nil
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}
