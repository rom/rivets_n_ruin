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
// move with it, and the bounds below go stale in the player's favour.
const (
	BaseMaxVX = 310.0
	Apron     = 560.0
	StartX    = 180.0

	// LEVEL_UP.maxVXAdd: the ship gets faster with every hull cleared, so a
	// later hull can legitimately be flown quicker than the first.
	MaxVXPerLevel = 24.0

	// MODS.afterburner: +40 top speed, buyable on any hull. Leaving it out
	// of the floor made every run by a pilot who had bought it look
	// impossible.
	AfterburnerBonus = 40.0

	BonusTurnaround = 2500
	BonusComplete   = 5000
	TimeBonusGrace  = 260.0
	TimeBonusRate   = 25.0
	PointsTurret    = 150
	PointsIntercept = 100

	// Interceptors spawn on spawnEvery * (0.75..1.35); TANTALUM is fastest.
	FastestSpawnInterval = 0.34 * 0.75

	// Generous allowance for turret count on any one hull.
	// Measured against the generator, not guessed: the longest hull in the
	// deep campaign carries 113. A ceiling under the real count rejects
	// honest runs with a 422, which has happened before.
	MaxTurretsPerHull = 130

	// Pickups. The old model allowed one per kill worth at most 550, which
	// was true when a kill dropped at most one upgrade crate. It has not
	// been true since coins, gold bars, coffins and four tiers of treasure
	// were added: a single boss sheds a hold, and a real 4.6-million run
	// was rejected against a ceiling of 1.7 million.
	//
	// These mirror PICKUP in src/config.js. The parity test compares them.
	PointsPickup    = 50
	MaxPickupBonus  = 500
	CoinValue       = 25
	MaxCoinsPerKill = 5
	BarValue        = 250
	CoffinValue     = 2500
	BestTreasure    = 9000
	BossBarsMax     = 6
	BossCoffinsMax  = 2
	TreasureRolls   = 7

	// Drop rates, from PICKUP in src/config.js, at their most generous
	// (the last hull's treasure odds, and a turret's crate chance).
	CrateChance  = 0.60
	BarChance    = 0.16
	CoffinChance = 0.045

	// Treasure odds climb with the hull and are never capped, so the most
	// generous value is the one on the last hull. Kept as the two parts
	// rather than the product: the product was quietly the eight-hull
	// answer long after the campaign reached twenty-five, and the pieces
	// are what parity.test.mjs can check against src/config.js.
	TreasureBase    = 0.022
	TreasurePerHull = 0.006

	// How far above the expected outcome the bound sits. A plausibility
	// bound has to clear every real run with room to spare; assuming every
	// kill drops everything instead put the ceiling past a billion, which
	// bounds nothing.
	LuckFactor = 4.0

	// SCAVENGER RIG III multiplies what loot is worth; RUIN multiplies
	// every point awarded. Both are legitimately available.
	MaxCoinMul  = 3.6
	MaxScoreMul = 1.7

	// HULL_BONUS in src/config.js, at its most generous: every gun broken,
	// a full sweep, six ships kept, no losses — plus a share of the haul,
	// which is applied to the loot total rather than added flat.
	BonusTowers  = 5000
	BonusSweep   = 4000
	BonusPerLife = 1800
	MaxLives     = 6
	BonusNoLoss  = 2500
	HaulShare    = 0.3
)

// BossRewards mirrors BOSSES[] in src/config.js: the kill score for each
// hull's boss plus the most its destructible sections can pay out. Every
// hull ends in a fight, so leaving these out rejects every finished run.
var BossRewards = []int{
	7200, 9000, 16400, 20400, 26600,
	32000, 44500, 66600, 68370, 72600,
	84780, 89966, 99531, 106294, 125273,
	139295, 146007, 155625, 179627, 191866,
	211796, 227850, 263385, 291658, 309958,
}

// BossPickupDrops is how many pickups a boss can shed: one per section
// destroyed plus a payload on death.
var BossPickupDrops = []int{
	7, 4, 8, 6, 6, 4, 9, 10, 7, 4, 8, 6, 6,
	4, 9, 10, 7, 4, 8, 6, 6, 4, 9, 10, 7,
}

// HullLengths mirrors LEVELS[].length in src/config.js.
var HullLengths = []float64{
	12000, 14500, 17000, 18500, 20000, 21500, 23000, 25000,
	25950, 26900, 27850, 28800, 29750, 30700, 31650, 32600,
	33550, 34500, 35450, 36400, 37350, 38300, 39250, 40200,
	41150,
}

// NumLevels is how many hulls a full campaign runs.
func NumLevels() int { return len(HullLengths) }

// maxTreasureChance is the treasure drop rate on the last hull, which is
// the most generous one in the game. Derived from the hull count rather
// than written down, so adding hulls cannot leave it behind.
func maxTreasureChance() float64 {
	return TreasureBase + TreasurePerHull*float64(len(HullLengths)-1)
}

// minHullSec is the fastest hull n can be flown, at the top speed the ship
// has by the time it gets there.
//
// This used to model a run out and back, because that is what a run was.
// The return leg was removed and this was not, so the floor stayed at
// roughly twice the real one — harmless while the campaign was eight hulls
// and the bound was loose, and an outright rejection of honest completions
// at twenty-five. A validator that is wrong in the strict direction is
// worse than no validator, because it only ever fires on real players.
func minHullSec(n int) float64 {
	length := HullLengths[n]
	// One direction: the launch pad to the boss arena at the far end.
	distance := length - Apron*0.55 - StartX
	// The top speed a ship can have on hull n: every refit so far, plus
	// the afterburner mod, which the model used to leave out entirely.
	speed := BaseMaxVX + MaxVXPerLevel*float64(n) + AfterburnerBonus
	return distance / speed
}

// minRunSec is the fastest the hulls actually flown can be flown. A run
// that starts at hull `from` and ends at hull `to` flies only those.
func minRunSec(from, to int) float64 {
	if from < 0 {
		from = 0
	}
	if to >= len(HullLengths) {
		to = len(HullLengths) - 1
	}
	total := 0.0
	for i := from; i <= to; i++ {
		total += minHullSec(i)
	}
	return total
}

// MinCompletionSec is the fastest a campaign of the given number of hulls can
// physically be flown. Nothing legitimate beats it.
func MinCompletionSec(levels int) float64 {
	if levels < 1 {
		levels = 1
	}
	if levels > len(HullLengths) {
		levels = len(HullLengths)
	}
	total := 0.0
	for i := 0; i < levels; i++ {
		total += minHullSec(i)
	}
	return total
}

// Submission is the untrusted payload.
type Submission struct {
	Points    int
	TimeSec   float64
	Turrets   int
	Deaths    int
	Completed bool
	Levels    int // hulls reached this run; 0 is treated as 1

	// Hulls actually flown. A run may begin on any hull already reached,
	// with the earlier refits credited — so finishing AURUM from a standing
	// start reaches hull eight having flown one. Conflating the two made
	// the time floor demand eight hulls' worth of flying for one hull's
	// run and reject it. Zero means "not reported", and falls back to
	// Levels, which is what every client before this sent.
	HullsFlown int
}

func (s Submission) levels() int {
	if s.Levels < 1 {
		return 1
	}
	if s.Levels > len(HullLengths) {
		return len(HullLengths)
	}
	return s.Levels
}

// MaxPlausiblePoints is the ceiling for a run of the given shape, with slack.
// hullsFlown is how many hulls this run actually covered. Clients before
// the field existed did not send it; for them, reaching hull n means
// flying n, which is what they were assumed to be doing anyway.
func (s Submission) hullsFlown() int {
	n := s.levels()
	if s.HullsFlown <= 0 || s.HullsFlown > n {
		return n
	}
	return s.HullsFlown
}

func MaxPlausiblePoints(s Submission) int {
	n := s.levels()
	total := 0

	// Every hull cleared pays a turnaround bonus, and every hull after the
	// first implies the one before it was finished.
	total += BonusTurnaround * n
	if s.Completed {
		total += BonusComplete * n
		// The time bonus is awarded per hull against that hull's own clock,
		// which is never longer than the whole run.
		if bonus := (TimeBonusGrace - s.TimeSec/float64(n)) * TimeBonusRate; bonus > 0 {
			total += int(bonus) * n
		}
	} else if n > 1 {
		total += BonusComplete * (n - 1)
		total += int(TimeBonusGrace*TimeBonusRate) * (n - 1)
	}

	turrets := MaxTurretsPerHull * n
	interceptors := int(math.Ceil(s.TimeSec/FastestSpawnInterval) + 4)
	kills := turrets + interceptors
	total += PointsTurret * turrets
	total += PointsIntercept * interceptors

	// Each hull reached means its boss could have been fought and killed.
	for i := 0; i < n && i < len(BossRewards); i++ {
		total += BossRewards[i]
	}

	// --- loot
	//
	// The generous reading of every kill: the full coin scatter, an upgrade
	// crate at its best outcome, and a reliquary. No real kill does all
	// three, which is the point — this is a plausibility bound, not a
	// simulation, and being loose here costs a cheat headroom while being
	// tight here rejects people who actually played.
	// Coins always scatter; everything else is a roll, weighted by its own
	// rate and then multiplied by LuckFactor so a lucky run still clears.
	// A crate is capped at one per kill because only one can drop.
	perKill := float64(MaxCoinsPerKill * CoinValue)
	perKill += math.Min(CrateChance*LuckFactor, 1) * (PointsPickup + MaxPickupBonus)
	perKill += BarChance * LuckFactor * BarValue
	perKill += CoffinChance * LuckFactor * CoffinValue
	perKill += maxTreasureChance() * LuckFactor * BestTreasure
	loot := perKill * float64(kills)

	// Every boss additionally sheds a hold.
	perBoss := BossBarsMax*BarValue + BossCoffinsMax*CoffinValue + TreasureRolls*BestTreasure
	loot += float64(perBoss * n)

	// Scavenger lifts what loot is worth, and the haul bonus pays a share
	// of that total on top.
	loot *= MaxCoinMul * (1 + HaulShare)
	total += int(loot)

	// --- the end-of-hull bonus, at its most generous
	perHull := BonusTowers + BonusSweep + BonusPerLife*MaxLives + BonusNoLoss
	total += perHull * n

	// Difficulty multiplies every point awarded.
	total = int(float64(total) * MaxScoreMul)
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
	case s.Levels < 0:
		return fmt.Errorf("level count must not be negative")
	case s.Levels > len(HullLengths):
		return fmt.Errorf("level count %d exceeds the %d hulls in the campaign", s.Levels, len(HullLengths))
	case s.Turrets > MaxTurretsPerHull*len(HullLengths):
		return fmt.Errorf("turret count %d exceeds %d, the most a full campaign carries",
			s.Turrets, MaxTurretsPerHull*len(HullLengths))
	case s.Deaths < 0:
		return fmt.Errorf("death count must not be negative")
	}

	if s.Completed {
		// Over the hulls actually flown, not the hull reached. A run that
		// starts at AURUM flies one hull and reaches eight.
		flown := s.hullsFlown()
		to := s.levels() - 1
		from := to - flown + 1
		if min := minRunSec(from, to); s.TimeSec < min {
			return fmt.Errorf(
				"flew %d hull(s) in %.1fs, which cannot be done in under %.1fs at full throttle",
				flown, s.TimeSec, min)
		}
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
