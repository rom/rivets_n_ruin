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
	if !coveredBy(p.Hidden(), p.AccountsFile) {
		t.Error("the account database would still be served")
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
