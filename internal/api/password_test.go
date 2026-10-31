package api

import (
	"strings"
	"testing"
)

func TestPasswordRoundTrip(t *testing.T) {
	enc, err := hashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !verifyPassword(enc, "correct horse battery staple") {
		t.Fatal("the right password did not verify")
	}
	if verifyPassword(enc, "correct horse battery stapl") {
		t.Fatal("a wrong password verified")
	}
	if verifyPassword(enc, "") {
		t.Fatal("an empty password verified")
	}
}

func TestPasswordHashIsSaltedAndOpaque(t *testing.T) {
	a, _ := hashPassword("same password")
	b, _ := hashPassword("same password")
	if a == b {
		t.Fatal("two hashes of the same password are identical — no salt")
	}
	if strings.Contains(a, "same password") {
		t.Fatal("the hash contains the password")
	}
	if !strings.HasPrefix(a, "pbkdf2-sha256$") {
		t.Fatalf("hash does not record its own parameters: %q", a)
	}
}

func TestVerifyRejectsMalformedRecords(t *testing.T) {
	for _, bad := range []string{
		"", "nonsense", "pbkdf2-sha256$notanumber$aa$bb",
		"pbkdf2-sha256$1$aa$bb",       // iteration count below the floor
		"pbkdf2-sha256$240000$!!!$bb", // bad base64 salt
		"pbkdf2-sha256$240000$aa$!!!", // bad base64 key
		"scrypt$240000$aa$bb",         // wrong algorithm
	} {
		if verifyPassword(bad, "anything") {
			t.Errorf("malformed record verified: %q", bad)
		}
	}
}

func TestValidatePassword(t *testing.T) {
	if err := validatePassword("longenough"); err != nil {
		t.Errorf("rejected a reasonable password: %v", err)
	}
	// length is the rule; composition is deliberately not
	if err := validatePassword("aaaaaaaaaaaaaaaaaaaa"); err != nil {
		t.Errorf("rejected a long simple password: %v", err)
	}
	for _, bad := range []string{"", "short", strings.Repeat("x", 500), "has\x00null"} {
		if err := validatePassword(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
}
