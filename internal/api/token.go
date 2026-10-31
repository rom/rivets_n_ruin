package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/rom/rivets_n_ruin/internal/model"
)

// Bearer tokens. Split out from auth.go, which handles registration and
// login; these are the primitives both of those and every authenticated
// route rely on.

// newToken mints a 256-bit bearer token. The server stores only its SHA-256,
// so a leaked snapshot file does not hand over anyone's identity.
func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func hashToken(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

// authed resolves the bearer token to a player, or writes 401 and returns nil.
func (s *Server) authed(w http.ResponseWriter, r *http.Request) *model.Player {
	h := r.Header.Get("Authorization")
	tok, ok := strings.CutPrefix(h, "Bearer ")
	if !ok || tok == "" {
		writeErr(w, http.StatusUnauthorized, "missing bearer token")
		return nil
	}
	p, err := s.store.PlayerByTokenHash(hashToken(tok))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "unknown token")
		return nil
	}
	return p
}
