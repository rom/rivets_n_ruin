# Rivets 'n Ruin

A side-scrolling shoot 'em up in the lineage of **Uridium** (skim the surface of a
capital ship, two-way scrolling, momentum-heavy handling) and **Jets'n'Guns**
(mercenary swagger, things exploding at a generous rate).

You fly the dorsal hull of a dreadnought end to end — then you have to fly it
back. The hull is solid. Hitting it costs you.

![Rivets 'n Ruin](docs/screenshot.png)

## Running it

ES modules need to be served over HTTP; opening `index.html` from the filesystem
won't work. The repo ships a small Go dev server for that.

```bash
go run ./cmd/serve
```

Then open <http://localhost:8000>. Flags: `-port`, `-host` (pass `0.0.0.0` to
reach it from another device), `-dir`.

The game itself has no build step and no dependencies — it is plain ES modules
and canvas. `cmd/serve` is a dev convenience, **not a backend**: it pins the
JavaScript MIME type (a browser rejects an ES module served as `text/plain`,
which is what a container without `/etc/mime.types` will do) and sends
`no-store` so a reload always picks up your edits. Any static server works;
this one just removes two specific ways to lose an afternoon.

## Controls

| Key | Action |
| --- | --- |
| `←` `→` / `A` `D` | Horizontal thrust. Thrusting against your heading brakes, then flips the ship |
| `↑` `↓` / `W` `S` | Vertical thrust |
| `Z` / `Space` | Fire |
| `Enter` | Launch / restart |
| `P` / `Esc` | Pause |
| `M` | Mute / unmute |
| `R` | Restart mid-run |

## The run

Fly to the far end of the hull, turn around, fly back to the dock. The HUD's
progress bar flips from `OUTBOUND` to `RETURN RUN` at the turn. Completing both
legs scores a time bonus; dying three times ends it.

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

Audio cannot start before a user gesture (browsers forbid it), so the context is
created on your first keypress. Mute is `M` and persists across reloads.

## Layout

```
index.html        host page, canvas, integer upscaling
src/config.js     every tunable: physics, enemies, camera, palette
src/loop.js       fixed 120Hz timestep, free-running render
src/level.js      hull generation, collision buckets, pre-rendered plating
src/player.js     ship physics, flip, firing, hull collision response
src/enemies.js    turret and interceptor behaviour
src/game.js       state machine, collision pairs, scoring, run objective
src/render.js     world drawing
src/hud.js        HUD and the title / game-over / complete screens
src/pool.js       fixed-capacity object pools (no allocation during play)
src/audio.js      Web Audio graph, buses, voice limiting, synthesis primitives
src/sfx.js        the 14 sound effects
src/music.js      adaptive sequencer and its instrument voices
src/projectiles.js src/particles.js src/camera.js src/rng.js src/input.js
cmd/serve/main.go dev static server
```

Everything you'd want to tune while playtesting lives in `src/config.js`. The
game object is exposed as `window.game` for poking at from the devtools console.

## Known gaps

These are deliberate omissions from the vertical slice, not bugs:

- **No upgrade shop.** The weapon-mount economy that drives Jets'n'Guns is the
  obvious next system — the single forward cannon is a placeholder for it.
- **No boss, no landing sequence.** Uridium ends each level with a landing
  minigame; the dock here is just a position.
- **One hull.** Stage names (ARGENTUM, OSMIUM, TANTALUM…) are the planned way to
  carry Uridium's metal-naming ritual across a campaign.
- **HUD text uses the system monospace font**, not a bitmap font, so it doesn't
  scale as crisply as the rest of the art.
- The hull texture is one 12000×324 offscreen canvas (~15MB). Fine at this
  length; chunked lazy tiles if the level grows much past it.
- **No backend.** Scores live in `localStorage`, so the best score is per-browser
  and there are no leaderboards.

## Licence

GPL-3.0
