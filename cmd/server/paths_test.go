package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestThreeRootsAreSeparateByDefault(t *testing.T) {
	base := t.TempDir()
	content := filepath.Join(base, "web")
	p, err := ResolvePaths(content, filepath.Join(base, "state"), filepath.Join(base, "private"), "", true)
	if err != nil {
		t.Fatal(err)
	}
	if p.Content == p.State || p.State == p.Accounts || p.Content == p.Accounts {
		t.Fatalf("roots collapsed: %+v", p)
	}
	// The whole point: nothing that can log you in may sit in the
	// directory whose purpose is to be published.
	if under(p.State, p.AccountsFile) {
		t.Errorf("the account database is inside the state directory: %s", p.AccountsFile)
	}
	if under(p.Content, p.AccountsFile) || under(p.Content, p.Scores) {
		t.Errorf("the server writes inside the directory it serves: %+v", p)
	}
	if len(p.Exposed) != 0 {
		t.Errorf("nothing should be exposed in this layout, got %v", p.Exposed)
	}
}

func TestContentIsNeverWritable(t *testing.T) {
	base := t.TempDir()
	content := filepath.Join(base, "web")
	p, err := ResolvePaths(content, filepath.Join(base, "state"), filepath.Join(base, "private"), "", false)
	if err != nil {
		t.Fatal(err)
	}
	// This list is handed straight to the sandbox. Content appearing in
	// it is the difference between "the game can live on a read-only
	// partition" and a claim in a README.
	for _, d := range p.WritableDirs() {
		if d == p.Content || under(p.Content, d) {
			t.Fatalf("%s is writable and inside the content root %s", d, p.Content)
		}
	}
}

func TestEnsureDirsMakesStateAndAccountsAndNotContent(t *testing.T) {
	base := t.TempDir()
	content := filepath.Join(base, "web")
	p, err := ResolvePaths(content, filepath.Join(base, "state"), filepath.Join(base, "private"), "", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := p.EnsureDirs(); err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{p.State, p.Accounts} {
		fi, err := os.Stat(d)
		if err != nil {
			t.Fatalf("%s was not created: %v", d, err)
		}
		// 0700: the account database beside it holds password hashes,
		// and on a shared box the default 0755 hands the directory to
		// anybody with a login.
		if perm := fi.Mode().Perm(); perm != 0o700 {
			t.Errorf("%s is %o, want 700", d, perm)
		}
	}
	// Creating the content root would hide a server pointed at nothing.
	if _, err := os.Stat(content); !os.IsNotExist(err) {
		t.Errorf("the content root was created; a missing -dir must stay missing")
	}
}

func TestDefaultLayoutIsFlaggedAsExposed(t *testing.T) {
	// Run the release tree the way its README says to and both roots
	// land under the served directory. That is allowed — a server that
	// exits on first run teaches people to pass flags they have not
	// thought about — but it has to be reported, and the paths have to
	// be unreachable over HTTP.
	content := t.TempDir()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(cwd)
	if err := os.Chdir(content); err != nil {
		t.Fatal(err)
	}
	// macOS hands back /var/... for a /private/var/... temp dir.
	real, err := filepath.Abs(".")
	if err != nil {
		t.Fatal(err)
	}

	p, err := ResolvePaths(real, "", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Exposed) == 0 {
		t.Fatal("the default layout writes inside the web root and was not flagged")
	}
	for _, want := range []string{p.State, p.Accounts} {
		if !contains(p.Exposed, want) {
			t.Errorf("%s is inside the web root but not flagged: %v", want, p.Exposed)
		}
	}
	if !contains(p.Hidden(), p.AccountsFile) {
		t.Errorf("the account database is not in the hide list: %v", p.Hidden())
	}
}

func TestLegacyDataFlagStillWorks(t *testing.T) {
	// An existing deployment has one file and a -data pointing at it.
	// It has to keep starting, reading what is already on disk, until
	// whoever runs it moves to the split.
	base := t.TempDir()
	content := filepath.Join(base, "web")
	legacy := filepath.Join(base, "old", "rnr.json")

	p, err := ResolvePaths(content, "", "", legacy, false)
	if err != nil {
		t.Fatal(err)
	}
	if p.AccountsFile != legacy || p.Scores != legacy {
		t.Errorf("legacy mode should read the one file it was given, got %s and %s",
			p.AccountsFile, p.Scores)
	}
	if p.Runs != legacy+".runs" {
		t.Errorf("open runs moved out from under an existing deployment: %s", p.Runs)
	}
	if !strings.HasPrefix(p.State, filepath.Dir(legacy)) {
		t.Errorf("state did not follow -data: %s", p.State)
	}
}

func TestExplicitFlagsBeatLegacy(t *testing.T) {
	base := t.TempDir()
	p, err := ResolvePaths(filepath.Join(base, "web"), filepath.Join(base, "s"),
		filepath.Join(base, "a"), "", false)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(p.Scores) != p.State || filepath.Dir(p.AccountsFile) != p.Accounts {
		t.Errorf("files did not land in their own roots: %+v", p)
	}
}

func TestUnderDoesNotMatchOnStringPrefix(t *testing.T) {
	// /srv/game-backup is not inside /srv/game, and a plain
	// strings.HasPrefix says it is — which would hide a directory that
	// has nothing to do with the server, or fail to hide one that does.
	if under("/srv/game", "/srv/game-backup") {
		t.Error("a sibling directory was treated as being inside")
	}
	if !under("/srv/game", "/srv/game/state") {
		t.Error("a real child was not recognised")
	}
	if !under("/srv/game", "/srv/game") {
		t.Error("a root is not inside itself")
	}
}

func TestReadAdminSecretPrefersAHash(t *testing.T) {
	dir := t.TempDir()
	hashFile := filepath.Join(dir, "hash")
	// A real hash, so the test cannot pass on a value the server would
	// later refuse.
	h, err := hashAdminPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(hashFile, []byte(h+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := readAdminSecret(hashFile, "")
	if err != nil {
		t.Fatal(err)
	}
	if got != h {
		t.Errorf("the hash came back changed:\n got %q\nwant %q", got, h)
	}
}

func TestReadAdminSecretHashesAPlaintextFile(t *testing.T) {
	dir := t.TempDir()
	pwFile := filepath.Join(dir, "pw")
	// A trailing newline, because `echo secret > file` is how these get
	// made and a newline that silently changes the password is a bad
	// afternoon.
	if err := os.WriteFile(pwFile, []byte("correct horse battery staple\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := readAdminSecret("", pwFile)
	if err != nil {
		t.Fatal(err)
	}
	if got == "" || !strings.HasPrefix(got, "pbkdf2-") {
		t.Fatalf("the plaintext was not hashed: %q", got)
	}
	if strings.Contains(got, "horse") {
		t.Fatal("the plaintext survived into the stored credential")
	}
}

func TestReadAdminSecretRefusesAmbiguityAndEmptyFiles(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a")
	b := filepath.Join(dir, "b")
	for _, f := range []string{a, b} {
		if err := os.WriteFile(f, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := readAdminSecret(a, b); err == nil {
		t.Error("giving both files should be refused rather than one silently winning")
	}
	empty := filepath.Join(dir, "empty")
	if err := os.WriteFile(empty, []byte("   \n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readAdminSecret("", empty); err == nil {
		t.Error("an empty password file should be refused, not treated as no password")
	}
	if _, err := readAdminSecret("", filepath.Join(dir, "nope")); err == nil {
		t.Error("a missing file should be an error, not silently no admin")
	}
}

func TestNoAdminCredentialMeansNoAdmin(t *testing.T) {
	got, err := readAdminSecret("", "")
	if err != nil || got != "" {
		t.Fatalf("no flags should mean no credential, got %q / %v", got, err)
	}
}

func TestStrandedLegacySnapshotIsNoticed(t *testing.T) {
	// The -data default used to be data/rnr.json. Dropping it means an
	// operator who never passed the flag comes up on an empty store and
	// sees every account, score and mod apparently gone.
	dir := t.TempDir()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(cwd)
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll("data", 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(LegacyDefault, []byte(`{"players":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}

	if got := StrandedLegacyFile(".", "", "", ""); got == "" {
		t.Error("a pre-split snapshot in the default location was not noticed")
	}
	// Anyone who passed a path flag has said where their data is.
	for _, c := range [][3]string{{"s", "", ""}, {"", "a", ""}, {"", "", "other.json"}} {
		if got := StrandedLegacyFile(".", c[0], c[1], c[2]); got != "" {
			t.Errorf("warned about %s despite explicit flags %v", got, c)
		}
	}
	// An empty file is a leftover, not data worth stopping for.
	if err := os.WriteFile(LegacyDefault, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if got := StrandedLegacyFile(".", "", "", ""); got != "" {
		t.Errorf("stopped for an empty file: %s", got)
	}
	if err := os.Remove(LegacyDefault); err != nil {
		t.Fatal(err)
	}
	if got := StrandedLegacyFile(".", "", "", ""); got != "" {
		t.Errorf("stopped with no legacy file at all: %s", got)
	}
}

func TestPasswordTrimmingMatchesTheHasher(t *testing.T) {
	// -hash-password and -admin-password-file have to agree on exactly
	// which bytes are the password. They did not: one stripped the
	// trailing newline, the other TrimSpace'd, so a password with a
	// leading or trailing space hashed differently depending on the
	// route in — and the login silently never matched.
	for _, pw := range []string{" leading", "trailing ", " both ", "pass word", "plain"} {
		dir := t.TempDir()
		f := filepath.Join(dir, "pw")
		// Written the way `echo` writes it.
		if err := os.WriteFile(f, []byte(pw+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		fromFile, err := readAdminSecret("", f)
		if err != nil {
			t.Fatal(err)
		}
		// What -hash-password would have produced from the same bytes.
		if got := trimSecret(pw + "\n"); got != pw {
			t.Fatalf("trimSecret(%q) = %q, want the password back", pw+"\n", got)
		}
		if !verifyAdminPassword(fromFile, pw) {
			t.Errorf("a password of %q cannot log in when supplied by file", pw)
		}
	}
}
