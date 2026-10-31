package api

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// This endpoint takes unauthenticated input from any browser, so it is
// tested as if that input were hostile.

func TestClientErrorsAreAccepted(t *testing.T) {
	h := newTestServer(t)
	rec, body := do(t, h, "POST", "/api/errors", "", map[string]any{
		"errors": []map[string]any{
			{"kind": "frame", "message": "TypeError: x is undefined",
				"stack": "at drawWorld (/src/render.js:120:9)", "count": 37,
				"state": "play", "hull": 4},
		},
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("got %d %v, want 204", rec.Code, body)
	}

	// It shows up in the summary as a count, not as its contents: the
	// reports hold stack traces from other people's browsers and there is
	// no admin tier here to put them behind.
	_, stats := do(t, h, "GET", "/api/stats", "", nil)
	ce, _ := stats["clientErrors"].(map[string]any)
	if ce == nil {
		t.Fatalf("no clientErrors in %v", stats)
	}
	if ce["reported"].(float64) != 1 {
		t.Errorf("reported %v, want 1", ce["reported"])
	}
	kinds, _ := ce["kinds"].(map[string]any)
	if kinds["frame"].(float64) != 1 {
		t.Errorf("kinds came back as %v", kinds)
	}
	for _, leaky := range []string{"message", "stack", "errors", "recent"} {
		if _, found := ce[leaky]; found {
			t.Errorf("the public summary includes %q, which carries other people's data", leaky)
		}
	}
	if !strings.Contains(fmt.Sprint(stats), "players") {
		t.Error("the error summary replaced the rest of /api/stats rather than joining it")
	}
}

func TestAnEmptyBatchIsFine(t *testing.T) {
	h := newTestServer(t)
	rec, _ := do(t, h, "POST", "/api/errors", "", map[string]any{"errors": []any{}})
	if rec.Code != http.StatusNoContent {
		t.Errorf("an empty batch gave %d, want 204 — a client that batches will send one", rec.Code)
	}
}

func TestClientErrorsRejectMalformedBodies(t *testing.T) {
	h := newTestServer(t)
	rec, _ := doRaw(t, h, "POST", "/api/errors", "", "{{{ not json")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("a malformed body gave %d, want 400", rec.Code)
	}
}

// A browser can send anything. Nothing it sends may be unbounded.
//
// Deliberately many SMALL entries: a batch of 500 huge ones is rejected by
// the body-size limit before the count cap is ever consulted, so a test
// built that way passes with the cap deleted.
func TestABatchIsCappedByCount(t *testing.T) {
	h := newTestServer(t)
	many := make([]map[string]any, 500)
	for i := range many {
		many[i] = map[string]any{"kind": "frame", "message": fmt.Sprintf("fault %d", i)}
	}
	rec, body := do(t, h, "POST", "/api/errors", "", map[string]any{"errors": many})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("a 500-entry batch of small errors gave %d %v", rec.Code, body)
	}

	_, stats := do(t, h, "GET", "/api/stats", "", nil)
	ce, _ := stats["clientErrors"].(map[string]any)
	if got := ce["reported"].(float64); got > maxErrorsPerBatch {
		t.Errorf("accepted %v reports from one batch, the cap is %d", got, maxErrorsPerBatch)
	}
}

// And oversized fields are cut rather than taking the request down.
func TestOversizedFieldsAreSurvivable(t *testing.T) {
	h := newTestServer(t)
	rec, _ := do(t, h, "POST", "/api/errors", "", map[string]any{
		"errors": []map[string]any{{
			"kind":    strings.Repeat("k", 500),
			"message": strings.Repeat("m", 5000),
			"stack":   strings.Repeat("s", 9000),
			"state":   strings.Repeat("t", 500),
			"build":   strings.Repeat("b", 500),
			"count":   -9999,
			"hull":    1 << 30,
		}},
	})
	if rec.Code != http.StatusNoContent && rec.Code != http.StatusBadRequest {
		t.Fatalf("an oversized report gave %d", rec.Code)
	}
}

func TestFieldsAreTruncatedRatherThanRejected(t *testing.T) {
	long := strings.Repeat("é", 4000) // multi-byte, so a naive cut would split a rune
	for _, s := range []string{long, "short", ""} {
		for _, n := range []int{0, 1, 5, 100, 10000} {
			got := clipStr(s, n)
			if len(got) > n+len("…") {
				t.Errorf("clipStr(%d chars, %d) returned %d bytes", len(s), n, len(got))
			}
			if !utf8Valid(got) {
				t.Errorf("clipStr(%d chars, %d) split a rune", len(s), n)
			}
		}
	}
}

func utf8Valid(s string) bool {
	for _, r := range s {
		if r == '�' {
			return false
		}
	}
	return true
}

func TestDroppedCountsAreCarried(t *testing.T) {
	h := newTestServer(t)
	do(t, h, "POST", "/api/errors", "", map[string]any{
		"errors":  []map[string]any{{"kind": "frame", "message": "one"}},
		"dropped": 17,
	})
	_, stats := do(t, h, "GET", "/api/stats", "", nil)
	ce, _ := stats["clientErrors"].(map[string]any)
	if ce["dropped"].(float64) != 17 {
		t.Errorf("dropped came back as %v, want 17 — the client hitting its cap is itself a signal",
			ce["dropped"])
	}
}

// An entry with nothing in it is not worth a log line.
func TestAnEmptyMessageIsNotRecorded(t *testing.T) {
	h := newTestServer(t)
	do(t, h, "POST", "/api/errors", "", map[string]any{
		"errors": []map[string]any{{"kind": "frame", "message": ""}, {"kind": "frame", "message": "real"}},
	})
	_, stats := do(t, h, "GET", "/api/stats", "", nil)
	ce, _ := stats["clientErrors"].(map[string]any)
	if ce["reported"].(float64) != 1 {
		t.Errorf("recorded %v reports, want only the one with a message", ce["reported"])
	}
}

// The ring is fixed size: a flood costs log lines and rolls the ring, and
// cannot cost memory without bound.
func TestTheRingRollsRatherThanGrows(t *testing.T) {
	r := newErrorRing()
	for i := 0; i < errorRingSize*3; i++ {
		r.add(clientError{Kind: "frame", Message: fmt.Sprintf("fault %d", i), Count: 1})
	}
	if len(r.entries) != errorRingSize {
		t.Errorf("the ring grew to %d", len(r.entries))
	}
	s := r.summary()
	if s["held"].(int) != errorRingSize {
		t.Errorf("holding %v entries, want %d", s["held"], errorRingSize)
	}
	if s["reported"].(int) != errorRingSize*3 {
		t.Errorf("reported %v, want %d — the total must count everything, not just what is held",
			s["reported"], errorRingSize*3)
	}
}
