package api

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// What this build is, how long it has been up, and which clients it
// will talk to.
//
// None of this existed, which made three ordinary operator questions
// unanswerable from outside: has the server restarted, what is running,
// and is anybody still on an old client. The first two are one line
// each; the third is the one worth the machinery, because "the game is
// broken for some people" is usually "some people are on last month's
// JavaScript" and nothing was counting.

// ClientVersionHeader is what the game sends on every request. A
// header rather than a field in each body: it has to be on reads too,
// and the read endpoints have no body.
const ClientVersionHeader = "X-RNR-Version"

// How long a version sighting counts for. A pilot who played last
// month on an old build is not evidence about today, and without a
// window the tally only ever grows and an upgrade never shows as
// finished.
const versionSeenTTL = 24 * time.Hour

// Build describes the running server. Version is set at link time; see
// the Makefile. It is empty in a `go run`, and says so rather than
// claiming a number it does not have.
type Build struct {
	Version string    `json:"version"`
	Started time.Time `json:"started"`
}

type versionSighting struct {
	Count int       `json:"count"`
	Last  time.Time `json:"last"`
}

// versionTally counts which client versions have been seen lately.
//
// Capped, because the version string arrives from the network and an
// unbounded map keyed on it is a memory leak with a user agent. Past
// the cap new versions are ignored rather than evicting a real one:
// the tally is for noticing a stuck upgrade, and a flood of junk keys
// is not that.
const maxTrackedVersions = 64

type versionTally struct {
	mu   sync.Mutex
	seen map[string]*versionSighting
	now  func() time.Time
}

func newVersionTally(now func() time.Time) *versionTally {
	return &versionTally{seen: map[string]*versionSighting{}, now: now}
}

// note records one request from a client claiming this version.
func (v *versionTally) note(raw string) {
	ver := cleanVersion(raw)
	if ver == "" {
		return
	}
	t := v.now()
	v.mu.Lock()
	defer v.mu.Unlock()
	if s, ok := v.seen[ver]; ok {
		s.Count++
		s.Last = t
		return
	}
	if len(v.seen) >= maxTrackedVersions {
		return
	}
	v.seen[ver] = &versionSighting{Count: 1, Last: t}
}

// report is the tally with stale entries dropped, newest first.
func (v *versionTally) report() map[string]versionSighting {
	cut := v.now().Add(-versionSeenTTL)
	v.mu.Lock()
	defer v.mu.Unlock()
	out := map[string]versionSighting{}
	for ver, s := range v.seen {
		if s.Last.Before(cut) {
			delete(v.seen, ver)
			continue
		}
		out[ver] = *s
	}
	return out
}

// cleanVersion keeps the header honest. It arrives from the network,
// is shown to an operator and is used as a map key, so it is bounded
// and limited to the characters a version actually has. Anything else
// is dropped rather than sanitised: a client sending something that is
// not a version is not a version worth counting.
func cleanVersion(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" || len(s) > 32 {
		return ""
	}
	for _, r := range s {
		ok := (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') ||
			(r >= 'A' && r <= 'Z') || r == '.' || r == '-' || r == '+'
		if !ok {
			return ""
		}
	}
	return s
}

// --- the version gate

// compareVersions orders two dotted numeric versions. Anything that is
// not a number compares as 0, so "1.2.0-rc1" and "1.2.0" are the same
// release, which is the answer an operator wants from a gate: a
// release candidate of an allowed version is allowed.
//
// Returns -1, 0 or 1.
func compareVersions(a, b string) int {
	as, bs := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(as) || i < len(bs); i++ {
		x, y := versionPart(as, i), versionPart(bs, i)
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}

func versionPart(parts []string, i int) int {
	if i >= len(parts) {
		return 0
	}
	// Stop at the first non-digit, so "0-rc1" is 0.
	end := 0
	for end < len(parts[i]) && parts[i][end] >= '0' && parts[i][end] <= '9' {
		end++
	}
	n, _ := strconv.Atoi(parts[i][:end])
	return n
}

// clientAllowed reports whether a client on this version may change
// anything. Empty MinClientVersion means no gate, which is the
// default: a server that refuses every client the moment it is
// upgraded is worse than one that lets an old build keep playing.
//
// A client that sends no version is allowed. The header is new, and
// treating its absence as "too old" would lock out every build that
// predates it — including the ones this is meant to help upgrade.
func (s *Server) clientAllowed(r *http.Request) bool {
	if s.minClient == "" {
		return true
	}
	ver := cleanVersion(r.Header.Get(ClientVersionHeader))
	if ver == "" {
		return true
	}
	return compareVersions(ver, s.minClient) >= 0
}

// requireCurrentClient wraps the handlers that change something. Reads
// are deliberately not gated: an old client that cannot see the
// leaderboard shows a blank title screen, which looks like the server
// being down rather than like a client that needs updating.
func (s *Server) requireCurrentClient(fn http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.clientAllowed(r) {
			writeErr(w, http.StatusUpgradeRequired,
				"this version of the game is too old for this server; reload the page to get the current one")
			return
		}
		fn(w, r)
	}
}

// --- what gets published

type buildInfo struct {
	Version   string    `json:"version"`
	Started   time.Time `json:"started"`
	UptimeSec int64     `json:"uptimeSec"`
	MinClient string    `json:"minClient,omitempty"`
}

func (s *Server) buildInfo() buildInfo {
	return buildInfo{
		Version:   s.build.Version,
		Started:   s.build.Started.UTC(),
		UptimeSec: int64(s.now().Sub(s.build.Started).Seconds()),
		MinClient: s.minClient,
	}
}

// clientVersionsSeen is the tally as a sorted slice, newest version
// first, for the operator page. A map would render in whatever order
// the browser felt like.
type clientVersion struct {
	Version string    `json:"version"`
	Count   int       `json:"count"`
	Last    time.Time `json:"last"`
	Stale   bool      `json:"stale"`
}

func (s *Server) clientVersionsSeen() []clientVersion {
	raw := s.versions.report()
	out := make([]clientVersion, 0, len(raw))
	for ver, sight := range raw {
		out = append(out, clientVersion{
			Version: ver, Count: sight.Count, Last: sight.Last.UTC(),
			Stale: s.minClient != "" && compareVersions(ver, s.minClient) < 0,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if c := compareVersions(out[i].Version, out[j].Version); c != 0 {
			return c > 0
		}
		return out[i].Version < out[j].Version
	})
	return out
}
