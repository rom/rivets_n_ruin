package api

import (
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"
)

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *statusWriter) WriteHeader(c int) { w.status = c; w.ResponseWriter.WriteHeader(c) }
func (w *statusWriter) Write(b []byte) (int, error) {
	n, err := w.ResponseWriter.Write(b)
	w.bytes += n
	return n, err
}

func logging(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			start := time.Now()
			next.ServeHTTP(sw, r)
			log.Info("request",
				"method", r.Method, "path", r.URL.Path, "status", sw.status,
				"bytes", sw.bytes, "dur", time.Since(start).Round(time.Microsecond).String())
		})
	}
}

// recoverer keeps one bad request from taking the whole score board down.
func recoverer(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if v := recover(); v != nil {
					log.Error("panic serving request", "path", r.URL.Path, "panic", v)
					writeErr(w, http.StatusInternalServerError, "internal error")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// cors is permissive because the API is public-read and the game may be
// served from anywhere. Writes are gated by bearer token, not by origin.
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --------------------------------------------------------------- rate limit

type bucket struct {
	tokens float64
	last   time.Time
}

// rateLimiter is a per-IP token bucket: 'burst' requests immediately, then
// 'rate' per second. Enough to stop a loop hammering score submission; it is
// not DDoS protection, which belongs in front of the process.
//
// Keyed on IP, which means players sharing a NAT share a bucket. For a small
// score board that is an acceptable trade against the alternative (keying on
// the bearer token, which lets anyone mint unlimited buckets by registering).
// If real players ever start colliding, raise the limits rather than changing
// the key.
type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64
	burst   float64
}

const (
	sweepEvery    = 5 * time.Minute
	idleBucketTTL = 10 * time.Minute
)

func newRateLimiter(rate, burst float64) *rateLimiter {
	if rate <= 0 {
		rate = 10
	}
	if burst <= 0 {
		burst = 40
	}
	rl := &rateLimiter{buckets: map[string]*bucket{}, rate: rate, burst: burst}
	go rl.sweep()
	return rl
}

// sweep drops idle buckets so a long-running server does not accumulate one
// entry per IP that ever connected.
//
// Split from its timer so the thing being tested is the rule and not the
// clock: a test of the loop itself can only be a five-minute sleep or a
// fake clock, and neither tells you whether the right buckets go.
func (rl *rateLimiter) sweep() {
	for range time.Tick(sweepEvery) {
		rl.sweepOnce(time.Now().Add(-idleBucketTTL))
	}
}

func (rl *rateLimiter) sweepOnce(cutoff time.Time) int {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	n := 0
	for ip, b := range rl.buckets {
		if b.last.Before(cutoff) {
			delete(rl.buckets, ip)
			n++
		}
	}
	return n
}

func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	b, ok := rl.buckets[ip]
	if !ok {
		rl.buckets[ip] = &bucket{tokens: rl.burst - 1, last: now}
		return true
	}
	b.tokens += now.Sub(b.last).Seconds() * rl.rate
	if b.tokens > rl.burst {
		b.tokens = rl.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (rl *rateLimiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rl.allow(clientIP(r)) {
			w.Header().Set("Retry-After", "1")
			writeErr(w, http.StatusTooManyRequests, "slow down")
			return
		}
		next.ServeHTTP(w, r)
	})
}
