# Rivets 'n Ruin

A side-scrolling shoot 'em up in the lineage of **Uridium** (skim the surface of a
capital ship, two-way scrolling, momentum-heavy handling) and **Jets'n'Guns**
(mercenary swagger, things exploding at a generous rate).

You fly the dorsal hull of a dreadnought end to end — then you have to fly it
back. The hull is solid. Hitting it costs you.

![Rivets 'n Ruin](docs/screenshot.png)

## Running it

ES modules need to be served over HTTP; opening `index.html` from the filesystem
won't work.

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. No build step, no dependencies, no install.

## Controls

| Key | Action |
| --- | --- |
| `←` `→` / `A` `D` | Horizontal thrust. Thrusting against your heading brakes, then flips the ship |
| `↑` `↓` / `W` `S` | Vertical thrust |
| `Z` / `Space` | Fire |
| `Enter` | Launch / restart |
| `P` / `Esc` | Pause |
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
src/projectiles.js src/particles.js src/camera.js src/rng.js src/input.js
```

Everything you'd want to tune while playtesting lives in `src/config.js`. The
game object is exposed as `window.game` for poking at from the devtools console.

## Known gaps

These are deliberate omissions from the vertical slice, not bugs:

- **No audio.** The reference games both lean hard on their soundtracks; this has
  none yet.
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

## Licence

GPL-3.0
