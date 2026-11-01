A hull with more on it, a fleet with light and heavy in it, a HUD you can read, and a server that keeps its secrets in their own directory.

## The hull

**Six more installations.** POPGUN and BASTION are the gun at 0.45× and 3.2× its weight — size is the message, and a hull can now vary its pressure without varying what it asks of you.

RADAR and ARRAY do not shoot. They *paint* their neighbours: while one stands, every tower inside its reach wakes earlier and swings round faster, and shows a ring in the dish's colour so the effect is visible rather than inferred. A dish spins and an array sweeps, and both turn whether or not anybody is watching. POST keeps the interceptor stream thick — cheap to kill and easy to ignore, which is the trap. SILO opens from 900px out with missiles slow enough to shoot down if you see them leave.

**Spaceports.** A place rather than a pattern: traffic control at one end, fuel standing in the middle, whatever was parked when the shooting started at the far end. The tanks are spaced so one going up reaches the next, so a port can be taken apart with a single shot — or taken apart around you, if you came in close for the lander.

## The fleet

**Four more attackers, at the ends of a scale.** The twelve before them were all roughly ship-sized.

| | r | hp | speed | |
| --- | --- | --- | --- | --- |
| **GNAT** | 6 | 1 | 360 | No gun. Arrives in threes — it costs you a line, not hit points |
| **DART** | 8 | 2 | 330 | Lines up, empties its gun along one pass, never turns round |
| **BARGE** | 21 | 14 | 54 | Opens with a fan, so sitting off its line does not work |
| **MONITOR** | 25 | 22 | 38 | Two mounts at opposite ends — no quiet side to go round on |

Size is not a difficulty knob with art attached: a thing twice as big is twice as easy to hit, so each one's weight had to buy something.

**Reused bosses are refitted rather than redrawn.** Twenty-five bosses are built from eight ships, and through the first sixteen hulls each silhouette came round exactly twice — identical. Later appearances now carry ribs, bolted plating and a livery.

## The HUD

**It is no longer blurred by the frame-rate scaler.** The adaptive cap used to shrink the whole canvas, so on a wide window every glyph went to mush the moment gameplay started and came back sharp in the menus. The world and the UI are separate layers now; the compositor does the stretch, which is free.

## Accounts

Signing in keeps your coins, gold bars and bought mods against the account, so they survive a new browser, a cleared cache or a second machine. The two copies are reconciled by taking the better of each — the only rule that cannot take something away from a pilot who earned it.

**`F` twice on the settings screen starts you over**: the hangar, the best score, the furthest hull, and the pilot with them. Settings and accessibility options survive, because those are how you like to play rather than what you have achieved.

## The server

**Three filesystem roots.** `-dir` for the game, never written to and safe on a read-only mount; `-state` for leaderboards, open runs and the log; `-accounts` for password and token hashes. Nothing holding a credential sits in the directory whose job is to be published, and on Linux the sandbox is told the same thing.

**An operator's door.** `/api/admin/*` — list, search, add, inspect, reset, delete and re-password pilots. Loopback-only by default, 30-minute sessions, every action audited. Not registered at all unless you configure a credential: no default password, nothing to find.

**`POST /api/auth/available`** answers whether one pilot name is free, one bit at a time, behind a rate limit an order of magnitude tighter than the rest of the API. Deliberately not an enumeration oracle.

Security headers gained `X-Frame-Options`, `Cross-Origin-Embedder-Policy` and `X-DNS-Prefetch-Control`, and the content security policy dropped `'unsafe-inline'` entirely.

## Fixed

- **The account database was served over HTTP** under the pre-split layout. Twice: once in 1.0.0, and again in a fix that recorded the directory and skipped the files inside it.
- `upgrade-insecure-requests` broke every deployment not on localhost, rewriting the game's own modules to `https://` on a server with no TLS listener.
- A merge dropped every CSS rule on the page, which put the HUD and the title screen below the fold and looked like booting straight into a run.
- Signing in after page load pushed the browser's hangar over the account it had just signed into.
- A data race between snapshots and live requests.
- Several smaller ones: a boss fade cancelled by a stray `globalAlpha`, a config default whose comment claimed the opposite of its value, a password-trimming mismatch that could set a credential you could never use.

**Upgrading from 1.0.0 with no path flags:** the server refuses to start if it finds your old `data/rnr.json`, and tells you how to keep it or move it. It will not silently ignore your data.

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
