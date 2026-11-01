# Changelog

Notable changes to Rivets 'n Ruin. Newest first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the versions follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

Entries say what changed and, where it matters, why — a line that only
names a file tells a reader nothing they could not get from `git log`.
Bugs found by playing are marked as such, because they are the ones
worth learning from.

## [Unreleased]

### Changed

- **Ships with several engines draw far more cheaply.** Each engine
  plume switched the canvas composite mode to `lighter` on its own, and
  that switch costs far more than the pixels it blends: eight MONITORs
  cost 15.7ms a frame, and 0.3ms once a ship batches its plumes into
  one switch. Output is pixel-identical — every body was rendered in
  both builds and the PNGs compared.

### Fixed

- The Known gaps section counted eight attackers, six towers and eleven
  mods, long after there were sixteen, fifteen and thirteen. It opens by
  saying a stale gap list is worse than none, so a parity test now
  counts them.

## [1.1.0] — 2026-11-01

A HUD you can read, bosses you can tell apart, three filesystem roots,
accounts that keep your progress, an operator's door, and a way to
start over.

### Added

- **Six more things bolted to the hull.** POPGUN and BASTION are the
  gun at 0.45× and 3.2× its weight, so a hull can vary its pressure
  without varying what it asks of you. RADAR and ARRAY do not shoot:
  they paint their neighbours, and every tower inside their reach wakes
  earlier and comes round faster while they stand. POST keeps the
  interceptor stream thick. SILO opens with long-range missiles from
  the far side of the screen, slow enough to shoot down if you see them
  leave.
- **Spaceports.** A flat apron with the port's traffic control at one
  end, fuel standing in the middle and whatever was parked when the
  shooting started. The tanks chain — placed close enough that one
  going up reaches the next — so a port can be taken apart with a
  single shot, or taken apart around you if you came in close for the
  lander.
- Each installation now has its own silhouette (`src/towerart.js`)
  rather than a tinted dot on a shared mounting.
- **Four more attacking ships, at the ends of a scale.** The twelve
  before them were all roughly ship-sized. A **GNAT** is six pixels
  across, has one hit point and no gun, and arrives in threes — it
  costs you a line rather than hit points. A **DART** lines up, runs
  flat out emptying its gun, and never turns round. A **BARGE** is
  slow and heavy and opens with a fan rather than an aimed shot. A
  **MONITOR** is the heaviest thing short of a miniboss, with two
  mounts at opposite ends so there is no quiet side to go round on.
- `make run`, `make smoke` and `make gallery` use `-state` and
  `-accounts`; the project's own tooling should model the layout the
  README recommends rather than the one it warns about.

- **`F` twice on the settings screen starts you over**: the hangar, the
  best score, the furthest hull reached, and the pilot with them. The
  account has to go too, or the best score syncs straight back down and
  the button is a lie. Runs already on the leaderboard stay there, under
  the old name, because that board is a public record; signing back in
  gets the old pilot and everything of theirs back. Settings, mute and
  the chosen tune survive — those are how somebody likes to play, not
  what they have achieved.

- **Accounts keep your hangar.** Coins, gold bars and bought mods are
  held against the account as well as the browser, so they survive a new
  machine or a cleared cache. The two copies are reconciled at sign-in by
  taking the better of each, which is the only rule that cannot take
  something away from a pilot who earned it.
- **An operator's door.** `/api/admin/*`: list, search, add, inspect,
  reset, delete and re-password pilots, plus store statistics. Loopback
  only by default, 30-minute sessions, every action audited before it
  happens. Not registered at all unless a credential is configured.
- **`POST /api/auth/available`** — is one pilot name free? One bit, one
  name at a time, behind a rate limit an order of magnitude tighter than
  the rest of the API. Deliberately not an enumeration oracle.
- **`-hash-password`** reads a password on stdin and prints its hash, so
  the admin credential can be configured without the plaintext ever
  reaching the server.
- **Three filesystem roots.** `-dir` for the game, never written to and
  safe on a read-only mount; `-state` for leaderboards, open runs and the
  log; `-accounts` for password and token hashes, which has no business
  living next to the directory whose job is to be published.
- Security headers: `X-Frame-Options`, `Cross-Origin-Embedder-Policy`,
  `X-DNS-Prefetch-Control`, ad-topics denials, and `Strict-Transport-Security`
  behind `-hsts` and only ever over TLS.
- A consolidated **Security** section in the README, including the two
  claims that turned out to be false.

### Changed

- **The HUD is no longer blurred by the frame-rate scaler.** The adaptive
  cap used to shrink the whole canvas, so on a wide window every glyph was
  upscaled the moment gameplay started and came back sharp in the menus.
  The world and the UI are separate layers now; the compositor does the
  stretch, which is free. Reported from play as "the text in the HUD gets
  blocky". Smoke-test frame rate went 48 → 60fps.
- **A reused boss is refitted rather than redrawn.** Twenty-five bosses are
  built from eight ships, and through the first sixteen hulls each
  silhouette came round exactly twice, identical. Later appearances now
  carry ribs, bolted plating and a livery. Reported from play as "all
  bosses occur twice" — which, after the arena duplicate was fixed, was
  still true for a completely different reason.
- The content security policy dropped `'unsafe-inline'`: the page's
  `<style>` block moved to `src/game.css` so `style-src 'self'` means it.
- `-data` is deprecated in favour of `-state` and `-accounts`. It still
  works, names one combined file, and warns.

### Fixed

- **The page lost every CSS rule.** Two branches changed the same region
  of `index.html`; the merge kept one's inline `<style>` and the other's
  policy forbidding inline styles. The two canvases stopped overlapping
  and the HUD, splash and title rendered below the fold, which looked
  like booting straight into a run.
- **`upgrade-insecure-requests` broke every deployment not on
  localhost**, rewriting the game's own modules to `https://` on a
  server with no TLS listener.
- **The legacy `-data` layout served the account database again** — the
  same hashes, by the same route, as the bug the split was written to
  fix. So did `-state` pointed at the web root.
- A file whose name merely began with a writable directory's name
  (`statements.html` beside `state/`) was answered `404`.
- Signing in after page load pushed the browser's hangar over the
  account it had just signed into. The reconciliation now follows every
  identity change rather than running once at startup.
- Snapshots handed the JSON encoder live player pointers after releasing
  the lock — a data race against any request arriving mid-write.
- The boss refit reset `globalAlpha` to 1 instead of restoring it,
  cancelling the fade on a dying boss.
- `-hash-password` and `-admin-password-file` trimmed differently, so a
  password with surrounding spaces could be set and never accepted.
- The persistence snapshot was never written back for hangars — read on
  load, never saved. Caught by a store-level test after the browser
  round-trip passed, because the server never restarted during it.

### Security

- `Config.AdminAllowRemote` replaces `AdminLocalOnly`, so the zero value
  is loopback-only. The old field's zero value allowed every address
  while its comment claimed the opposite and pointed at a constructor
  that did not exist.
- `X-Forwarded-Proto` is only believed with `-trust-proxy`; without it
  any client could turn HSTS on by sending a header.
- Expired admin sessions are swept rather than held until their own
  token comes back.
- **The account database was served over HTTP.** `-dir` defaulted to `.`
  and `-data` to `data/rnr.json` underneath it, so running the release
  tree as documented put the password hashes where the static handler
  would hand them out: `GET /data/rnr.json → 200`. Found by extracting the
  1.0.0 archive, running it, and fetching the path the startup log prints.
  Everything the server writes is now blocked from being served.
- Corrected a false claim in the code and the README: `os.Unsetenv` does
  not scrub `/proc/PID/environ`. `PR_SET_DUMPABLE(0)` is what bounds it,
  and file-based credential options now exist so nobody has to rely on it.

## [1.0.0] — 2026-11-01

First release. Twenty-five hulls, eight boss shapes, a Go backend with
anti-cheat and platform hardening, and a test suite that has caught more
bugs than play has.

### Added

- **The campaign.** Twenty-five hulls, hand-authored through the first
  eight and generated with per-hull character beyond that; a boss in an
  arena at the far end of each, a ten-second wreck window after it dies,
  and a refit between hulls.
- **The ship.** Gun levels, an armory of four ordnance types, permanent
  mods bought from the armourer, shields, lives and a hangar that
  persists between runs.
- **Attackers**: twelve types, each asking something the others do not —
  leeches that clamp on, mirrors that copy your fire, carriers that
  launch broods, chainers that work in pairs.
- **Minibosses**, drawn from the attackers' own visual vocabulary.
- **The backend**: accounts with passwords, two leaderboards (best
  pilots and best runs), publishable mods, live presence, and score
  validation derived from the game's own physics.
- **Hardening**: Landlock, `PR_SET_NO_NEW_PRIVS` and `PR_SET_DUMPABLE`
  applied across every thread on Linux, a hardened systemd unit, and an
  honest report of what the platform would not give.
- **Accessibility**: auto-fire, game speed, reduced flashing, high
  contrast and a firing line, each removing one specific barrier rather
  than making the game easier in general.
- **Attract mode**, which flies the real game through the real update
  loop rather than playing a recording.

### Fixed during development

The ones worth remembering, all found by playing or by looking at pixels:

- A `NaN` camera blanked the hull and stopped the world scrolling while
  every state assertion still passed — the score, the ship and the frame
  rate all looked healthy against a black screen. The browser smoke test
  exists because of this one.
- The leaderboard rejected a legitimate 4,650,367-point run.
- Turning back a short distance destroyed everything just off screen:
  coins, pickups and attackers that had been there a second ago.
- "Healthbar full" did nothing.
- Hardening reported success while protecting one thread in eight.
  `PR_SET_NO_NEW_PRIVS` and Landlock are per-thread, and Go moves
  goroutines between threads.
- Every boss was fought twice: killing one cleared `game.boss`, and the
  arena spawn only asked whether a boss was present while the player
  stood in it sweeping the wreck.
- The armory readout drew straight through the grenade count.
- The end-screen refusal reason was drawn through "ENTER TO FLY AGAIN".
- Clearing the hangar did not clear it: the game saved again on
  `pagehide` and wrote everything straight back.

[Unreleased]: https://github.com/rom/rivets_n_ruin/compare/v1.1.0...rom
[1.1.0]: https://github.com/rom/rivets_n_ruin/releases/tag/v1.1.0
[1.0.0]: https://github.com/rom/rivets_n_ruin/releases/tag/v1.0.0
