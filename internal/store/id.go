package store

import (
	"crypto/rand"
	"encoding/hex"
)

// newID returns a 128-bit random identifier. crypto/rand.Read is documented
// never to return a short read without an error, and an unusable CSPRNG is
// not something a score board can sensibly continue past.
func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("store: crypto/rand unavailable: " + err.Error())
	}
	return hex.EncodeToString(b)
}
