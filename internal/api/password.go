package api

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// Password storage.
//
// PBKDF2-HMAC-SHA256 from the standard library. Argon2id would be the
// better choice and is what this should use if a dependency ever becomes
// acceptable; PBKDF2 at a high iteration count is the strongest thing
// available without one, and is a great deal better than the alternative of
// inventing something.
//
// The encoded form carries its own parameters, so the cost can be raised
// later without invalidating existing hashes.

const (
	pbkdfIters  = 240_000
	pbkdfKeyLen = 32
	saltLen     = 16
)

func hashPassword(pw string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, pw, salt, pbkdfIters, pbkdfKeyLen)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s",
		pbkdfIters,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

// verifyPassword is constant-time in the comparison. It returns false for a
// malformed record rather than erroring, so a corrupt row cannot be used to
// distinguish "no such user" from "wrong password".
func verifyPassword(encoded, pw string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iters, err := strconv.Atoi(parts[1])
	if err != nil || iters < 1000 || iters > 10_000_000 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, pw, salt, iters, len(want))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}

// Deliberately permissive on composition and strict only on length. Rules
// demanding a digit and a symbol push people toward predictable passwords;
// length is the property that actually matters.
func validatePassword(pw string) error {
	n := len([]rune(pw))
	if n < 8 {
		return fmt.Errorf("password must be at least 8 characters")
	}
	if n > 200 {
		return fmt.Errorf("password must be at most 200 characters")
	}
	for _, r := range pw {
		if unicode.IsControl(r) {
			return fmt.Errorf("password must not contain control characters")
		}
	}
	return nil
}
