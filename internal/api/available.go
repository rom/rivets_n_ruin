package api

import (
	"net/http"
	"time"

	"github.com/rom/rivets_n_ruin/internal/validate"
)

// Is this pilot name free?
//
// A sign-up form has to be able to ask, and any endpoint that answers
// is an oracle for "does this account exist". The honest position is
// that pilot names are already public — they are printed on the
// leaderboard — so existence is not the secret here. What is worth
// protecting is everything *else* about an account, and the cheapness
// of harvesting names in bulk.
//
// So the rules are:
//
//   - One name per request, given in full. No prefixes, no patterns,
//     no listing, nothing that returns more than one bit.
//   - That one bit, and nothing beside it. Not the id, not when they
//     were created, not whether they have a password, not their rank.
//     Those are what an enumeration is *for*.
//   - Its own rate limit, an order of magnitude tighter than the rest
//     of the API. A hundred thousand candidate names at this rate is a
//     day and a half from one address, against a leaderboard that
//     lists the interesting names for free.
//   - The same shape, status and work for both answers. A malformed
//     name is rejected before any lookup happens, so the validator
//     cannot be used to tell the two apart either.
//
// Listing players exists, and lives behind the admin credential in
// admin.go, where enumeration is the point rather than a leak.

const (
	NameCheckPerSec = 1
	NameCheckBurst  = 10
)

// The floor on how long an answer takes. A map lookup is far faster
// than a network round trip, so this is belt and braces rather than a
// real defence — but it costs nothing and it means the handler cannot
// be made into a timing oracle by some later change that makes the
// "taken" path do more work than the "free" one.
const nameCheckFloor = 25 * time.Millisecond

func (s *Server) nameAvailable(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	defer func() {
		if d := nameCheckFloor - time.Since(start); d > 0 {
			time.Sleep(d)
		}
	}()

	if !s.nameRL.allow(clientIP(r)) {
		// 429 with no body. Saying which name was being checked back to
		// the caller would put it in logs and proxies for free.
		w.Header().Set("Retry-After", "1")
		writeErr(w, http.StatusTooManyRequests, "slow down")
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body")
		return
	}
	// Validated first, and the failure is about the name's shape rather
	// than about anybody holding it. A caller cannot learn anything
	// from this branch that they could not work out from the rules.
	name, err := validate.PlayerName(req.Name)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	_, lookupErr := s.store.PlayerByName(name)
	writeJSON(w, http.StatusOK, map[string]bool{"available": lookupErr != nil})
}
