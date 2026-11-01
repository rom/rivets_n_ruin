package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func serve(t *testing.T, hsts bool, req *http.Request) http.Header {
	return serveProxy(t, hsts, false, req)
}

func serveProxy(t *testing.T, hsts, trustProxy bool, req *http.Request) http.Header {
	t.Helper()
	rec := httptest.NewRecorder()
	secureHeaders(hsts, trustProxy, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
	})).ServeHTTP(rec, req)
	return rec.Result().Header
}

func TestSecurityHeadersAreSet(t *testing.T) {
	h := serve(t, false, httptest.NewRequest("GET", "/", nil))
	want := map[string]string{
		"X-Content-Type-Options":       "nosniff",
		"Referrer-Policy":              "no-referrer",
		"X-Frame-Options":              "DENY",
		"Cross-Origin-Opener-Policy":   "same-origin",
		"Cross-Origin-Resource-Policy": "same-origin",
		"Cross-Origin-Embedder-Policy": "require-corp",
		"X-DNS-Prefetch-Control":       "off",
	}
	for k, v := range want {
		if got := h.Get(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
	if h.Get("Content-Security-Policy") == "" {
		t.Error("no content security policy")
	}
	for _, f := range []string{"camera=()", "geolocation=()", "microphone=()", "payment=()"} {
		if !strings.Contains(h.Get("Permissions-Policy"), f) {
			t.Errorf("Permissions-Policy does not deny %s", f)
		}
	}
}

// The policy is the one header where a single permissive token undoes
// the rest of it, so the dangerous spellings are named rather than left
// to a reviewer to notice.
func TestPolicyHasNoEscapeHatches(t *testing.T) {
	csp := CSP
	for _, bad := range []string{"'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "*", "data: script"} {
		if strings.Contains(csp, bad) {
			t.Errorf("the policy contains %s: %s", bad, csp)
		}
	}
	for _, need := range []string{
		"default-src 'self'", "script-src 'self'", "style-src 'self'",
		"object-src 'none'", "base-uri 'none'", "form-action 'none'",
		"frame-ancestors 'none'",
	} {
		if !strings.Contains(csp, need) {
			t.Errorf("the policy is missing %q: %s", need, csp)
		}
	}
}

// style-src 'self' only holds while the page has no <style> block and no
// style="" attribute. Moving the CSS into a file is what bought it, and
// putting one back would make every stylesheet in the page silently stop
// applying — which is a worse failure than a loose policy, because it
// looks like a CSS bug.
func TestPageHasNoInlineStyle(t *testing.T) {
	for _, f := range []string{"../../index.html"} {
		b := readFile(t, f)
		if strings.Contains(b, "<style") {
			t.Errorf("%s has a <style> block; the policy forbids it", f)
		}
		if strings.Contains(b, "style=\"") {
			t.Errorf("%s has an inline style attribute; the policy forbids it", f)
		}
	}
}

func TestHSTSOnlyOverTLS(t *testing.T) {
	// Announced on a plain-HTTP origin it is ignored by browsers, but a
	// proxy that terminates TLS and forwards cleartext would make it
	// stick — and an HSTS pin you did not mean is a site you cannot
	// reach.
	plain := httptest.NewRequest("GET", "/", nil)
	if got := serve(t, true, plain).Get("Strict-Transport-Security"); got != "" {
		t.Errorf("HSTS sent over plain HTTP: %q", got)
	}

	// X-Forwarded-Proto is attacker-controlled on a directly exposed
	// server, so believing it unconditionally makes the TLS check
	// decoration: any client can satisfy it with one header.
	fwd := httptest.NewRequest("GET", "/", nil)
	fwd.Header.Set("X-Forwarded-Proto", "https")
	if got := serveProxy(t, true, false, fwd).Get("Strict-Transport-Security"); got != "" {
		t.Errorf("a client-supplied X-Forwarded-Proto turned HSTS on without -trust-proxy: %q", got)
	}
	if got := serveProxy(t, true, true, fwd).Get("Strict-Transport-Security"); got == "" {
		t.Error("HSTS not sent behind a TLS-terminating proxy with -trust-proxy")
	}

	// ...and never when it was not asked for.
	if got := serveProxy(t, false, true, fwd).Get("Strict-Transport-Security"); got != "" {
		t.Errorf("HSTS sent without -hsts: %q", got)
	}
}

// The directive that broke every deployment not on localhost.
func TestPolicyDoesNotUpgradeInsecureRequests(t *testing.T) {
	// It rewrites same-origin subresource URLs to https://, and this
	// server speaks plain HTTP: on a LAN address the page would try to
	// fetch its own modules over TLS from a port with no TLS listener
	// and load nothing. 127.0.0.1 is exempt from the directive, which
	// is why the smoke test never saw it.
	if strings.Contains(CSP, "upgrade-insecure-requests") {
		t.Error("upgrade-insecure-requests is back; -addr 0.0.0.0:8000 will not load")
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	return string(b)
}
