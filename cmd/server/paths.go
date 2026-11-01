package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Where the server reads and where it writes.
//
// Three roots, deliberately, because they have three different threat
// profiles and used to be one directory:
//
//	Content   the game. Never written to, so it can sit on a read-only
//	          mount, in a container layer, or on a filesystem the
//	          server's user has no write bit for. The hardening layer
//	          grants it read-only and nothing here asks for more.
//
//	State     leaderboards, open runs, the log. Lost or leaked this is
//	          embarrassing rather than dangerous: it is the same data
//	          the API hands to anybody who asks for it.
//
//	Accounts  the credential database — password hashes and token
//	          hashes. Separate from State because the two want
//	          different permissions, different backups and, on a shared
//	          host, a different disk. Nothing holding a credential
//	          belongs in the directory whose purpose is to be published.
//
// They were one file, data/rnr.json, underneath the directory being
// served. That is how GET /data/rnr.json came to return the password
// hashes.
type Paths struct {
	Content  string // -dir, read-only
	State    string // -state
	Accounts string // -accounts

	Scores       string // <State>/scores.json
	Runs         string // <State>/runs.json
	Log          string // <State>/server.log, when -log is set
	AccountsFile string // <Accounts>/accounts.json

	// Set when State or Accounts resolves to somewhere under Content.
	// Not fatal — the default layout does it, and a server that exits on
	// first run teaches people to pass flags they have not thought
	// about — but the static handler blocks those paths and the server
	// says so at startup.
	Exposed []string
}

// WritableDirs is what the hardening layer is allowed to grant write
// access to. Content is deliberately absent.
func (p Paths) WritableDirs() []string {
	if p.Accounts == p.State {
		return []string{p.State}
	}
	return []string{p.State, p.Accounts}
}

// Hidden is every path the static handler must refuse, whatever the
// request spells. Only paths that actually fall inside the served tree
// need hiding; the rest are already unreachable.
func (p Paths) Hidden() []string { return p.Exposed }

// ResolvePaths turns the flags into absolute paths and says what is
// exposed. legacy is the deprecated single-file -data flag: when it is
// set and the new flags are not, its directory is used for both, which
// keeps an existing deployment working on the old layout until it moves.
func ResolvePaths(dir, state, accounts, legacy string, wantLog bool) (Paths, error) {
	var p Paths
	var err error

	if p.Content, err = filepath.Abs(dir); err != nil {
		return p, fmt.Errorf("resolving -dir: %w", err)
	}

	if legacy != "" {
		legacyDir := filepath.Dir(legacy)
		if state == "" {
			state = legacyDir
		}
		if accounts == "" {
			accounts = legacyDir
		}
	}
	if state == "" {
		state = "state"
	}
	if accounts == "" {
		// Not under State. The default has to model the arrangement
		// being recommended, or nobody ever moves off it.
		accounts = "accounts"
	}

	if p.State, err = filepath.Abs(state); err != nil {
		return p, fmt.Errorf("resolving -state: %w", err)
	}
	if p.Accounts, err = filepath.Abs(accounts); err != nil {
		return p, fmt.Errorf("resolving -accounts: %w", err)
	}

	p.Scores = filepath.Join(p.State, "scores.json")
	p.Runs = filepath.Join(p.State, "runs.json")
	p.AccountsFile = filepath.Join(p.Accounts, "accounts.json")
	if wantLog {
		p.Log = filepath.Join(p.State, "server.log")
	}

	// The legacy file keeps its own name so an existing deployment is
	// read back from where it already is.
	if legacy != "" {
		abs, err := filepath.Abs(legacy)
		if err != nil {
			return p, fmt.Errorf("resolving -data: %w", err)
		}
		p.Scores = abs
		p.Runs = abs + ".runs"
		p.AccountsFile = abs
	}

	// Every writable path that falls inside the served tree, listed
	// individually — the files as well as the directories holding them.
	//
	// The first version skipped a file whose directory was already on
	// the list, which looked like tidiness and was a hole: when that
	// directory IS the web root, the static guard has to drop it (or it
	// would hide the game), and the files it was standing in for had
	// been skipped. `-data ./rnr.json` and `-state .` both land there,
	// and the account database went back to being served. Listing both
	// is redundant in the common case and correct in every case.
	for _, d := range []string{p.State, p.Accounts} {
		// The web root itself is never hideable, so recording it would
		// only create the false sense that something had been covered.
		if d != p.Content && under(p.Content, d) && !contains(p.Exposed, d) {
			p.Exposed = append(p.Exposed, d)
		}
	}
	for _, f := range []string{p.Scores, p.Runs, p.AccountsFile, p.Log} {
		if f != "" && under(p.Content, f) && !contains(p.Exposed, f) {
			p.Exposed = append(p.Exposed, f)
		}
	}
	return p, nil
}

// LegacyDefault is where -data used to point before the split. A
// deployment that never passed the flag was reading this file, and
// after the split nothing would: the server would come up on an empty
// state/ and accounts/ and look as though every account, score and mod
// had been deleted.
const LegacyDefault = "data/rnr.json"

// StrandedLegacyFile reports a pre-split snapshot that nothing is going
// to read.
//
// Only when none of the three path flags was given — anyone who passed
// one has said where their data is and does not need telling. Returns
// the path so the caller can name it; empty means there is nothing
// stranded.
func StrandedLegacyFile(dir, state, accounts, legacy string) string {
	if state != "" || accounts != "" || legacy != "" {
		return ""
	}
	// Relative to the working directory, which is where the old default
	// resolved from, not to -dir.
	abs, err := filepath.Abs(LegacyDefault)
	if err != nil {
		return ""
	}
	if fi, err := os.Stat(abs); err != nil || fi.IsDir() || fi.Size() == 0 {
		return ""
	}
	return abs
}

// EnsureDirs creates the two writable roots, 0700. Content is never
// created: if it is not there, the server has been pointed at nothing,
// and making an empty directory would only hide that.
func (p Paths) EnsureDirs() error {
	for _, d := range p.WritableDirs() {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return fmt.Errorf("creating %s: %w", d, err)
		}
	}
	return nil
}

// LoosePerms names any writable root that others can read.
//
// MkdirAll leaves an existing directory's mode alone, which is right —
// quietly re-permissioning a directory somebody else set up is not this
// program's business — but it does mean the 0700 above only applies to
// directories it created. A pre-existing 0755 accounts directory on a
// shared host hands the password hashes to anyone with a login, so the
// server says so rather than assuming.
func (p Paths) LoosePerms() []string {
	var loose []string
	for _, d := range p.WritableDirs() {
		fi, err := os.Stat(d)
		if err != nil {
			continue
		}
		if fi.Mode().Perm()&0o077 != 0 {
			loose = append(loose, fmt.Sprintf("%s (%04o)", d, fi.Mode().Perm()))
		}
	}
	return loose
}

// under reports whether path is root itself or sits beneath it. String
// prefixes alone would say /srv/game-backup is inside /srv/game, so the
// separator is part of the test.
func under(root, path string) bool {
	if root == path {
		return true
	}
	return strings.HasPrefix(path, root+string(filepath.Separator))
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// readAdminSecret loads the admin credential from a file, preferring a
// pre-computed hash.
//
// A file beats the environment for one specific reason: the environment
// a process started with stays in /proc/PID/environ for the life of
// that process, and nothing the process does to its own copy removes it.
// A file can be chmod 600 and can hold the hash instead of the password,
// so the plaintext need never exist on the server at all.
//
// A trailing newline is stripped because the overwhelmingly common way
// to make one of these is `echo secret > file`, and a newline that
// silently changes the password is a bad afternoon.
//
// Only the trailing newline, and only for the password: leading and
// inner spaces are part of a password and TrimSpace would eat them.
// It used to TrimSpace here while -hash-password stripped just CR/LF,
// so the same bytes produced two different hashes depending on which
// path you came in by — a credential that verifies under one
// configuration and refuses every login under the other. trimSecret is
// shared with -hash-password so the two cannot drift again.
func readAdminSecret(hashFile, pwFile string) (string, error) {
	if hashFile != "" && pwFile != "" {
		return "", fmt.Errorf("give -admin-password-hash-file or -admin-password-file, not both")
	}
	for _, f := range []string{hashFile, pwFile} {
		if f == "" {
			continue
		}
		b, err := os.ReadFile(f)
		if err != nil {
			return "", fmt.Errorf("reading %s: %w", f, err)
		}
		if f == hashFile {
			// A hash has no spaces in it, so this one can be strict.
			v := strings.TrimSpace(string(b))
			if v == "" {
				return "", fmt.Errorf("%s is empty", f)
			}
			return v, nil
		}
		v := trimSecret(string(b))
		// Spaces inside or around a password are kept, because they are
		// part of it. A file that is nothing BUT whitespace is a
		// mistake, not a password of four spaces, and starting with a
		// credential nobody can type is worse than refusing.
		if strings.TrimSpace(v) == "" {
			return "", fmt.Errorf("%s is empty", f)
		}
		return hashAdminPassword(v)
	}
	return "", nil
}

// trimSecret takes the trailing newline off a password and nothing
// else. Shared by -admin-password-file and -hash-password so a
// password hashed by one is accepted by the other.
func trimSecret(s string) string { return strings.TrimRight(s, "\r\n") }
