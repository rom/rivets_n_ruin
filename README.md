# Rivets 'n Ruin

A side-scrolling shoot 'em up in the lineage of **Uridium** (skim the surface of a
capital ship, two-way scrolling, momentum-heavy handling) and **Jets'n'Guns**
(mercenary swagger, things exploding at a generous rate).

You fly the dorsal hull of a dreadnought end to end — then you have to fly it
back. The hull is solid. Hitting it costs you.

![Rivets 'n Ruin](docs/scene-boss.png)

*GILTHAMMER, the guard at the end of the AURUM hull.*

## Running it

```bash
make run
```

Then open <http://localhost:8000>. One process serves both the game and the
backend API, so there is one thing to run and no CORS to think about.

`make` on its own lists every target. The useful ones:

| Target | Does |
| --- | --- |
| `make run` | Game + backend. `ADDR=0.0.0.0:8000 make run` to expose it |
| `make check` | Everything CI would: gofmt, vet, race tests, JS syntax |
| `make test` / `test-race` | Go tests |
| `make test-js` | Client tests |
| `make coverage` | Coverage, both sides |
| `make smoke` | Launch the game and assert it renders and scrolls |
| `make build` / `dist` | Binary / self-contained release tree |
| `make icons` | Regenerate the favicon |

Server flags: `-addr`, `-dir`, `-data`, `-save-interval`, `-rate-limit`,
`-rate-burst`, `-v`.

> **A note on `node --check`.** It reports success on a `.js` file containing ES
> module syntax even when the file is genuinely unparseable — it only diagnoses
> correctly when the extension is `.mjs`. Every client module here is ESM in a
> `.js` file, so checking them directly is a gate that cannot fail. `make
> js-check` copies to `.mjs` first. If you add your own check, do the same.

The game has no build step and no client dependencies — plain ES modules and
canvas. The server is Go stdlib only. **The game is fully playable with the
backend down**; you lose the leaderboard, not the game.

## Controls

| Key | Action |
| --- | --- |
| `←` `→` / `A` `D` | Horizontal thrust. Thrusting against your heading brakes, then flips the ship |
| `↑` `↓` / `W` `S` | Vertical thrust |
| `Z` / `Space` | Fire |
| `Enter` | Launch / restart |
| `P` / `Esc` | Pause |
| `M` | Mute / unmute |
| `T` | Next tune |
| `O` | Settings |
| `B` | Switch leaderboard: top pilots / high scores |
| `X` | Fire selected ordnance |
| `C` / `1`–`3` | Cycle / select ordnance |
| `E` | Armourer (between hulls) |
| `N` | Rename your pilot (title screen) |
| `Q` | Quit the run (asks first; `Y` confirms, `N` cancels) |
| `R` | Restart mid-run |

## Screenshots

| | |
| --- | --- |
| ![Title](docs/scene-title.png) | ![Help](docs/help-1.png) |
| The title: a backdrop, a hull to pick, and four ways out | Help, on three pages — `H` from anywhere that is not flight |
| ![Refit](docs/scene-refit.png) | ![Settings](docs/settings.png) |
| The refit between hulls, with the next one drawn to scale | Settings, including which hull a run starts on |
| ![Armory](docs/armory.png) | ![Attackers](docs/attackers.png) |
| A bomb, a grenade and a missile in the air at once | The attacker roster |
| ![Minibosses](docs/minibosses.png) | ![Boss](docs/scene-boss.png) |
| The miniboss roster | GILTHAMMER, in the arena at the end of AURUM |
| ![Radar](docs/radar.png) | ![Treasure](docs/treasure.png) |
| The radar: guns, loot, minibosses, the arena | Coins, a bar, a coffin and the four treasures |
| ![Overview](docs/overview.png) | ![Shop](docs/shop.png) |
| The hull bonus, the refit and the mods fitted | The armourer between hulls |
| ![Laser gate](docs/laser.png) | ![Deflector shields](docs/shields.png) |
| A laser gate: shoot the emitter or go no further | Deflectors, from whole to nearly gone |
| ![Mark I](docs/ship-1.png) | ![Mark VIII](docs/ship-8.png) |
| The ship as issued | The same ship eight hulls and six mods later |

## The hulls

Twenty-five of them, each a different place rather than the same place
rearranged. Length, obstacle density, turret toughness and which attackers
appear are all per-hull; so is the palette, which cycles eight themes.

The first eight are shown in full below; past that, every fourth.

| | |
| --- | --- |
| ![ARGENTUM](docs/hull-01-argentum.png) | ![OSMIUM](docs/hull-02-osmium.png) |
| **1 · ARGENTUM** — silver class, patrol hull. 12,000px, steel | **2 · OSMIUM** — densest alloy afloat, line hull. 14,500px, abyssal |
| ![TANTALUM](docs/hull-03-tantalum.png) | ![CUPRUM](docs/hull-04-cuprum.png) |
| **3 · TANTALUM** — corrosion proof, flagship hull. 17,000px, cryolite | **4 · CUPRUM** — oxidised, salvage hulk. 18,500px, verdigris |
| ![PYRITE](docs/hull-05-pyrite.png) | ![WOLFRAM](docs/hull-06-wolfram.png) |
| **5 · PYRITE** — running hot, foundry hull. 20,000px, pyrite | **6 · WOLFRAM** — light swallowing, siege hull. 21,500px, obsidian |
| ![FERRUM](docs/hull-07-ferrum.png) | ![AURUM](docs/hull-08-aurum.png) |
| **7 · FERRUM** — eaten through, derelict hull. 23,000px, rust | **8 · AURUM** — the prize, admiralty hull. 25,000px, aurum |
| ![NICCOLUM](docs/hull-12-niccolum.png) | ![TITANIUM](docs/hull-16-titanium.png) |
| **12 · NICCOLUM** — devil's copper, survey hull. 28,800px | **16 · TITANIUM** — unbowed, assault hull. 32,600px |
| ![PALLADIUM](docs/hull-20-palladium.png) | ![ADAMAS](docs/hull-24-adamas.png) |
| **20 · PALLADIUM** — the ward, guardian hull. 36,400px | **24 · ADAMAS** — unconquerable, siege carrier. 40,200px |

Every image above is generated by `make gallery`, which drives the real game
in a browser and screenshots it. Drawing them by hand would mean the
documentation drifts from the code the first time a palette changes.

## The run

Twenty-five hulls, flown back to back. Each one is longer, denser and
better defended than the last, and each is named for a metal — Uridium's
stage-naming ritual.

The first eight are hand-authored: they are the tutorial, and each one
introduces something. Past that the job is a curve rather than a sequence
of ideas, so the rest are generated from one — every column only goes one
way, and nothing can be left out of a hull by accident. The names are
still written down, because a hull called LEVEL 19 is not a place.

| Hull | Length | Turret HP | Interceptors | Tune |
| --- | --- | --- | --- | --- |
| **ARGENTUM** — patrol hull | 12,000px | 6 | 172px/s, every 1.5s | DROSS |
| **OSMIUM** — line hull | 14,500px | 8 | 196px/s, every 1.2s | QUENCH |
| **TANTALUM** — flagship hull | 17,000px | 9 | 220px/s, every 0.98s | GANTRY |
| **CUPRUM** — salvage hulk | 18,500px | 11 | 236px/s, every 0.9s | OVERDRIVE |
| **PYRITE** — foundry hull | 20,000px | 13 | 252px/s, every 0.82s | CORSAIR |
| **WOLFRAM** — siege hull | 21,500px | 15 | 266px/s, every 0.75s | VACUUM |
| **FERRUM** — derelict hull | 23,000px | 16 | 280px/s, every 0.7s | BLACKSTAR |
| **AURUM** — admiralty hull | 25,000px | 18 | 294px/s, every 0.64s | HAMMERFALL |
| **PLUMBUM** — ballast hull | 25,950px | 20 | 300px/s, every 0.622s | DROSS |
| **STANNUM** — tender hull | 26,900px | 22 | 306px/s, every 0.604s | QUENCH |
| **ZINCUM** — anode hull | 27,850px | 24 | 312px/s, every 0.5860000000000001s | OVERDRIVE |
| **NICCOLUM** — survey hull | 28,800px | 26 | 318px/s, every 0.5680000000000001s | VACUUM |
| **COBALTUM** — picket hull | 29,750px | 28 | 324px/s, every 0.55s | GANTRY |
| **CHROMIUM** — parade hull | 30,700px | 30 | 330px/s, every 0.532s | CORSAIR |
| **VANADIUM** — armour hull | 31,650px | 32 | 336px/s, every 0.514s | BLACKSTAR |
| **TITANIUM** — assault hull | 32,600px | 34 | 342px/s, every 0.496s | HAMMERFALL |
| **IRIDIUM** — relic hull | 33,550px | 36 | 348px/s, every 0.47800000000000004s | DROSS |
| **PLATINUM** — treasury hull | 34,500px | 38 | 354px/s, every 0.46s | QUENCH |
| **RHODIUM** — courier hull | 35,450px | 40 | 360px/s, every 0.44200000000000006s | OVERDRIVE |
| **PALLADIUM** — guardian hull | 36,400px | 42 | 366px/s, every 0.42400000000000004s | VACUUM |
| **OSMIRIDIUM** — anvil hull | 37,350px | 44 | 372px/s, every 0.406s | GANTRY |
| **THORIUM** — reactor hull | 38,300px | 46 | 378px/s, every 0.388s | CORSAIR |
| **URANIUM** — warhead hull | 39,250px | 48 | 384px/s, every 0.37000000000000005s | BLACKSTAR |
| **ADAMAS** — siege carrier | 40,200px | 50 | 390px/s, every 0.35200000000000004s | HAMMERFALL |
| **ORICHALCUM** — flagship of the line | 41,150px | 52 | 396px/s, every 0.34s | DROSS |

One hull, one direction: fly to the far end, **kill what is guarding it**,
and the way out opens. The ship then flies itself through — controls locked,
accelerating, off the right-hand edge — and the next hull is waiting.

It used to send you back down the same hull the other way. That doubled
every run without adding anything to it: the guns were already broken and
the loot already collected, so the return leg was a commute. What is left is
the part that was always the game.

Dying out of ships ends the run wherever you are.

The tune table above is per hull; each one also has its own theme, attacker
roster, tower roster and laser gates.

## Your ship

![Mark I](docs/ship-1.png)
![Mark IV](docs/ship-4.png)
![Mark VIII](docs/ship-8.png)

It used to be one sprite for the whole campaign. Eight refits, six mods,
three kinds of ordnance and two gun lines all happened entirely in the
numbers: the thing on screen at the end of AURUM was the thing that
launched off ARGENTUM. The one object you look at for the entire run never
changed.

Everything is now read off the ship's actual state, every frame:

| What changed | What you see |
| --- | --- |
| **A hull cleared** | The next **MARK**: a longer airframe, a wider wing, another engine bell, more structure — and gilding on the last two |
| **GUNSPEED** | One more barrel on the nose, per level |
| **GUNBLAZE** | One more angled pod pair, per level |
| **Bombs** | A rack under the belly with ordnance on it |
| **Grenades** | Canisters on the shoulder rail |
| **Missiles** | A missile rail, loaded |
| **LODESTONE** | A coil stack on the spine — one ring per tier, with a field haze |
| **ABLATIVE PLATING** | The armour slabs on the flanks go from dark to bright |
| **AUTOLOADER** | A feed drum on the spine, turning |
| **SCAVENGER RIG** | A collector scoop under the nose, wider per tier |
| **AFTERBURNER** | Larger bells and a gold plume instead of a blue one |
| **RECLAIMER** | A salvage claw folded under the belly |

| | | | |
| --- | --- | --- | --- |
| ![I](docs/ship-1.png) | ![II](docs/ship-2.png) | ![III](docs/ship-3.png) | ![IV](docs/ship-4.png) |
| **MARK I** — as issued | **MARK II** — wings | **MARK III** — twin engines, bombs | **MARK IV** — coils, grenades |
| ![V](docs/ship-5.png) | ![VI](docs/ship-6.png) | ![VII](docs/ship-7.png) | ![VIII](docs/ship-8.png) |
| **MARK V** — three engines, plating | **MARK VI** — autoloader | **MARK VII** — afterburner, scoop | **MARK VIII** — gilded, everything fitted |

The drawn ship stays honest about the box it collides with: `SHIP.hitW` is
19 by `hitH` 9, and Mark VIII is 33×18 of airframe against Mark I's 26×14 —
visibly a bigger machine without the sprite claiming space the hitbox does
not occupy. Wings and fins reach past that, which is what wings do, and
they are not what you collide with either.

The airframe is named on the overview between hulls, so the change is
announced rather than left to be noticed.

## Gun towers

Six kinds, introduced hull by hull. Each is a different problem rather than
a tougher version of the same one.

| Tower | From | Behaviour |
| --- | --- | --- |
| **GUN** | ARGENTUM | Aimed three-round burst with lead prediction |
| **FLAK** | TANTALUM | A wide fan — cannot be beaten by sitting off its line |
| **LANCE** | CUPRUM | Charges visibly, then one very fast shot. Respect the tell |
| **ROCKET** | CUPRUM | Launches homing missiles. The only one that follows you |
| **MORTAR** | PYRITE | Lobs heavy shells on an arc that ignores your altitude |
| **WARDEN** | WOLFRAM | Shields its neighbours. Changes the order you must kill in |

A hull's roster is `LEVELS[].towers`. While a warden lives, nearby towers
take no damage and visibly shimmer — so the question stops being "what is
shooting me" and becomes "what do I have to kill first".

### The rocket, and the only enemy ordnance you can shoot

Every other tower is beaten by not being on its line. A rocket launches wide
and turns in afterwards at 1.45 rad/s, which is slow enough to out-turn and
fast enough that standing still does not work.

So it needs an answer, and it has one: **a missile in flight can be
destroyed**. It is the only enemy ordnance the cannon can touch — two hits,
worth 60 points, and the explosion is its own reward. Ordinary bullets stay
untouchable, because a game where you can shoot down every bullet is a
different game.

Homing is implemented as a turn rate on the shot itself (`seek` in
`src/projectiles.js`), applied to the velocity's *direction* only: a missile
that accelerated while turning would be unavoidable, and a test asserts its
speed never changes.

## Laser gates

![A laser gate](docs/laser.png)

A wall of light across the hull, lit by an emitter clamped to the girder
above or below it. It is the one obstacle in the game that cannot be dodged:
the ship is *stopped* by it, not merely hurt, so leaning on the throttle
gets you nothing but a drained shield.

The emitter is the way through, and the only way. Fly to its height, break
it, and the beam dies with it. Shots pass through the beam on purpose —
the emitter sits at one end of the very wall that guards it, so a beam that
stopped bullets would be a wall with no door.

That makes a gate a different kind of cost from everything else on the hull.
Every other threat is paid for in reflexes; this one is paid for in the
seconds you spend lined up on a fixed point with the rest of the hull still
shooting at you. They start on TANTALUM and there are four on AURUM, placed
deterministically from the hull's own seed and nudged clear of any block, so
no hull can generate an emitter you cannot reach. A test walks every hull
and checks exactly that.

## Attackers

Interceptors teach dodging and turrets teach prioritising. Four more types
arrive hull by hull, each asking a different question:

![The attacker roster](docs/attackers.png)

Each one is a vessel rather than the shape its behaviour is written in. The
roster used to be a circle with spokes, a triangle and a ring with four
dots on it — a diagram of an enemy rather than an enemy, and at 2x and up
there is room for a great deal more than a diagram. They share a
vocabulary so a hull reads as one fleet: a dark hull, one lit upper
surface, panel lines and rivets, a canopy or a sensor eye so you can see
which way it is looking, engine bells with a plume on their own clock, and
one accent colour per kind carried on the trim and the running lights.

| Attacker | From | Behaviour |
| --- | --- | --- |
| **Mine** | OSMIUM | Creeps toward you and detonates. Cheap to kill, expensive to ignore |
| **Lancer** | TANTALUM | Telegraphs with a lengthening aim line, then charges flat out |
| **Weaver** | TANTALUM | Fast and erratic. Nothing to out-think, everything to out-aim |
| **Orbiter** | CUPRUM | Parks, circles, sprays radially. Forces you to close or leave |
| **Warder** | PYRITE | Frontal plate: head-on shots bounce. Must be flanked, or blasted |
| **Splitter** | PYRITE | Breaks into two halves that keep coming. Killing it early is cheaper |
| **Leech** | WOLFRAM | Clamps onto the hull and drains the shield until you shoot it off |
| **Bomber** | FERRUM | Seeds mines along its path, so ignoring it costs you the lane |

Which hull fields which is `LEVELS[].foes` in `src/config.js`. ARGENTUM
fields none of them — the first hull is turrets and interceptors only.

A leech is the only attacker that does not simply have to be avoided: once
it is on, it is on, and it costs 11 shield a second until something takes
it off. Two things about that were wrong and are now fixed:

- **It drained at five times its stated rate.** An attached leech sits at
  the ship's own position, which also tripped the generic ram check: 18
  damage every 0.35 seconds, and the brief invulnerability that ram grants
  then suppressed the drain it is actually specified to do. It is excluded
  from ramming now, because it has its own damage model.
- **It survived the hull it was on.** A leech attached when a ship was lost
  was still attached to the replacement, so one bad grab drained every
  remaining ship in turn and ended the run with nothing the player could do.
  Anything clamped to a hull is destroyed with it, and a leech can no longer
  grab a ship that is still in its respawn grace — a grab during those two
  seconds would have started draining the instant they ran out, which from
  the front of the screen is indistinguishable from a respawn that does not
  work.

### Deflector shields

![Shielded attackers](docs/shields.png)

From CUPRUM onward, some attackers arrive inside a deflector: a faceted
bubble that has to be shot through before the thing inside it can be hurt
at all. Unlike a warder's frontal plate there is no angle to flank it from
— only damage to put through it.

It is drawn, and it reports its own state: cyan while it is whole, yellow
as it wears, orange at the last of it, with an arc above showing what is
left. An attacker that ate shots for no visible reason would read as a bug
rather than as a thing to shoot harder.

Overkill carries through to the hull, so a heavy shot is not wasted on the
last point of a shield — but the bubble has to be gone before the attacker
can die. The odds start at 22% on CUPRUM and climb to 54% on AURUM, and
only the five kinds in `SHIELD.kinds` can carry one.

## Minibosses

The gap between an attacker you kill in two shots and a boss that gates the
hull is a wide one, and a long hull with nothing in between gets flat. A
miniboss arrives partway along, announces itself, carries its own health bar
and takes real attention — but it does **not** wall you in. You can outrun
one. The reward for stopping is the loot; the cost is everything else that
keeps spawning while you do.

![The miniboss roster](docs/minibosses.png)

| Miniboss | From | Behaviour |
| --- | --- | --- |
| **ORE HAULER** | ARGENTUM | Slow and fat, and it sheds coins as it comes apart — so hurting it pays before it dies |
| **ARC CUTTER** | TANTALUM | Keeps pace with you and fires tight aimed spreads. No safe range |
| **BULWARK** | PYRITE | Radial walls and a lot of health. Expensive to stop for |
| **HARRIER PACK** | FERRUM | Fast, and calls escorts while it runs rings around you |

They are drawn in the same register as the bosses: the hauler is a pirate
freighter with a bridge tower and colours off the stern, the cutter is an
alien ray with one eye and an arc strung between two horns, the bulwark is
an assault drum with its barrels out, and the harrier is a raider with a
crew canopy and a pennant.

One appears on ARGENTUM and a fourth is added by AURUM, spread evenly along
the hull and always clear of both aprons and of the boss arena. If a boss is
up, anything still alive breaks off and runs: the fight at the far end is
meant to read as one room with one thing in it.

Killing one pays a boss-sized spoil — coins, a gold bar, a coffin — which is
what makes stopping worth it. Health scales with the hull and with the
difficulty, like everything else.

## Bosses

Eight of them, one per hull, and eight distinct ships — not one disc with
different numbers. They belong to factions you can read at a glance:
an emplacement, pirates, assault craft, two kinds of alien, and one thing
that is plainly alive.

| | |
| --- | --- |
| ![THE WARDEN](docs/boss-01-thewarden.png) | ![DRAYLINE](docs/boss-02-drayline.png) |
| **1 · THE WARDEN** — emplaced boarding rig, clamp arms and a plated spine | **2 · DRAYLINE** — pirate gunship: ram prow, broadside ports, colours flown |
| ![THE RIVETER](docs/boss-03-theriveter.png) | ![COLDFORGE](docs/boss-04-coldforge.png) |
| **3 · THE RIVETER** — assault ship with a hammer for a bow | **4 · COLDFORGE** — alien minelayer, segmented and legged |
| ![SLAGHEART](docs/boss-05-slagheart.png) | ![NIGHTFALL](docs/boss-06-nightfall.png) |
| **5 · SLAGHEART** — a space monster: ribbed carapace, a maw, veins of heat | **6 · NIGHTFALL** — barely here. A frame around a hole, and a phase ghost |
| ![THE SEXTON](docs/boss-07-thesexton.png) | ![GILTHAMMER](docs/boss-08-gilthammer.png) |
| **7 · THE SEXTON** — scavenger barge, armoured in salvage, towing its take | **8 · GILTHAMMER** — the admiralty's gilded dreadnought |

### The deep campaign

Past the admiralty hull there are seventeen more guards. Their behaviours
cycle the eight above — a ninth pattern invented to fill a table is a
worse boss than a known one at a harder tempo — but each has its own
name, its own numbers and its own place on the curve, ending at roughly
four times GILTHAMMER's health and five times its payout.

| | | |
| --- | --- | --- |
| **THE BALLASTER** (9) | **COLDSHORT** (10) | **ANODE** (11) |
| **KOBOLD** (12) | **PICKETMASTER** (13) | **THE MIRROR** (14) |
| **TOLDHAMMER** (15) | **UNBOWED** (16) | **SKYFALL** (17) |
| **LITTLE SILVER** (18) | **ROSE ASH** (19) | **THE WARD** (20) |
| **ANVILHEAD** (21) | **SLOWFIRE** (22) | **THE LONG HALF** (23) |
| **ADAMANT** (24) | **THE LAST NAME** (25) |

### How they are built

Their destructible sections match: a pod on an alien is an egg sac that
swells and pulses, a plate on a warship is bolted armour with a visible
mount. Drawing all of them as the same grey square threw away the only
chance to say which faction you are shooting at. The bodies live in
`src/bossart.js`, one function each.

Each hull is guarded at its far end, and the boss is what opens the way home —
so a run reads as approach, fight, escape rather than a lap with a waypoint.
The fight happens in a locked arena: the camera pins, the ship is walled in,
and there is nowhere to retreat to.

**THE WARDEN** — ARGENTUM. An emplaced fortress: three gun pods on a spine
firing aimed bursts, around a core that cannot be hurt until they are gone.
Once the pods are off it opens up and sprays radially, rotating a little each
volley so the gaps move.

**DRAYLINE** — OSMIUM. A mobile gunship that tracks your altitude and has to be
led. Alternates an aimed spread with a horizontal wall that has exactly one gap
in it, placed away from where you currently are. Below half health it speeds up
and widens the spread.

**THE RIVETER** — TANTALUM. Four armour plates over a core, and all of the
above layered. Spirals while plated; once stripped it switches to aimed
barrages and starts calling interceptors. Below a third it adds a dense radial
on top of everything else.

**COLDFORGE** - CUPRUM. Lays drifting mines between aimed volleys, so the
arena fills up and the pressure becomes positional rather than reflexive.

**SLAGHEART** - PYRITE. Two reactors firing alternately; killing one halves
the rate, so there is a real choice between focusing and spreading damage.

**NIGHTFALL** - WOLFRAM. Blinks instead of travelling, leaving a radial
behind where it was. You cannot learn its path, only its tells.

**THE SEXTON** - FERRUM. Five plates and a steady stream of escorts.

**GILTHAMMER** - AURUM. Three phases that add rather than replace, so the
final third is everything at once.

The five later bosses are built from shared attack primitives - aimed
spreads, radials, walls with a gap, mine lobs - rather than bespoke code, so
"harder" is which patterns overlap and how fast.

Destructible sections pay score and drop pickups when they go, and a kill
showers the arena with them — so stripping a boss is worth doing carefully
rather than just surviving it. Shots that hit intact armour stop dead with a
duller sound, and the HUD says `ARMOUR HOLDING`, because "my shots are doing
nothing" needs an answer on screen.

### The refit

Clearing a hull permanently upgrades the ship for the rest of the run, so the
difficulty curve is met with a power curve rather than just better flying:

| | Per hull cleared |
| --- | --- |
| Shield maximum | +45 |
| Acceleration | ×1.09 |
| Top speed | +24 horizontal, +18 vertical |
| Muzzle velocity | +50 |
| Gun mounts | +1 to the **cap** on both gunspeed and gunblaze |
| Guns | +1 free level of each |
| Hangar | +1 ship |

By TANTALUM you are flying a markedly different craft from the one that
launched: 190 shield, 19% more thrust, five gun mounts. Everything is held on
the player object rather than mutating shared config, so a restart genuinely
gives you a stock ship.

## What's in this slice

- **Momentum handling.** Low horizontal drag so you coast; high vertical drag so
  you can place the ship precisely. Reverse thrust brakes hard, then flips the
  ship through a scale-through-zero animation — the Uridium move.
- **Bidirectional scrolling** with facing-based camera lead, so reversing slides
  the whole world across and you always see where you're going.
- **12,000px of procedurally generated hull**, deterministic from `LEVEL_SEED`.
  Six obstacle patterns — towers, pincers, free-standing pillars, stepped stacks
  — each guaranteed to leave a navigable corridor.
- **Two attack patterns.** Hull turrets (static, 3 HP, arc-limited tracking,
  lead-aimed 3-round bursts) and interceptors (spawn ahead of your heading, close
  on a homing sine weave, fire aimed shots).
- **Hull collision** with per-axis resolution and speed-proportional shield
  damage. A full-speed slam costs ~16 of 100; brushing it costs ~3.
- Pre-rendered riveted plating, cast shadows, hazard chevrons on every surface
  that points into the playfield, particle explosions, screen shake, CRT
  scanlines and vignette.
- **Fully procedural audio** — see below.

## The armory

![Ordnance in flight](docs/armory.png)

The cannon is a line. Each of these answers a situation a line handles badly,
so carrying them is a decision rather than a strict upgrade. `X` fires the
selected one, `C` cycles, `1`–`3` select directly. All three are finite, and
all three are lost with a ship.

| | Behaviour | Answers |
| --- | --- | --- |
| **Bomb** | Dropped in place, detonates after a fuse, large blast | Something that got close |
| **Grenade** | Lobbed on an arc, bounces off hull and girders | Something behind cover |
| **Missile** | Acquires the nearest target and steers at it | Something you cannot line up on |

Blasts ignore a warder's frontal plate, which is rather the point of them.
You are not immune to your own ordnance, though you take far less of it.

Crates drop from kills; each refills a couple of rounds, up to a cap.

## The wreck window

A boss carries a hold, and it scatters bars, coffins, treasure and a cloud
of coins across an arena the ship was walled into a second ago. Leaving
the instant it died threw most of that away.

So the arena stays open for **ten seconds** after the boss dies, with the
clock on the HUD, and `ENTER` leaves early for anyone who has already
swept it. `BOSS.lootWindow` in `src/config.js`.

## Clearing a hull

![The overview between hulls](docs/overview.png)

Reaching the dock pays a flat completion bonus and a time bonus, and then
asks three questions about *how* you flew it. They are three different ways
to play the same hull, and the breakdown is itemised rather than totalled
because the number on its own tells you nothing about which of the three you
did well.

| Line | Pays |
| --- | --- |
| **GUNS BROKEN** | 5,000 × the fraction of the hull's guns destroyed |
| **FULL SWEEP** | 4,000 more if nothing on the hull is still firing |
| **SHIPS REMAINING** | 1,800 each |
| **NO LOSSES** | 2,500 for the hull flown without losing one |
| **HAUL** | 30% of the value of the loot collected on this hull |

All of it is `HULL_BONUS` in `src/config.js`, and all of it goes through
`award()`, so the difficulty multiplier applies. The HUD carries the two
running totals while you fly — `GUNS 24/48` and the hull's haul — so the
bonus is something you can play toward rather than something you are told
about afterwards.

The same screen is the overview: the next hull drawn to scale against the
one just flown, what is new about it, the refit, and **the mods you have
bought**. Mods were missing from it, which meant the one screen that is
meant to answer "what am I flying" left out the half of the answer you paid
coins for.

## The armourer

![The shop](docs/shop.png)

Between hulls, coins buy upgrades and mods. Upgrades are quantities bought
repeatedly until a cap — another gun level, more shield, more ammo — and get
dearer each time, so the shop cannot be drained into one stat. **Mods** are
permanent changes to how the ship behaves, bought once, and they are where
the interesting decisions live:

Upgrades worth calling out: **TRACTOR COILS** widens the pull radius on
everything you collect, in three steps up to ×2.6, and stacks with the
Lodestone mod — a fully coiled ship with Lodestone III sweeps loot off most
of the screen, which changes how a hull is flown as much as any gun does.

| Mod | Tiers | Effect |
| --- | --- | --- |
| **LODESTONE** | I · II · III | Loot pulls from ×2 / ×3.2 / ×4.8 as far (stacks with Tractor Coils) |
| **SCAVENGER RIG** | I · II · III | Everything you pick up is worth ×2 / ×2.8 / ×3.6 |
| **EXTRA MOUNT** | I · II | A third, then a fourth gun rail: one more level of speed and spread each |
| **DRONE WING** | I · II | An escort drone flies your wing and fires with you. Then a second |
| **CELL REGENERATOR** | I · II | The shield comes back on its own, at 2.5 then 6 a second |
| **POINT DEFENCE** | — | Shoots down enemy missiles that get close. Automatic |
| **SIEGE FRAME** | — | +60 maximum shield and heavier plating, at the cost of acceleration |
| **ABLATIVE PLATING** | — | Hull scrapes cost 40% less shield |
| **AUTOLOADER** | — | Ordnance reloads 35% faster |
| **AFTERBURNER** | — | +40 top speed, quicker acceleration |
| **RECLAIMER** | — | Keep one gun level when a ship is lost |

The last five change what the ship *is* rather than what a number on it
says, and every one is visible on the hull: drones fly in formation and
fire when you fire, point defence draws a line to the missile it just
took, the siege frame is plated, the extra mounts are extra barrels.

The two that change how the whole hull is flown — how far loot reaches and
what it is worth — go up to three tiers, each dearer than the last
(900/1800/3200 and 1100/2200/3800). A pilot who takes a mod to III is
choosing it over everything else in the shop, which is the only reason a
tier list is more interesting than one bigger number. Scavenger lifts the
worth of coins, bars, coffins **and** treasure: it used to leave coffins and
treasure alone, which made the mod worth least exactly where the loot was
worth most.

There are never enough coins for everything, which is the point — the
interesting choice is what to go without. A run with Scavenger plays
differently from one with Afterburner.

## The splash, the launch, the landing

A splash on load — name, logo, version — dismissed by any key. Each hull
opens with a launch off the pad and ends with a landing on it: the ship is
on rails and the controls are locked, so neither can be flown out of by
accident, and both can be skipped with `ENTER` because the fiftieth launch
should not cost what the first one did.

Clearing the eighth hull plays out the landing in full, on the admiralty pad,
and totals the run line by line while the ship cools.

## Coins and coffins

Three tiers of loot, each with its own sound so you can hear what you picked
up without looking: coins chain upward in pitch as you collect a run of them,
a **gold bar** (250, and worth ten coins at the armourer) is three rising
notes, and a **gold coffin** (2,500) gets a fanfare.

Destroyed things scatter **coins** - small, numerous, worth 25 each, flying
apart on impact then drifting like any other pickup. They are constant
background income and get no toast; the run's haul shows on the HUD. A **gold
coffin** is the rare one, worth 2,500. Bosses shed both in quantity.

## Treasure

![Coins, a bar, a coffin and the four treasures](docs/treasure.png)

Above the coffin there are four tiers that are not scattered by every kill.
They come off the things that are hard to kill, each is rarer and worth more
than the last, and each has its own silhouette, its own halo and its own
flourish when you take it — so what you found is audible before you have
read the toast.

| Treasure | Worth | At the armourer | Rarity |
| --- | --- | --- | --- |
| **CUT GEM** | 900 | 24 coins | common, as treasure goes |
| **ALIEN IDOL** | 2,000 | 52 coins | uncommon |
| **PIRATE CROWN** | 4,500 | 110 coins | rare |
| **RELIQUARY** | 9,000 | 230 coins | the one you tell someone about |

The odds start at 2.2% a kill on ARGENTUM and climb to 6.4% on AURUM, so the
late game pays for the trouble it causes. A boss rolls seven times and a
miniboss four. All of it is `PICKUP.treasure` in `src/config.js`.

**A boss carries a hold, and a hold is not a dice roll.** Every boss sheds
three to six gold bars and one or two coffins on death; every miniboss one
to three bars and a coffin. The wreck is worth flying into because of what
is in it, not because of what might be.

Treasure also shows on the radar as a full-height mark in the lane, which is
the point of having a radar: seeing a reliquary four thousand pixels back is
what makes turning round a decision.

## Pickups

Everything you destroy can drop one, so shooting pays beyond score and a long
run gets genuinely stronger rather than just longer. Turrets drop at 60%,
interceptors at 17%. Each is worth 50 points on top of its effect.

| Pickup | Colour | Effect |
| --- | --- | --- |
| **shields-refill** | cyan | Restores 40 shield |
| **lifesavers** | pale cyan | +1 ship, to a maximum of 6 |
| **healthbars** | green | Raises **maximum** shield by 25 (to 220) and grants it |
| **gunspeed** | yellow | Shorter fire interval — ×1 → ×0.76 → ×0.58 → ×0.44 |
| **gunblaze** | orange | Adds a mirrored pair of angled barrels per level: 2 → 4 → 6 → 8 shots a volley |

`shields-refill` and `healthbars` are deliberately different: one tops up the
bar, the other extends it. Both read at a glance because the HUD label switches
to `SHIELD 125` in green once your ceiling has moved.

Guns cap at level 3 each, rising by one per hull cleared to a hard ceiling of
5; collecting at max converts to points instead.

### How often a crate holds a gun

Weights, not probabilities — the roll is over their sum, so one can be moved
without rebalancing the rest:

| Crate holds | Weight | Notes |
| --- | --- | --- |
| shields-refill | 34 | the backbone |
| healthbars | 16 | |
| **gunspeed** | 14 | **× 0.45 per level already held** |
| **gunblaze** | 12 | **× 0.45 per level already held** |
| lifesavers | 8 | the rare one |

The two gun upgrades used to be a flat 42 of 100 between them whatever you
were already carrying. Hull one yields about a dozen crates and hull two about
twenty-two, so both guns hit their ceiling by the third hull of twenty-five —
and from there a capped upgrade went on eating 42% of the table to hand back a
consolation 300 points.

Now the odds fall away with every level held and a capped level is not rolled
at all. The first upgrade still arrives in the opening minute, because the
opening should feel generous; maxing both from drops alone takes about 55
crates instead of 19. Pimping the guns out faster than that is what the
armourer is for — a deliberate purchase rather than a thing that simply
happens to you.

| | end of hull 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| before | 2.3 / 2.1 | 4.0 / 4.0 | 5.0 / 5.0 | 5.0 / 5.0 | 5.0 / 5.0 |
| after | 1.4 / 1.2 | 3.0 / 2.9 | 4.3 / 4.2 | 4.9 / 4.9 | 5.0 / 5.0 |

(gunspeed / gunblaze, averaged over 800 simulated runs, cap rising 3 → 5.)

**Losing a ship costs every weapon addon picked up since the last refit** —
both gun levels and the entire armory. What the refit built into the ship
survives, because that is the ship rather than something you are carrying. So
a death on ARGENTUM drops you to a bare cannon, and a death on FERRUM drops
you to the gun that hull was issued with.

Each pickup carries a glyph as well as a colour, because colour alone fails for
anyone who can't separate the cyan from the green, and these appear against a
busy hull at speed. They bob, drift, and pull toward you — within 74px for an
upgrade and 118px for loot, so a near miss at full throttle still counts —
and flash for their last three seconds before expiring. A drop that would land inside solid hull is relocated to open
space, so a pickup is never unreachable.

## The radar

![The radar strip](docs/radar.png)

The old progress bar answered one question — how far along am I — while the
hull held guns, loot, minibosses and a boss, and none of it was visible until
it was on screen. The strip shows all of it at once.

**It has a band of its own.** The frame is three stacked regions — playfield,
radar, HUD — and none of them overlaps another. The radar was first drawn
over the top of the playfield and faded out when the ship flew under it,
which was never quite honest and was plainly wrong for anything that is not
the ship: a gun mounted on the upper girder sits at y=16 with its barrel
reaching to about y=29, entirely behind a strip that ran from 0 to 22. Half
of every hull's guns were hidden behind the thing that was meant to be
showing you where they were.

The playfield kept every pixel it had, so no gameplay constant moved; the
frame grew from 640×360 to 640×384 instead. A test walks every hull and
asserts no gun anywhere reaches into the radar band.

Three bands, because one band is noise:

- **Top and bottom** are the hull itself, drawn as a silhouette from a
  profile computed once per hull and cached (`radarProfile` in
  `src/level.js`). A pincer reads as a pinch; a clear run reads as a gap.
- **The lane between them** is everything you might fly to. Coins are dim
  pips, bars and coffins are taller marks, treasure is a full-height block
  with a white core. Guns sit on the inner edge of whichever surface they
  are mounted on, in their own colour, and stay on the map dimmed once
  broken — what you have already cleared matters as much as what you have
  not, because the bonus is paid on the ratio.
- **Minibosses** are diamonds; the ones still waiting further along are
  hollow. The arena at the far end is marked, and lights red when the boss
  is actually up.

Your position is a bright caret and the box around it is what you can
currently see. Everything is placed by x only: 640 pixels of strip against
25,000 pixels of hull is 39:1, so vertical position would be a lie, and
height is used to say what a thing *is* instead.

`RADAR STRIP` in settings turns it off.

## The title

![The title screen](docs/scene-title.png)

It used to carry the name, the tagline, the names of all eight hulls, two
lines of key bindings, the pilot, the tune, the best score, the hull
selector, two lines explaining the hull selector, the launch prompt, a
settings prompt and a ten-row board — over a dimmed frame of whatever the
last run had left on screen. It is a menu, so it now looks like one.

What is left is the name, the one choice the screen actually asks for
(which hull to start on), the prompt to launch, a line of status and a
line of exits. Everything that was instruction has moved to the help page.

The backdrop is its own thing rather than a dimmed game: three parallax
star layers, the dreadnought passing below with its windows lit and masts
on the skyline, and a patrol crossing in front of it. It is a function of
one clock, so it holds no state and cannot drift out of step.

## Attract mode

Leave it alone for two minutes on the title and the game plays itself.
Any key stops it, drops the run and puts the title back — a real keypress
always wins, so nobody ever finds themselves fighting a ship that is also
being flown by something else. `ATTRACT DEMO` in settings turns it off.

It is not a scripted replay and not a special code path. The pilot is
handed the real game state and returns the set of actions a player would
be holding; the input layer substitutes that for the keyboard, so the demo
flies the actual game through the actual update loop. Anything that broke
for a player would break for the demo too.

The pilot samples thirteen lanes ahead of the ship and scores each one:
structure is disqualifying, incoming fire and things that ram are
penalised by how soon they arrive, loot and a boss section at that height
are worth going to, and a live laser gate pulls it hard toward the
emitter's altitude. It is deliberately a competent amateur rather than a
perfect machine — an attract loop that never takes a hit tells you
nothing about the game.

A test asserts the pilot only ever presses keys `input.js` actually binds,
and that it presses on through every screen that waits for one, so it
cannot sit on the hull-clear screen forever.

## Help

![Controls](docs/help-1.png)

`H` from anywhere that is not flight. Three pages: **CONTROLS**, **THE
RUN** — what a hull asks of you, what pays and what costs — and **READING
THE SCREEN**, which is the radar legend, the loot legend and the tells
that say what is about to shoot you.

A test measures each page against the layout and fails if one runs past
its own footer, checks every row fits its column, and asserts that every
key the help names is a key `input.js` actually binds. Documentation of a
game that is not this one is worse than none.

## Settings

![Settings](docs/settings.png)

`O` opens them. Music and sound effects separately, master volume, tune
override, **difficulty**, accessibility, and switches for bloom, scanlines,
screen shake, the foreground layer and pickup toasts — the visual ones
double as a performance escape hatch on a slow machine. Everything
persists, and the definitions are data, so adding a setting is a list entry
rather than a UI change.

The list scrolls and the heading names the group you are in. It used to
place its explanation line below however many rows there happened to be, so
every setting added pushed that line one notch nearer the footer and the
twelfth put it through. Widening the gap only moved the cliff; a fixed
window has no cliff, and the screen now lays out identically whether there
are five settings or fifty.

### Accessibility

Each of these removes a specific barrier rather than making the game easier
in general — easier in general is what `DIFFICULTY` is for, and it has its
own score multiplier so it cannot be used as a silent advantage. All are
off by default, because a default that changes how the game plays for
everyone is a redesign and not an accommodation.

| Setting | What it removes |
| --- | --- |
| **AUTO FIRE** | Holding a key down for an entire run. The rate is the gun's, not the key's, so this is exactly what holding fire already did. |
| **GAME SPEED** | Reaction-time pressure. 50–100%, and it scales the time fed to the fixed-step loop rather than the step, so the physics cannot change — only how much of it happens per second. Menus and the attract demo always run at full rate. |
| **REDUCE FLASHING** | The full-screen flash on hits and big explosions, damped to 22%. Not to zero: the flash is feedback, and removing it takes information away from the player it is meant to help. |
| **HIGH CONTRAST** | Hunting for enemy fire. Incoming shots get a neutral-grey outline — grey rather than white because under the `lighter` composite a white ring blooms into the shot it is framing. |
| **FIRING LINE** | Guessing where the ship is actually aiming, which otherwise means learning a 24px sprite. |

A setting that exists but does nothing is worse than none: it says the
barrier is gone when it is not. `test/access.test.mjs` asserts each one
reaches the thing it claims to change — auto fire actually fires and does
*not* raise the rate, game speed actually halves how far the simulation
advances, a corrupt speed cannot stall the game or run it fast.

### What survives a closed tab

Three different lifetimes, and they used to be tangled:

| | Lifetime | Holds |
| --- | --- | --- |
| **Loadout** | the hull | gun levels, armory — forfeit with the ship |
| **Run** | the campaign | score, clock, hull reached |
| **Hangar** | the pilot | **coins banked and mods owned** |

The hangar was being thrown away with the other two: close the tab and
every mod you had paid for was gone — and `resetShop` wiped them the moment
you launched again, never mind closed anything. Mods are the one purchase
the game calls permanent, so they are the one purchase that has to outlive
a session; coins go with them, because a currency you cannot bank is not a
currency. It saves on a purchase, on a hull cleared, on a run ending, and
on `pagehide` / `visibilitychange`, because none of those is "the player
just closed the tab".

What deliberately does *not* persist is anything from the `ITEMS` list.
Those are the run's loadout, already forfeit on death, and persisting them
would hand a fresh run a maxed ship.

Storage is the one input a player can edit by hand, so nothing read back is
trusted: unknown mod ids are dropped, levels and coins are bounded, a save
from a newer version is ignored rather than half-read, and storage being
unavailable at all is an empty hangar rather than a crash.

`K` twice on the settings screen clears it. Progress that persists needs a
way back to nothing, and it asks twice because it is the one irreversible
thing on that screen. Clearing storage alone was not enough, incidentally:
the game saves again on `pagehide`, so a wipe that left the live coins in
place was written straight back when the tab closed — found by doing
exactly that in a browser, and now `clearHangar` takes the game so the two
cannot get out of step.

### Starting hull

`START HULL` begins a run on any hull you have reached — the same choice
the title screen offers with its arrows, in the place people look for
settings. It is bounded by how far you have actually got, because a start
hull past that is not a setting. Earlier refits are credited, so arriving
on PYRITE in a factory-standard ship is not a thing that can happen.

### Difficulty

Four settings, and one place in the code decides what each means
(`diff()` in `src/game.js`, reading `DIFFICULTY` in `src/config.js`). A
change applies to the next run, not the one in progress.

| | Enemy damage | Boss & miniboss health | Spawn rate | Scrape damage | Score |
| --- | --- | --- | --- | --- | --- |
| **CADET** | ×0.6 | ×0.7 | ×0.74 | ×0.6 | ×0.7 |
| **PILOT** | ×1.0 | ×1.0 | ×1.0 | ×1.0 | ×1.0 |
| **VETERAN** | ×1.4 | ×1.3 | ×1.25 | ×1.3 | ×1.3 |
| **RUIN** | ×1.9 | ×1.6 | ×1.6 | ×1.7 | ×1.7 |

Harder settings pay more, so the board is not simply a list of who played on
CADET the longest.

## Leaderboards, two ways

`B` switches between them. Both list ten, highest first, in two columns,
each row stamped with how long ago it was set (`9M AGO`, `2H AGO`, `16D AGO`,
then a plain `YY-MM-DD` once a score is over a month old):

- **TOP PILOTS** folds to one row per player — their best run. Answers *who
  is best*.
- **HIGH SCORES** lists the best individual runs with no folding, so one
  exceptional pilot can hold several places. Answers *what are the best runs*.

## Picking up where you left off

The furthest hull you have reached is remembered, and the title screen lets
you start from it — or from any hull below it. Starting at PYRITE hands you
the ship you would have earned getting there: the refits from every hull
before it, already applied. Arriving at the fifth hull in a factory-standard
craft would not be a challenge, it would be a joke.

This is stored per browser. Unlike the high score, it does not follow your
pilot across machines yet.

## Quitting

`Q` during a run opens a confirmation; only `Y` leaves. `N`, `Esc` or `Q`
again keeps you flying.

The simulation freezes while the prompt is up — being shot while deciding
whether to leave would be a cheap way to lose a run. The run is **recorded**
rather than forfeited, because you flew it; the prompt says so before you
commit.

This is a browser game, so `window.close()` is blocked for ordinary tabs.
Quit means what it means in any shoot 'em up: abandon the run, return to the
title.

## Graphics

The game is written in a fixed 640×360 logical coordinate system, but it is
no longer *rendered* at 640×360. The canvas backing store tracks the window
and the device pixel ratio, and the context carries a matching transform, so
sprites, strokes and above all text are rasterised at display resolution
instead of being drawn small and blown up. A 10px label on a 4K window is now
a 10px label, not a 40px block.

**The hull renders in chunks**, on demand, at the current scale, with an LRU
cache. One bitmap for the whole hull was fine at 12,000px and 1x; at 25,000px
and 3x it would be a 190MB canvas, past what browsers will allocate. Chunking
also made hull generation testable in node, since nothing touches a canvas
until a chunk is actually drawn.

**Resolution adapts to the machine.** Pixels are not free - a canvas without
GPU acceleration can be four times slower at 2x than at 1x - so the game
watches its own frame times and settles on the highest scale it can sustain.
Two details matter, and both were got wrong first:

- It judges against the *display's* refresh period, estimated from a low
  percentile of observed intervals, not an absolute millisecond budget. On a
  vsync-locked 60Hz display no frame can ever beat 16.7ms, so an absolute
  "fast enough" threshold can only ever ratchet downwards.
- That estimate is **monotonically non-increasing**. Allowed to rise, a slow
  scale redefines its own bad frame time as normal, and the scaler climbs
  into a hole and stays there.

A scale that proves too slow is never retried in that session, so it cannot
oscillate. `test/display.test.mjs` covers the decision table directly,
including the 144Hz case and the single-slow-frame case.

**Menus are not gameplay, and are not rendered at gameplay's cap.** The cap
exists to protect the frame rate of a scrolling hull with a few hundred
sprites on it. A menu is a dim rect and some text over a frozen world. It
had been inheriting whatever cap gameplay settled on: on a 2560px window
that meant a 960×540 backing store blown up 2.6× by the browser, and the
overview, the armourer and the settings page — the three screens made
almost entirely of text — were the blurriest thing in the game.

They now render at the full window scale, and the frames they produce are
kept out of the adaptive estimate entirely, so a cheap menu cannot talk the
scaler into a cap that gameplay then has to live with. Bloom is skipped
behind a menu too: the world there is under an 80% dim rect, so the glow is
invisible, and skipping it more than pays for the extra resolution.

On top of the plating and sprites:

**Bloom.** The bright elements — shots, particles, the engine — are re-drawn
at half scale into their own buffer, bounced through a quarter-size canvas
twice to blur them, and added back with `lighter`. Every neon thing in the
scene picks up a halo without needing a shader.

**Dynamic lighting.** Explosions and muzzle flashes light the hull around
them with a radial falloff that decays over their lifetime, so the surface
reacts instead of just having sprites composited onto it.

**Parallax foreground.** Superstructure — girders off the rim girders, with
the occasional cable slung between them — scrolls at 1.32× the hull and
passes in front of the ship. It is generated deterministically per frame from
the camera position rather than pre-rendered, so it costs no memory at any
hull length. Kept narrow and anchored to the rims on purpose: a foreground
that hides a threat is a foreground that loses runs.

**Surface shading.** A vertical gradient brightens the middle of the hull and
falls off toward the girders, easing back up at the very edges so the rims
stay legible — they are the boundary you die against, so the vignette must
not swallow them.

**Ship banking.** The ship rotates into vertical movement, which makes the
inertia legible in a way a rigid sprite never manages.

**Rim beacons.** Deterministic pulsing lights along the girders, so the hull
reads as powered rather than inert.

All of it holds 60fps; `make smoke` asserts the frame rate alongside the
pixel checks.

## Audio

Every sound is synthesised at runtime from oscillators and noise. There are no
audio files to load, nothing to license, and the whole system is about 400 lines.
It also happens to be the right register: both reference games came out of an era
when the music *was* the synthesiser.

**14 effects**, each built from a pitch sweep plus a filtered noise burst. Hull
contact is the one worth calling out — its brightness and pitch track impact
speed, so a graze and a full-tilt slam are audibly different and you learn the
damage model through your ears before you read the shield bar.

**An adaptive score** in D phrygian at 152 BPM — galloping bass, kick/snare/hats,
an arpeggio lead and a detuned pad, sequenced on a 16th grid over a four-bar
`i – bII – i – bVII` progression. Four intensity layers, driven by what is
actually happening:

| Layer | When |
| --- | --- |
| 0 — pad and sparse arp | title and end screens |
| 1 — drums and bass enter | reserved for calm stretches |
| 2 — full kit, arpeggio lead | in flight |
| 3 — doubled lead, 16th hats | return run, or shield below 30 |

Intensity changes land on a bar line, so layers never pop in mid-phrase.

Sequencing uses the Web Audio lookahead pattern — a 25ms timer schedules every
step falling inside the next 120ms against `ctx.currentTime`. Driving it from
`requestAnimationFrame` instead would jitter audibly, because rAF is tied to the
display and the audio clock is not.

### Tunes

Written to sound like a SID rather than a general-purpose synth. The things
that actually make a 6581 recognisable, in rough order of importance:

- **Pulse waves with a moving duty cycle.** Not saw, not square. `OscillatorNode`
  has no pulse type and no PWM, so the duty is baked into a `PeriodicWave` as
  a Fourier series and the wave is swapped between notes to make the width
  move.
- **Chords as very fast arpeggios.** The chip had three voices, so a chord
  was faked by cycling its notes every frame at 50Hz. It sounds like a chord
  and a trill at once, and nothing else sounds like it. This is the single
  most identifying thing in the rewrite.
- **Hard, short envelopes** with an audible click on the attack, because a
  6581 had no smooth one and the click is part of the sound.
- **A resonant low-pass swept per note**, not set and left.
- **Drums from the same voices**: bit-crushed noise plus a pitch-swept tone,
  because the chip had no sampler.

### Form — the thing that was actually missing

Every tune used to be four bars, looping. Four bars of anything repeats
forty times across a hull, and no amount of good writing survives that: it
was a texture, not a tune. The loop is now sixteen bars with a shape:

```
bars  0-3   A, no lead        the groove states itself
bars  4-7   A, with the hook  the part you are meant to remember
bars  8-11  B, its own hook   on its own chords — the middle eight
bars 12-15  A, hook again     and a fill into the turnaround
```

So a tune takes about twenty-five seconds to come round, it goes somewhere
in the middle, and the part you remember arrives twice. On top of that: a
written melody instead of an arpeggio cycling forever, a drum fill on the
last beat of every four-bar group, and a bass that walks up into the next
phrase rather than restating one note.

A melody is 32 eighth notes of **scale degrees**, not semitones, so it is in
key by construction and a wrong note is not expressible. Rests are as
deliberate as notes, and a test asserts each hook has at least six and at
most twenty-six of its thirty-two slots filled — silence with extra steps at
one end, a drill at the other.

### The eight tunes

`T` cycles; each hull selects its own, so the score tracks where you are in
the campaign unless you override it in settings.

| Tune | Hull | Character |
| --- | --- | --- |
| **DROSS** | ARGENTUM | D phrygian, 152 — the working tune |
| **QUENCH** | OSMIUM | A aeolian, 126, half time — lower, heavier |
| **GANTRY** | TANTALUM | G dorian, 138 — a march |
| **OVERDRIVE** | CUPRUM | E dorian, 174, double time — relentless |
| **CORSAIR** | PYRITE | B phrygian, 164 — a raiding party |
| **VACUUM** | WOLFRAM | D aeolian, 104 — sparse, drifting |
| **BLACKSTAR** | FERRUM | C harmonic minor, 118 — something alive |
| **HAMMERFALL** | AURUM | F# aeolian, 186 — the last hull |

A tune is pure data in `TUNES` in `src/music.js`: tempo, root, mode, two
chord progressions, drum masks and two hooks. Adding a ninth is adding an
entry, not code. Switches land on the next bar line so a change never chops
a phrase in half, but the UI reports your selection immediately rather than
waiting.

Audio cannot start before a user gesture (browsers forbid it), so the context is
created on your first keypress. Mute is `M`; both it and your tune choice
persist across reloads.

## Backend

A Go service keeping high scores, top lists, mods and live presence.

**On "multiple players at the same time":** everyone flies their own run and the
shared state is the score board, not the game world. There is no netcode, no
shared physics and no live opponents on your hull. What *is* shared, and live,
is who is currently flying — the status bar shows the count, and `/api/presence`
reports each pilot's progress along the hull.

### Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | — | liveness |
| `GET` | `/api/stats` | — | players, runs, mods, who is flying |
| `POST` | `/api/players` | — | register; returns a bearer token **once** |
| `GET` | `/api/players/{id}` | — | profile and recent runs |
| `GET` | `/api/me` | yes | your own profile |
| `POST` | `/api/scores` | yes | submit a run; returns your new rank |
| `GET` | `/api/scores/top` | — | leaderboard — `?mod=`, `?window=day\|week\|all`, `?limit=` |
| `GET` | `/api/mods` | — | list mods — `?sort=plays\|name\|new` |
| `POST` | `/api/mods` | yes | publish a mod |
| `GET` | `/api/mods/{id}` | — | one mod, with its config |
| `GET` | `/api/mods/{id}/top` | — | that mod's leaderboard |
| `POST` | `/api/presence` | yes | heartbeat while flying |
| `GET` | `/api/presence` | — | who is flying right now |

### High scores persist against your pilot, not your browser

The backend owns your best score, so it follows the pilot across machines and
survives a cleared `localStorage`. The browser keeps a cached copy purely so a
number still shows when the backend is unreachable. On connect the two are
reconciled and the higher wins.

### Identity and accounts

`POST /api/auth/register` and `/api/auth/login`. Passwords are hashed with
**PBKDF2-HMAC-SHA256 at 240,000 iterations** from the standard library,
salted per user, and the encoded form carries its own parameters so the cost
can be raised later without invalidating existing hashes. Argon2id would be
better and is what this should use if a dependency ever becomes acceptable;
PBKDF2 is the strongest thing available without one.

Login failures return one message and one status whatever went wrong, and a
miss still spends the time a real verification would — so the endpoint
cannot be used to find out which pilot names exist.

The old token-only flow still works. A pilot created before passwords
existed keeps their token and their scores, and adopts a password by
registering the same name while holding that token.

### Anti-cheat — what it does and does not do

**You cannot verify a score from a client you do not control.** The only real
verification is re-simulating the run server-side from an input trace, and
this does not do that: the game is several thousand lines of JavaScript and
the server is Go.

What it does is make cheating cost something, removing the easy routes in
roughly ascending order of effort to defeat:

1. **A run must be opened before it can be submitted**, and each run can be
   submitted once. Replaying a captured request stops working.
2. **The server times the run itself.** A claimed 400-second campaign that
   took eleven seconds of wall clock is rejected. This is the check the
   physics bounds cannot make, because they only see the numbers the client
   chose to send.
3. **The submission is signed** with a secret issued at run start and never
   present in the page source. Forging a request means reading it out of a
   live session rather than reading the code.
4. **Progress heartbeats are counted.** A long run that never once reported
   being in flight did not happen the way it claims.

Someone running a modified client can still defeat all four by playing
slowly and lying at the end. That is inherent. The honest position is to say
so rather than imply the leaderboard proves anything.

`-require-runs` rejects any score not tied to an opened run, which closes the
simplest bypass of all: not opening one. It is off by default so an older
client keeps working.

A rejected submission deliberately does **not** burn the run — a client bug
or a mangled request would otherwise void a legitimate campaign, and without
the secret an attacker gains nothing by retrying.

### Legacy identity

Registration mints a 256-bit bearer token and the server stores only its
SHA-256. The client keeps the token in `localStorage`. There are no passwords
and no email — that is the right weight for a score board, and it means a
leaked snapshot file hands over nobody's identity. Renaming mints a fresh
identity; the old name keeps its scores.

### Mods

The game is already fully determined by a hull seed plus the values in
`src/config.js`, so a mod is exactly those two things:

```bash
curl -X POST localhost:8000/api/mods -H "Authorization: Bearer $TOKEN" -d '{
  "name": "Osmium Drift",
  "seed": 99887766,
  "config": {"SHIP": {"maxVX": 420, "dragX": 0.9}, "INTERCEPTOR": {"spawnEvery": 0.8}},
  "notes": "Denser traffic, looser ship."
}'
```

Play one at `/?mod=<id>`. Its scores go to its own leaderboard, never the stock
one. Overrides are applied against an allowlist (`SHIP`, `TURRET`,
`INTERCEPTOR`, `CAM`, `COL`) with type checking, so a mod can retune the game
but cannot reach into anything structural and break it.

### Leaderboards

One row per player — their best run in the bucket, not their best ten. Ties
break toward the faster run, then the earlier one. Buckets are per-mod and
per-window (day, week, all time).

### Score validation — read this before trusting a number

`internal/validate` derives bounds from the game's own physics. The first hull
is 12,000px and top speed is 310px/s, so hull one cannot be flown in under
**32.9 seconds** — any faster "completed" run is rejected outright. Point totals
are checked against a ceiling computed from the run's duration and the scoring
rules.

The campaign is modelled hull by hull, including the fact that the ship gets
faster with each refit and that the afterburner mod exists — a later hull is
longer but can legitimately be flown quicker than an earlier one, and a bound
that ignored that would reject honest runs. The full twenty-five-hull campaign
cannot be flown in under **1,104 seconds**.

Crucially, the floor covers **the hulls actually flown, not the hull reached**.
A run restarted on AURUM reaches hull eight having flown one, and the client
sends both numbers (`levels` and `hullsFlown`) because they mean different
things — the first to the board, the second to the validator.

**Being wrong in the strict direction is the expensive failure.** A bound that
is too loose lets a fabricated number onto the board; a bound that is too tight
only ever fires on people who really played. Both halves of this have now
happened in anger:

- The floor modelled a run out **and back**, long after the return leg was
  removed. Harmless over one hull with eight in the campaign; an outright
  rejection of honest completions at twenty-five.
- The points ceiling was built before coins, bars, coffins and treasure
  existed, so it assumed at most one pickup per kill worth at most 550. A real
  single-hull run scored **4,650,367** against a ceiling of **1,744,776** and
  was thrown away — and because the end screen said `SENDING RUN...` whatever
  the answer was, the rejection was invisible and looked like a slow network.

All three are now bounded by tests built from that exact submission
(`TestTheRunThatWasWronglyRefused`), the end screen states every outcome, and
`test/parity.test.mjs` recomputes each mirrored economy constant from
`src/config.js` so they cannot drift again.

**These are plausibility bounds, not anti-cheat.** They stop someone curling a
score of 10⁹ onto the board. They do not stop anyone who reads the rules and
submits a number just under the ceiling. Real anti-cheat means submitting an
input trace and re-simulating it server-side against the same seed — the game is
deterministic from `LEVEL_SEED` and a fixed timestep, so that is achievable, but
it is a separate piece of work and it is not done here.

### Storage

An in-process store behind a `Store` interface, snapshotted to JSON (written to
a temp file and renamed, so a crash cannot truncate your data). Periodic saves
plus a final one on `SIGTERM`.

This is right for now and wrong later. It does not survive beyond one process,
so there is no horizontal scaling; everything is resident in memory; and top
lists sort on read rather than using an index. At a few hundred thousand scores
that stops being acceptable — the `Store` interface is there so swapping in SQL
is a contained change.

Rate limiting is a per-IP token bucket, which means players behind one NAT share
a bucket. Keying on the bearer token instead would let anyone mint unlimited
buckets by registering, so IP is the lesser evil; raise `-rate-limit` if real
players ever collide. It is not DDoS protection — that belongs in front of the
process.

## Layout

```
index.html        host page, canvas, integer upscaling
src/config.js     every tunable: physics, enemies, camera, palette
src/loop.js       fixed 120Hz timestep, free-running render
src/level.js      hull generation, collision buckets, pre-rendered plating
src/player.js     ship physics, flip, firing, hull collision response
src/enemies.js    turret and interceptor behaviour
src/miniboss.js   the four mid-hull minibosses
src/bossart.js    eight boss bodies and their destructible sections
src/gates.js      laser gates: the wall, the emitter, and what breaks it
src/foeart.js     the ten attacker bodies
src/shipart.js    the player's ship, as its marks, guns, load and mods make it
src/demo.js       the attract-mode pilot
src/score.js      difficulty multipliers, and the one way points are awarded
src/game.js       state machine, collision pairs, run objective
src/render.js     world drawing
src/hud.js        HUD and the title / game-over / complete screens
src/pool.js       fixed-capacity object pools (no allocation during play)
src/audio.js      Web Audio graph, buses, voice limiting, synthesis primitives
src/sfx.js        the 14 sound effects
src/music.js      adaptive sequencer and its instrument voices
src/net.js        backend client; degrades to offline play
src/mods.js       mod loading and config overrides
src/projectiles.js src/particles.js src/camera.js src/rng.js src/input.js

Makefile          make, for the list of targets
tools/make_icons.py  regenerates favicon.ico
cmd/server/       the binary: static files + API
internal/model/   shared types
internal/store/   Store interface, in-memory implementation, snapshots
internal/api/     routing, handlers, auth, rate limiting
internal/validate/ score plausibility, derived from the game's physics
```

`make smoke` flies the game in a headless browser and reads pixels, asserting
the camera is finite, the world scrolls and the hull is actually drawn. It
exists because a camera signature change once left `cam.x` as `NaN`: every
state assertion still passed — score rising, ship moving, 60fps, nothing
thrown — while the screen rendered black. State tests cannot see that.

### Tests

`make check` runs everything: gofmt, vet, Go tests under `-race`, the client
tests, a JS syntax gate, and the browser smoke test.

Client tests live in `test/` on node's built-in runner. `_setup.mjs` provides
deliberately inert `localStorage`, canvas and `AudioContext` stubs - anything
depending on what was actually drawn or heard belongs in the smoke test.

Several exist because of bugs that shipped:

- **`test/parity.test.mjs`** reads `internal/validate/score.go` and compares
  it against `src/config.js`. The Go validator mirrors hull lengths, top
  speed, boss rewards and the whole pickup economy to decide what is
  physically possible; drift makes it reject honest runs with a 422, which
  has happened three times. Going from three hulls to eight broke four of
  these at once and this caught all four. The pickup economy was not covered
  and that is the drift that threw away a 4.65-million run; it is covered now,
  down to the treasure rate, which climbs per hull and so is derived from the
  hull count on both sides rather than written down on either.
- **`test/camera.test.mjs`** asserts the camera survives a malformed `dt`.
  A mis-ordered argument once made it `NaN`, which renders a black screen
  while score, ship and frame rate all still look healthy.
- **`test/level.test.mjs`** walks every hull asserting no vertical slice is
  fully blocked. An unwinnable hull would otherwise only surface by playing.
- **`test/boss.test.mjs`** sweeps a simulated shot across every boss from
  both sides and asserts each section is reachable and the boss is killable
  outright. THE WARDEN shipped unkillable: its middle pod sat inside the
  core's absorb box, so shots at that height were eaten before they could
  reach it — two of three pods could be destroyed and the fight could never
  be finished. This reproduced it in one line of output.
- **`test/miniboss.test.mjs`** does the same for minibosses, and checks
  their spawn points stay clear of both aprons and the boss arena. It caught
  one being announced and then culled on the same frame whenever the camera
  had not yet caught up.
- **`test/score.test.mjs`** greps the whole of `src/` for a bare
  `game.score +=`. Points are awarded at sixteen places; a difficulty that
  pays more has to pay more at all sixteen, and the fifteen-of-sixteen
  version of that bug is invisible from in front of the screen.
- **`test/projectiles.test.mjs`** asserts a homing missile turns at exactly
  its stated rate and that its *speed never changes* — a missile that
  accelerated while turning would be unavoidable — and that a reused pool
  slot does not leave an ordinary bullet homing.
- **`test/music.test.mjs`** checks the form and the melodies: that the hook
  index walks each four-bar phrase exactly once in order, that every note of
  every tune over every chord lands in the audible range, and that no two
  hulls in sequence play the same tune. The music cannot be heard from here,
  so what can be checked is checked.
- **`test/gates.test.mjs`** walks every hull and asserts no emitter is
  generated inside a block — a gate whose emitter cannot be shot is a hull
  that cannot be finished — and that the beam holds the ship at its clear
  distance with the thrust held down, rather than merely bouncing it, which
  enough speed would push through.
- **`test/shields.test.mjs`** drives a real death through the real update
  loop with a leech clamped on. A leech attached when a hull was lost used
  to survive the explosion and still be attached to the replacement, so one
  bad grab drained every remaining ship in turn and ended the run. The guard
  inside the leech's own update could never fire — death switches the game
  to `dying` in the same frame, and attackers are not updated in that state
  at all — so the test has to go through `update()`, not through the helper.
- **`test/radar.test.mjs`** asserts the three bands stack without
  overlapping and that no gun on any hull reaches into the radar's band.
- **`test/screens.test.mjs`** measures the help, settings and overview
  layouts, and asserts the attract pilot only presses keys the game binds.
  The fitted-mods list used to grow a row per mod with no bound: with
  everything bought it ran straight through "ENTER TO LAUNCH" and the
  armourer prompt under it, which is a bug you can only see once you own
  enough mods to see it.
- **`test/screens.test.mjs`** also measures the help and settings layouts. The
  twelfth setting pushed the per-row explanation straight into the footer
  under it, which is the kind of thing that is only ever noticed in a
  screenshot; both layouts are data now and both are measured. It also
  asserts every key the help page names is a key `input.js` binds.
- **`test/art.test.mjs`** asserts every attacker kind has a body of its
  own — a missing one silently falls back to a warder, so a leech would
  just quietly be drawn as something else — and that each of the eight
  marks is at least as much ship as the one before it on every axis, while
  staying within sane bounds of the hitbox it is drawn around. It also
  draws every mark against every gun level, load and mod combination,
  because a throw in the renderer blacks the whole frame.
- **`test/mods.test.mjs`** asserts no two shop rows share an id. The Tractor
  Coils upgrade and the Lodestone mod both used `magnet`, so anything that
  looked a row up by id got whichever came first.
- **`tools/optimise_gallery.py`** measures the most saturated pixel before
  and after quantising and fails the build if it drops by a quarter. It was
  written after noticing that every README image had been losing most of its
  colour — the hull themes went from 200 saturation to 42 — because median
  cut allocates its palette by area and these screenshots are 95% dark hull.

Run the Go tests with `go test ./...` (and `-race`, which the suite is clean
under — it covers concurrent submission and concurrent store access).

Everything you'd want to tune while playtesting lives in `src/config.js`. The
game object is exposed as `window.game` for poking at from the devtools console.

## Known gaps

These are the honest ones. Several entries here used to describe a slice
that no longer exists — an absent shop, an absent landing, three hulls — and
a stale gap list is worse than none, so this is current as of the version in
`src/config.js`.

**Nothing in this game has been judged for feel by a human.** Everything
below follows from that one fact.

- **Balance is all first guesses, and there is now a great deal of it.**
  Twenty-five hulls, twenty-five bosses, four minibosses, eight attacker
  types, six tower types, laser gates, deflector shields, four treasure
  tiers, eleven mods, the coin economy, the refit curve, the end-of-hull
  bonus and the four difficulty settings were all picked by reasoning
  about them, not by playing them.
- **The deep campaign is a curve, not a design.** Hulls nine to
  twenty-five are generated: the numbers escalate correctly and nothing is
  left out of a hull by accident, but no one of them is *about* anything
  the way the first eight are. A twenty-five hull run is also somewhere
  around forty minutes, which nobody has sat through.
- **The attract pilot has never been watched for long.** It flies the real
  game and the tests prove it presses real keys, but whether it looks like
  someone playing — or like a machine bouncing off walls — is not
  something a test can answer. Whether a run
  outgrows its hull, whether RUIN is hard or merely tedious, and whether
  stopping for a BULWARK is ever worth the coins are open questions. The
  numbers are all data: `LEVELS`, `BOSSES`, `LEVEL_UP`, `PICKUP`, `ARMORY`
  and `DIFFICULTY` in `src/config.js`, and `KINDS` in `src/miniboss.js`.
- **The music is unheard by me.** The techniques are the real ones a SID
  used, the form and the melodies are written rather than generated, and
  the tests prove every note is in key and in range — but whether the hooks
  are any good is not something a test can tell you. Eight tunes written
  deaf is eight chances to be wrong.
- **The graphics are unjudged.** Bloom strength, foreground density and the
  surface shading are tuned by eye against screenshots, not by playing.
  Bloom in particular is easy to overdo. The eight boss bodies, the ten
  attackers, the eight ship marks and the radar strip were all drawn
  against still frames; whether any of it reads at speed with forty bullets
  on screen is a different question, and a fully fitted Mark VIII is
  certainly busy.
- **Coverage is partial and the report says so.** Rendering, audio and HUD
  modules are exercised only by the browser smoke test, so they contribute
  no line coverage. The smoke test asserts pixels, not that anything looks
  right.
- **HUD text uses the system monospace font**, not a bitmap font, so it does
  not scale as crisply as the rest of the art.
- **Anti-cheat is defence in depth, not proof.** See the backend section for
  what it does and does not establish.
- **No mod browser in-game.** Mods are published over the API and played via
  `/?mod=<id>`; there is no UI for discovering them yet.
- **The adaptive scaler still climbs slowly.** Menus are sharp now because
  they ignore the cap, but gameplay itself takes about twenty seconds of
  flying to reach the resolution a machine can actually hold. The pacing is
  deliberately cautious and has never been tuned against real hardware.
- **Single-process storage.** JSON snapshots, no SQL, no horizontal scaling.
- **Account recovery needs a password.** A pilot who never set one is only
  the token in `localStorage`: lose it and that identity is gone, though
  their scores stay on the board under the old name.

## Licence

GPL-3.0
