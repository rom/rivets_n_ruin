A HUD you can read, bosses you can tell apart, and a server that keeps its secrets in their own directory.

## The game

**The HUD is sharp again.** The adaptive frame-rate scaler was shrinking the whole canvas, so on a wide window every glyph in the HUD was upscaled the moment gameplay started — and came back sharp in the menus, which is why it read as something that happens *while playing*. The world and the UI are separate layers now; the compositor does the stretch, which is free. The smoke test measures 60fps, up from the 48 it managed before.

**A reused boss is refitted, not redrawn.** Twenty-five bosses are built from eight ships, and through the first sixteen hulls each silhouette came round exactly twice, identical. Later appearances now carry ribs, bolted plating and a livery — same class, visibly a different vessel. A test fails if two hulls would ever end in a boss that draws the same.

**`F` twice on the settings screen starts you over**: the hangar, the best score, the furthest hull, and the pilot with them. Settings and accessibility options survive, because those are how you like to play rather than what you have achieved.

## Accounts

Signing in now keeps your coins, gold bars and bought mods against the account, so they survive a new browser, a cleared cache or a second machine. The two copies are reconciled by taking the better of each — the only rule that cannot take something away from a pilot who earned it.

## The server

**Three filesystem roots.** `-dir` for the game, never written to and safe on a read-only mount; `-state` for leaderboards, open runs and the log; `-accounts` for password and token hashes. Nothing holding a credential sits in the directory whose job is to be published, and on Linux the sandbox is told the same thing.

**An operator's door.** `/api/admin/*` — list, search, add, inspect, reset, delete and re-password pilots. Loopback-only by default, 30-minute sessions, every action audited. Not registered at all unless you configure a credential: no default password, nothing to find.

**`POST /api/auth/available`** answers whether one pilot name is free, one bit at a time, behind a rate limit an order of magnitude tighter than the rest of the API. Deliberately not an enumeration oracle.

Security headers gained `X-Frame-Options`, `Cross-Origin-Embedder-Policy` and `X-DNS-Prefetch-Control`, and the content security policy dropped `'unsafe-inline'` entirely.

## Fixed

- **The account database was served over HTTP** under the pre-split layout. Twice: once in 1.0.0, and once again in a fix that recorded the directory and skipped the files inside it.
- `upgrade-insecure-requests` broke every deployment not on localhost.
- A merge dropped every CSS rule on the page, which put the HUD and the title screen below the fold and looked like booting straight into a run.
- Signing in after page load pushed the browser's hangar over the account it had just signed into.
- A data race between snapshots and live requests.
- Several smaller ones: a boss fade cancelled by a stray `globalAlpha`, a config default whose comment claimed the opposite of its value, a password-trimming mismatch that could set a credential you could never use.

Upgrading from 1.0.0 with no path flags: the server will refuse to start if it finds your old `data/rnr.json`, and tell you how to keep it or move it. It will not silently ignore your data.

## Running it

```bash
tar xzf rivets-n-ruin-1.1.0-linux-amd64.tar.gz
cd rivets-n-ruin-1.1.0-linux-amd64
./rnr-server
```

Then open http://127.0.0.1:8000/. For anything real, put the state and the accounts outside the web root:

```bash
./rnr-server -state /var/lib/rivets/state -accounts /var/lib/rivets/accounts
```

The server-only builds are static and `CGO_ENABLED=0`; point them at the game with `-dir`.

Built reproducibly in a pristine checkout (Go 1.24.7, `-trimpath`). Verify with `sha256sum -c SHA256SUMS.txt`.
