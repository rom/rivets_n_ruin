// Package validate rejects implausible score submissions.
//
// IMPORTANT, and stated plainly because it is easy to mistake this for
// security: these are plausibility bounds, not anti-cheat. They stop someone
// curling a score of 10^9 into the leaderboard. They do not stop anyone who
// reads the rules below and submits a number just under the ceiling. Real
// anti-cheat needs the client to submit an input trace that the server
// re-simulates against the same deterministic seed — the game is already
// fully deterministic from LEVEL_SEED and a fixed timestep, so that is
// achievable, but it is a separate piece of work.
package validate

import (
	"fmt"
	"math"
	"strings"
	"unicode"
)

// Mirrors of the client's src/config.js. If the game's tuning changes, these
// move with it, and ScoreRules below goes stale in the player's favour.
const (
	MaxVX        = 310.0
	LevelLen     = 12000.0
	Apron        = 560.0
	TurnaroundAt = LevelLen - Apron*0.55
	FinishAt     = Apron * 0.55
	StartX       = 180.0

	BonusTurnaround = 2500
	BonusComplete   = 5000
	TimeBonusGrace  = 260.0
	TimeBonusRate   = 25.0
	PointsTurret    = 150
	PointsIntercept = 100

	// Interceptors spawn on INTERCEPTOR.spawnEvery * (0.75..1.35).
	FastestSpawnInterval = 1.5 * 0.75

	// Generous allowance for turret count across seeds.
	MaxTurretsPerHull = 40

	// Pickups. At most one drops per kill, and the richest outcome is a
	// lifesaver collected at maximum lives: its own score plus the 500
	// consolation bonus.
	PointsPickup   = 50
	MaxPickupBonus = 500
	MaxPerPickup   = PointsPickup + MaxPickupBonus
)

// MinCompletionSec is the fastest a full out-and-back run can physically be
// flown: the whole distance at maximum velocity, with no acceleration and no
// dodging. Nothing legitimate beats it.
func MinCompletionSec() float64 {
	outbound := TurnaroundAt - StartX
	inbound := TurnaroundAt - FinishAt
	return (outbound + inbound) / MaxVX
}

// Submission is the untrusted payload.
type Submission struct {
	Points    int
	TimeSec   float64
	Turrets   int
	Deaths    int
	Completed bool
}

// MaxPlausiblePoints is the ceiling for a run of the given shape, with slack.
func MaxPlausiblePoints(s Submission) int {
	total := 0
	if s.TimeSec >= MinCompletionSec() {
		total += BonusTurnaround
	}
	if s.Completed {
		total += BonusComplete
		if bonus := (TimeBonusGrace - s.TimeSec) * TimeBonusRate; bonus > 0 {
			total += int(bonus)
		}
	}
	kills := MaxTurretsPerHull + int(math.Ceil(s.TimeSec/FastestSpawnInterval)+4)
	total += PointsTurret * MaxTurretsPerHull
	total += PointsIntercept * (kills - MaxTurretsPerHull)
	// One pickup per kill at most, each worth up to MaxPerPickup.
	total += MaxPerPickup * kills
	return total + 1000 // slack for tuning drift
}

// Score checks one submission. A nil error means the run is possible, not
// that it happened.
func Score(s Submission) error {
	switch {
	case s.Points < 0:
		return fmt.Errorf("points must not be negative")
	case s.TimeSec < 0:
		return fmt.Errorf("time must not be negative")
	case s.TimeSec > 6*60*60:
		return fmt.Errorf("time of %.0fs exceeds the six-hour ceiling", s.TimeSec)
	case s.Turrets < 0:
		return fmt.Errorf("turret count must not be negative")
	case s.Turrets > MaxTurretsPerHull:
		return fmt.Errorf("turret count %d exceeds %d, the most any hull carries", s.Turrets, MaxTurretsPerHull)
	case s.Deaths < 0:
		return fmt.Errorf("death count must not be negative")
	}

	if s.Completed && s.TimeSec < MinCompletionSec() {
		return fmt.Errorf(
			"completed in %.1fs but the hull cannot be flown out and back in under %.1fs at full throttle",
			s.TimeSec, MinCompletionSec())
	}
	if max := MaxPlausiblePoints(s); s.Points > max {
		return fmt.Errorf("score %d exceeds the maximum %d attainable in %.1fs", s.Points, max, s.TimeSec)
	}
	return nil
}

// PlayerName enforces something printable, short, and free of the control
// characters and layout tricks that would otherwise wreck a leaderboard.
func PlayerName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if len([]rune(name)) < 2 {
		return "", fmt.Errorf("name must be at least 2 characters")
	}
	if len([]rune(name)) > 16 {
		return "", fmt.Errorf("name must be at most 16 characters")
	}
	for _, r := range name {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return "", fmt.Errorf("name must not contain control or formatting characters")
		}
	}
	return name, nil
}

// ModName is the same rule with more room.
func ModName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if len([]rune(name)) < 2 {
		return "", fmt.Errorf("mod name must be at least 2 characters")
	}
	if len([]rune(name)) > 40 {
		return "", fmt.Errorf("mod name must be at most 40 characters")
	}
	for _, r := range name {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return "", fmt.Errorf("mod name must not contain control or formatting characters")
		}
	}
	return name, nil
}
