package api

import (
	"net/http"
	"sync"
	"time"
)

// Client error reports.
//
// The frame loop catches everything and carries on, which is right — a
// glitchy frame is recoverable and a dead loop is not — but it means a
// renderer throwing every frame looks like a frozen picture with a healthy
// score and a plausible frame rate. Nobody has a console open. So the
// client sends them here and they go into the server log, where somebody
// will actually see them.
//
// This endpoint takes unauthenticated input from any browser, so it is
// sized as if that input were hostile: everything is bounded, the batch is
// capped, the strings are truncated, and the per-IP rate limiter in front
// of /api/ applies as it does everywhere else. Nothing here is stored
// beyond a small in-memory ring, so the worst a flood can do is roll that
// ring and cost some log lines.

const (
	maxErrorsPerBatch = 20
	maxErrorMessage   = 500
	maxErrorStack     = 2000
	maxErrorKind      = 32
	errorRingSize     = 200
)

type clientError struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
	Stack   string `json:"stack,omitempty"`
	Count   int    `json:"count"`
	At      string `json:"at,omitempty"`
	State   string `json:"state,omitempty"`
	Hull    int    `json:"hull,omitempty"`
	Build   string `json:"build,omitempty"`
	Agent   string `json:"agent,omitempty"`
}

type clientErrorReq struct {
	Errors  []clientError `json:"errors"`
	Dropped int           `json:"dropped"`
}

// errorRing keeps the most recent reports so /api/stats can say whether
// anything is going wrong without anyone having to read the log. It is
// deliberately a count and not the contents: the reports hold stack traces
// from other people's browsers, and there is no admin tier here to put
// them behind.
type errorRing struct {
	mu      sync.Mutex
	entries []clientError
	next    int
	total   int
	dropped int
	since   time.Time
}

func newErrorRing() *errorRing {
	return &errorRing{entries: make([]clientError, errorRingSize), since: time.Now()}
}

func (r *errorRing) add(e clientError) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries[r.next] = e
	r.next = (r.next + 1) % len(r.entries)
	r.total++
}

func (r *errorRing) noteDropped(n int) {
	if n <= 0 {
		return
	}
	r.mu.Lock()
	r.dropped += n
	r.mu.Unlock()
}

// summary is what goes in /api/stats: how much is going wrong, not what.
func (r *errorRing) summary() map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	kinds := map[string]int{}
	held := 0
	for _, e := range r.entries {
		if e.Message == "" {
			continue
		}
		held++
		kinds[e.Kind]++
	}
	return map[string]any{
		"reported": r.total,
		"dropped":  r.dropped,
		"held":     held,
		"kinds":    kinds,
		"since":    r.since.UTC().Format(time.RFC3339),
	}
}

func clipStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	// Cut on a rune boundary so the log does not get half a character.
	cut := n
	for cut > 0 && !isUTF8Start(s[cut]) {
		cut--
	}
	return s[:cut] + "…"
}

func isUTF8Start(b byte) bool { return b&0xC0 != 0x80 }

func (s *Server) reportErrors(w http.ResponseWriter, r *http.Request) {
	var req clientErrorReq
	if err := readJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed body: "+err.Error())
		return
	}
	if len(req.Errors) == 0 {
		// Nothing to do, and not a problem: a client that batches will
		// occasionally flush an empty batch on unload.
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if len(req.Errors) > maxErrorsPerBatch {
		req.Errors = req.Errors[:maxErrorsPerBatch]
	}
	s.errs.noteDropped(req.Dropped)

	// The agent is taken from the request rather than the body: a client
	// can say anything, and the one we are told by the transport is at
	// least the one that connected.
	agent := clipStr(r.UserAgent(), 160)

	for _, e := range req.Errors {
		e.Kind = clipStr(e.Kind, maxErrorKind)
		e.Message = clipStr(e.Message, maxErrorMessage)
		e.Stack = clipStr(e.Stack, maxErrorStack)
		e.State = clipStr(e.State, 24)
		e.Build = clipStr(e.Build, 40)
		e.Agent = agent
		if e.Count < 1 {
			e.Count = 1
		}
		if e.Message == "" {
			continue
		}
		s.errs.add(e)
		s.log.Warn("client error",
			"kind", e.Kind, "message", e.Message, "count", e.Count,
			"state", e.State, "hull", e.Hull, "agent", agent, "stack", e.Stack)
	}
	w.WriteHeader(http.StatusNoContent)
}
