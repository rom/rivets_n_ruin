package api

import (
	"net/http"
	"testing"
)

func TestHangarRoundTrips(t *testing.T) {
	srv := newTestServer(t)
	_, tok := register(t, srv, "HANGARPILOT")

	// Empty, not missing: a pilot who has banked nothing still gets a
	// usable object, so the client has one case fewer to handle.
	var got map[string]any
	{
		w, out := do(t, srv, "GET", "/api/me/hangar", tok, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("%s %s: status %d body %s", "GET", "/api/me/hangar", w.Code, w.Body)
		}
		got = out
	}
	if got["coins"].(float64) != 0 || got["bars"].(float64) != 0 {
		t.Fatalf("a fresh hangar is not empty: %v", got)
	}

	body := map[string]any{"coins": 1200, "bars": 4, "mods": map[string]int{"reclaimer": 3}}
	{
		w, out := do(t, srv, "PUT", "/api/me/hangar", tok, body)
		if w.Code != http.StatusOK {
			t.Fatalf("%s %s: status %d body %s", "PUT", "/api/me/hangar", w.Code, w.Body)
		}
		got = out
	}
	if got["coins"].(float64) != 1200 {
		t.Fatalf("coins did not stick: %v", got)
	}

	var back map[string]any
	{
		w, out := do(t, srv, "GET", "/api/me/hangar", tok, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("%s %s: status %d body %s", "GET", "/api/me/hangar", w.Code, w.Body)
		}
		back = out
	}
	if back["coins"].(float64) != 1200 || back["bars"].(float64) != 4 {
		t.Fatalf("the hangar did not survive the round trip: %v", back)
	}
	mods := back["mods"].(map[string]any)
	if mods["reclaimer"].(float64) != 3 {
		t.Fatalf("mods did not survive: %v", mods)
	}
}

func TestHangarIsClampedOnTheWayIn(t *testing.T) {
	// Everything here arrives from a client. A balance of 1e300 or a
	// thousand invented mod ids must not reach the HUD or the shop.
	srv := newTestServer(t)
	_, tok := register(t, srv, "CLAMPPILOT")

	huge := map[string]int{}
	for i := 0; i < 500; i++ {
		huge[string(rune('a'+i%26))+string(rune('a'+i/26))] = 1
	}
	var got map[string]any
	{
		w, out := do(t, srv, "PUT", "/api/me/hangar", tok, map[string]any{
			"coins": 1e18, "bars": -40, "mods": huge,
		})
		if w.Code != http.StatusOK {
			t.Fatalf("%s %s: status %d body %s", "PUT", "/api/me/hangar", w.Code, w.Body)
		}
		got = out
	}

	if c := got["coins"].(float64); c != 1_000_000_000 {
		t.Errorf("coins came back %v, want the cap", c)
	}
	if b := got["bars"].(float64); b != 0 {
		t.Errorf("a negative balance became %v, want 0", b)
	}
	if n := len(got["mods"].(map[string]any)); n > 64 {
		t.Errorf("%d mods were kept, want at most 64", n)
	}
	// The response is the clamped value, not an echo, so a client that
	// sent something out of range learns it rather than drifting.
	var back map[string]any
	{
		w, out := do(t, srv, "GET", "/api/me/hangar", tok, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("%s %s: status %d body %s", "GET", "/api/me/hangar", w.Code, w.Body)
		}
		back = out
	}
	if back["coins"] != got["coins"] {
		t.Errorf("PUT returned %v but GET says %v", got["coins"], back["coins"])
	}
}

func TestHangarNeedsAnAccount(t *testing.T) {
	srv := newTestServer(t)
	for _, m := range []string{"GET", "PUT"} {
		if w, _ := do(t, srv, m, "/api/me/hangar", "", map[string]any{"coins": 1}); w.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s: status %d body %s", m, "/api/me/hangar", w.Code, w.Body)
		}
	}
	if w, _ := do(t, srv, "GET", "/api/me/hangar", "not-a-real-token", nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("%s %s: status %d body %s", "GET", "/api/me/hangar", w.Code, w.Body)
	}
}

func TestOneHangarPerPilot(t *testing.T) {
	// The bug this guards: keying the hangar off anything but the
	// player id — the token, say, which changes on re-login — hands one
	// pilot another's purchases.
	srv := newTestServer(t)
	_, a := register(t, srv, "PILOTONE")
	_, b := register(t, srv, "PILOTTWO")

	if w, _ := do(t, srv, "PUT", "/api/me/hangar", a, map[string]any{"coins": 777}); w.Code != http.StatusOK {
		t.Fatalf("%s %s: status %d body %s", "PUT", "/api/me/hangar", w.Code, w.Body)
	}

	var got map[string]any
	{
		w, out := do(t, srv, "GET", "/api/me/hangar", b, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("%s %s: status %d body %s", "GET", "/api/me/hangar", w.Code, w.Body)
		}
		got = out
	}
	if got["coins"].(float64) != 0 {
		t.Fatalf("a second pilot can see the first one's hangar: %v", got)
	}
}
