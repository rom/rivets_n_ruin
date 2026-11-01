//go:build linux

package hardening

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Landlock is irreversible: once this process is restricted it stays
// restricted for the rest of its life, which would take the rest of the
// test binary with it. So the real enforcement check runs in a
// subprocess — the standard Go re-exec trick — and the parent asserts on
// what it reports.
//
// This matters more than it looks. Everything else about hardening can
// be checked by reading a report, and a report is exactly what a broken
// sandbox still produces: Apply() returning "landlock ABI 7 (2 paths)"
// proves the syscalls returned zero, not that anything is actually
// denied. The only honest test opens a file that should be unreachable.

const childEnv = "RNR_HARDENING_CHILD"

func TestMain(m *testing.M) {
	if os.Getenv(childEnv) == "" {
		os.Exit(m.Run())
	}
	os.Exit(runChild())
}

// runChild applies the sandbox and then tries to touch things on either
// side of it, printing one line per attempt for the parent to read.
func runChild() int {
	keepRW := os.Getenv("RNR_KEEP_RW")
	keepRO := os.Getenv("RNR_KEEP_RO")
	outside := os.Getenv("RNR_OUTSIDE")

	rep, err := Apply(Config{
		Mode:          Auto,
		ReadDirs:      []string{keepRO},
		ReadWriteDirs: []string{keepRW},
		AllowRoot:     true,
	})
	if err != nil {
		os.Stdout.WriteString("APPLY-ERR " + err.Error() + "\n")
		return 1
	}
	os.Stdout.WriteString("APPLIED " + strings.Join(rep.Applied, "|") + "\n")

	say := func(label string, err error) {
		if err == nil {
			os.Stdout.WriteString(label + " ALLOWED\n")
		} else {
			os.Stdout.WriteString(label + " DENIED " + err.Error() + "\n")
		}
	}

	// Outside the sandbox entirely: must be denied.
	_, err = os.ReadFile(outside)
	say("read-outside", err)
	say("write-outside", os.WriteFile(filepath.Join(filepath.Dir(outside), "new.txt"),
		[]byte("x"), 0o600))

	// Inside: must still work, or the sandbox has broken the server.
	_, err = os.ReadFile(filepath.Join(keepRO, "served.txt"))
	say("read-kept", err)
	say("write-kept", os.WriteFile(filepath.Join(keepRW, "snap.json"), []byte("{}"), 0o600))
	return 0
}

func runSandboxed(t *testing.T) map[string]string {
	t.Helper()
	if !Supported() {
		t.Skip("per-thread syscalls unavailable: this binary links cgo (go test -race does)")
	}
	if abi, err := landlockABI(); err != nil || abi < 1 {
		t.Skipf("no landlock on this kernel (abi %d, err %v)", abi, err)
	}

	base := t.TempDir()
	ro := filepath.Join(base, "web")
	rw := filepath.Join(base, "data")
	out := filepath.Join(base, "elsewhere")
	for _, d := range []string{ro, rw, out} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(ro, "served.txt"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(out, "secret.txt"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command(os.Args[0], "-test.run=TestNothing")
	cmd.Env = append(os.Environ(),
		childEnv+"=1",
		"RNR_KEEP_RO="+ro,
		"RNR_KEEP_RW="+rw,
		"RNR_OUTSIDE="+filepath.Join(out, "secret.txt"),
	)
	outBytes, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("child failed: %v\n%s", err, outBytes)
	}

	got := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(string(outBytes)), "\n") {
		parts := strings.SplitN(line, " ", 2)
		if len(parts) == 2 {
			got[parts[0]] = parts[1]
		}
	}
	if !strings.Contains(got["APPLIED"], "landlock") {
		t.Skipf("landlock was not applied in the child: %v", got["APPLIED"])
	}
	return got
}

func TestLandlockActuallyDeniesTheOutside(t *testing.T) {
	got := runSandboxed(t)
	for _, k := range []string{"read-outside", "write-outside"} {
		if !strings.HasPrefix(got[k], "DENIED") {
			t.Errorf("%s was %q; the sandbox reported itself applied and is not enforcing",
				k, got[k])
		}
	}
}

func TestLandlockLeavesTheServerAbleToWork(t *testing.T) {
	got := runSandboxed(t)
	// The other half, and the one that matters more day to day: a
	// sandbox that also stops the server reading its own files is not a
	// hardened server, it is a broken one.
	for _, k := range []string{"read-kept", "write-kept"} {
		if got[k] != "ALLOWED" {
			t.Errorf("%s was %q; the sandbox locked the server out of its own directories",
				k, got[k])
		}
	}
}

func TestNoNewPrivsIsSetOnThisProcess(t *testing.T) {
	if !Supported() {
		t.Skip("per-thread syscalls unavailable: this binary links cgo (go test -race does)")
	}
	// Unlike landlock this one is observable from outside and harmless
	// to leave on, so it can be checked in-process.
	rep, err := Apply(Config{Mode: Auto, AllowRoot: true})
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if !strings.Contains(strings.Join(rep.Applied, " "), "no_new_privs") {
		t.Fatalf("no_new_privs not applied: %v", rep)
	}
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		t.Skip("no /proc")
	}
	if !strings.Contains(string(b), "NoNewPrivs:\t1") {
		t.Error("Apply reported no_new_privs but the kernel disagrees")
	}
}

// Placeholder so the child's -test.run matches nothing and the child
// does not recursively run the suite.
func TestNothing(t *testing.T) {}

// The error paths, in-process. These are the ones that decide whether a
// misconfigured server starts unprotected, starts broken, or does not
// start — and none of them needs the sandbox to actually be applied, so
// they can run here rather than in a child.

func TestLandlockRefusesToLockTheProcessOutOfEverything(t *testing.T) {
	if !Supported() {
		t.Skip("per-thread syscalls unavailable (cgo build)")
	}
	// No paths kept at all would be a ruleset that denies the server its
	// own snapshot. Better to report it and run unsandboxed than to boot
	// something that cannot write.
	var rep Report
	err := landlock(Config{}, &rep)
	if err == nil {
		t.Fatal("an empty keep-list was accepted; the server would be locked out of its own files")
	}
	if !strings.Contains(err.Error(), "nothing to keep") {
		t.Errorf("unhelpful error for an empty keep-list: %v", err)
	}
}

func TestLandlockReportsAMissingDataDirectory(t *testing.T) {
	if !Supported() {
		t.Skip("per-thread syscalls unavailable (cgo build)")
	}
	var rep Report
	err := landlock(Config{ReadWriteDirs: []string{"/definitely/not/here"}}, &rep)
	if err == nil {
		t.Fatal("a nonexistent data directory was accepted")
	}
	if !strings.Contains(err.Error(), "not/here") {
		t.Errorf("the error does not name the path: %v", err)
	}
}

// A missing path must not be fatal under auto — it is reported and the
// server runs on, which is the whole degrade-do-not-fail rule.
func TestABadPathDegradesRatherThanFailing(t *testing.T) {
	rep, err := Apply(Config{
		Mode:          Auto,
		ReadWriteDirs: []string{"/definitely/not/here"},
		AllowRoot:     true,
	})
	if err != nil {
		t.Fatalf("auto mode failed on a bad path: %v", err)
	}
	if !strings.Contains(strings.Join(rep.Skipped, " "), "landlock") {
		t.Errorf("the failure was not reported: %v", rep)
	}
}

func TestRequireFailsWhenSomethingIsUnavailable(t *testing.T) {
	_, err := Apply(Config{
		Mode:          Require,
		ReadWriteDirs: []string{"/definitely/not/here"},
		AllowRoot:     true,
	})
	if err == nil {
		t.Fatal("-harden=require started anyway with the sandbox unavailable")
	}
}

func TestHandledAccessGrowsWithTheABIAndNeverShrinks(t *testing.T) {
	// Handing Landlock a bit from an ABI the running kernel does not
	// know makes it reject the whole ruleset — which would turn "your
	// kernel is newer than this code expected" into "no sandbox at all".
	prev := uint64(0)
	for abi := 1; abi <= 8; abi++ {
		h := handledFor(abi)
		if h < prev {
			t.Errorf("ABI %d handles less than ABI %d", abi, abi-1)
		}
		if h&accReadFile == 0 || h&accWriteFile == 0 {
			t.Errorf("ABI %d does not take responsibility for reads and writes", abi)
		}
		prev = h
	}
	if handledFor(1)&accRefer != 0 {
		t.Error("ABI 1 was handed a bit that only exists from ABI 2")
	}
	if handledFor(2)&accTruncate != 0 {
		t.Error("ABI 2 was handed a bit that only exists from ABI 3")
	}
}

func TestPlural(t *testing.T) {
	if plural(1) != "" || plural(0) != "s" || plural(2) != "s" {
		t.Error("the report would read \"1 paths\" or \"2 path\"")
	}
}
