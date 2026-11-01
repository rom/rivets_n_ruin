# Changelog

Notable changes to Rivets 'n Ruin. Newest first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the versions follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

Entries say what changed and, where it matters, why — a line that only
names a file tells a reader nothing they could not get from `git log`.
Bugs found by playing are marked as such, because they are the ones
worth learning from.

## [Unreleased]

### Added

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

- The persistence snapshot was never written back for hangars — read on
  load, never saved. Caught by a store-level test after the browser
  round-trip passed, because the server never restarted during it.

### Security

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

[Unreleased]: https://github.com/rom/rivets_n_ruin/compare/v1.0.0...rom
[1.0.0]: https://github.com/rom/rivets_n_ruin/releases/tag/v1.0.0
