# Changelog

Notable changes to Rivets 'n Ruin. Newest first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the versions follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

Entries say what changed and, where it matters, why — a line that only
names a file tells a reader nothing they could not get from `git log`.
Bugs found by playing are marked as such, because they are the ones
worth learning from.

## [Unreleased]

## [1.2.0] — 2026-11-04

### Added

- **A pilot who drops out can come back.** A connection going quiet and
  a pilot pressing `Y` used to be the same event — both arrived as a
  peer leaving, both ended the run — and they are not the same thing.
  One is a decision; the other is a tab suspended on a phone, a train
  entering a tunnel, a laptop lid. A client that is leaving now says so
  on the socket it is already holding, and everything follows from that
  one bit.

  A dropped connection holds the run on both machines. The server keeps
  the empty slot for forty-five seconds, the pilot still there is told
  what is being waited for and for how long, and the one who dropped
  reconnects onto the same code and resumes mid-run. Nothing advances in
  the meantime, on either machine: a returning pilot must not come back
  to a ship that has been flown somewhere by nobody.

  A quit is said out loud instead. The host quitting ends the game — it
  was running the simulation — so the guest is told why and given four
  seconds to read it rather than being dropped on the title
  mid-sentence. The guest quitting is a notice: the host keeps flying
  the run it is in.
- **A panel for the other pilot**, top right, in co-op only: their
  shield against their own ceiling, their spare hulls, and whether they
  are down or waiting to reconnect. Two ships share one screen, one hull
  and one score, and until now the only thing either pilot could tell
  about the other was where it was — so "I'm nearly out" was something
  the two people had to say out loud, which works if they are in the
  same room and not otherwise.
- **Colour schemes in the operator tool**, in the header. RUIN, the
  game's own palette, stays the default: whoever is looking at the page
  usually has the game open in another tab, and a tool that looks like a
  different product makes them check twice which one they are about to
  delete something in. That stops being the right trade when you are
  reading it for an hour in daylight, so there is SLATE, which is light,
  and EMBER and PHOSPHOR, which are not. Each scheme is the whole
  palette, so none of them leaves a panel behind in somebody else's
  colours.
- **`make coop-smoke`**, which drives co-op in two real browsers: a
  deliberate quit each way, a dropped socket, a reconnect, and the hull
  both pilots are on. It earned its place on its first run by catching a
  fault every unit test passed through; see below.

- **Help during a run.** `H` opens the pages from anywhere now, in
  flight included — which is where a player is most likely to want a key
  reminded, and is exactly where the game used to refuse. It stops the
  run while it is up, and a run already paused stays paused when the
  page closes. In co-op it does not stop: the host halting would freeze
  the guest's whole world and the guest cannot halt the host at all, so
  there the page goes over a running game, translucent enough to see the
  hull through, with this player's hands off the controls. The footer
  says which of the two is happening.
- **A co-op top ten, and co-op runs recorded on the server.** Its own
  board and its own table, because two pilots and one score is not
  something the solo board can represent: ranked against a soloist a
  pair wins for having twice the guns, and folded onto one pilot's card
  the other pilot vanishes from a run they flew half of. `B` now cycles
  three boards. Neither pilot's solo card moves, and `BEST SCORE` on the
  title screen stays the solo record.

  The host posts the run — it is the side that simulated it, so its
  figures are the ones the game produced — and the guest's end screen
  says so rather than sitting on `SENDING RUN...` for ever. The partner
  is not in the request: joining a game is now an authenticated `POST`,
  so the server already knows who the second pilot is and takes it from
  the room. A host can post the run it played and nothing else.

  The server also times how long the two were actually connected. A
  guest who drops out on the first hull did not fly the run the board
  would otherwise credit them with, so a co-op run needs half its flight
  time flown together, with a floor under the rule so a pair who died
  early are not refused over a second of socket setup. The number is
  kept on the row, and the operator tool shows it as a percentage beside
  a new CO-OP tab that lists and removes co-op runs.
- **A hyperspace jump**, on `V` with a ten second cooldown: a short hop
  for the two situations nothing else answers, being wedged in geometry
  and having a volley already in the air. Where it lands is searched back
  from the full distance until the ship fits, so a jump into a wall is a
  shorter jump rather than a jump through it; with nowhere to go at all
  it is refused and the cooldown is not spent.
- **The title screen is framed as a launch gantry**, and deliberately
  not as the hangar: an arched mouth in conduit blue with ribs over the
  opening, cold strip lighting set into the edges and open grating
  underfoot, against the hangar's flat steel trusses, warm lamps and
  plated deck. A portal rather than a border, so the starfield and the
  dreadnought show through the opening.
- **Key remapping**, on a CONTROLS screen reached with C from settings.
  A rebind takes the key off whatever had it, so one key never does two
  things, and five actions are deliberately fixed: START, the two
  answers to a yes/no prompt, and the two irreversible wipes.
- **On-screen controls, and a layout that fits a phone.** A four-way pad
  and the weapons under the thumbs, PAUSE on every screen because a
  phone has no Escape key. AUTO shows them on a touchscreen; ON and OFF
  are for the machines the browser gets wrong. They drive the same input
  sets the keyboard does, so nothing downstream knows which is in use.
  The page gives up its keyboard-hint strip on a touch device, stops the
  browser taking a steering gesture as a scroll, and says to turn a
  phone sideways rather than leaving a postage stamp.
- **Five colour schemes** — GANTRY (what shipped), AMBER CRT, PHOSPHOR,
  DEEP ICE and OXIDE — on a `COLOUR SCHEME` setting. They repaint the
  instrument panel: the HUD, the menus and the frames, not the hull,
  which has its own per-hull theme. `COL` is rewritten in place rather
  than replaced, so the roughly three hundred places that read it need to
  know nothing about schemes.
- **Four hazard fields: FLARE FIELD, VORTEX, ICE CLOUD and ARC FIELD.**
  Areas rather than objects — nothing solid, nothing to shoot, and a
  price per second for being inside. The only threat on a hull that is
  purely a question about your line. Charged by the second, so clipping a
  corner is cheap and cutting through is not, and the ship's box counts
  rather than its centre. They are invisible to the clearance sweep,
  being insubstantial, so the generator keeps a clear band beside every
  one and a test holds it there.
- **Three attackers that take control rather than shield.** A **NETTER**
  throws a net that costs the next few seconds of being able to get out
  of the way; a **GRAPNEL** hooks the ship and hauls, dragging it off its
  line while backing away, and drops the line when it dies; a **SCORCHER**
  burns a short cone of flame, and the fire outlasts the thing that lit
  it. All three are drawn on the hull while they hold, because a loss of
  control the player cannot see reads as the game stuttering. A second
  hit refreshes rather than stacks.
- **Hull modifiers.** One named rule per hull — PRESSURE, FLAK CURTAIN,
  OVERRUN, GRAVITY WELL, BLACKOUT, LIVE HULL, SALVAGE RUN, HARD VACUUM —
  drawn from the hull's own seed and named on the launch card with a line
  saying what it does. Past AURUM the campaign was one formula with bigger
  numbers: seventeen generated hulls fielding the whole roster and the
  whole tower list, differing only in health, speed and spawn rate. None
  on the first three hulls; from the fourth the odds run 45% to a cap of
  80%, so a clean hull stays possible.
- **Squadrons.** Attackers arrive as compositions with a shape — three
  gnats in a vee, a barge with darts screening it, a monitor on its own —
  instead of one uniform roster pull every few seconds. The gnat swarm and
  the chainer pair were already special cases of this written into the
  spawn path; they are table entries now. The pressure is deliberately
  unchanged: the gap after a squadron is its weight over the hull's own
  rate, and that rate is set to exactly what the old cadence delivered,
  within 0.4% on every hull.
- **The press**, the first obstacle pattern whose geometry moves. Jaws
  hanging off both girders that close and open on a cycle, staggered along
  the run. It never shuts: the gap bottoms out at 34-52px against a ship
  nine tall, so being caught at the wrong phase is a scrape, not a crush.
  From the fourth hull, for the same reason the modifiers are.
- **HULL LAYOUTS** in settings. FIXED is the historical behaviour and the
  default, bit for bit; SHUFFLED folds a per-run seed into every hull so
  the campaign is new each run.
- **Installations: bases, power plants, fuel stations and air-defence
  posts**, beside the spaceports that were already there. Each is an
  apron off one girder with its works standing on it, so the corridor
  beside it stays open — somewhere to go into, not a wall across the
  hull. Nine new structures: barracks, store sheds, bulk cisterns whose
  blast reaches four times a fuel tank's, pumps, a reactor that quickens
  every gun on its plant while it stands, pylons with the line strung
  between them, watchtowers, and **searchlights that sweep the corridor
  and light the ship up for every gun in reach**. Breaking the lights
  first is the whole of the decision an air-defence post offers.
- **Sounds for everything that had none.** The netter, the grapnel and
  the scorcher all played the ordinary gun sound, so the three attackers
  that cost something other than shield were audibly identical to the
  thing you had been dodging since hull one. Thirteen new cues: a throw
  and a landing for each of the three, a creak while a hook holds, a
  crackle while you are alight, a distinct voice for each of the four
  hazard fields, a cistern, a reactor, a pylon and a searchlight finding
  you. The ones called from the 120Hz update are throttled, because any
  one of them unthrottled fills the voice pool and silences the rest of
  the game.
- **Two-player co-op.** Two pilots, one hull, one screen, on two
  machines. `G` from the title: one hosts and reads out a
  five-character code, the other types it in. The host simulates
  everything and says what happened; the guest sends its buttons,
  predicts its own ship so the stick answers immediately, and is
  corrected toward the host every snapshot. The hull never crosses the
  wire — both ends build it from the same seed — and nor do particles;
  what does is everything the two players can affect, twenty times a
  second, binary, about 1.4KB in a busy frame. The camera sits at the
  midpoint of the pair and neither pilot can drag the other off the
  edge.
- **A WebSocket server**, RFC 6455, in `internal/ws`, because the
  backend is standard library on purpose and co-op is the first thing
  in it that needs a socket rather than a request.
- **The operator tool can edit a pilot's hangar** — coins, gold bars
  and the permanent systems they own. Straight through the same
  clamping the pilot's own client gets, and systems are a picker
  rather than a text box: the ids are mirrored into Go with a parity
  test, so an operator cannot grant `platting` and wonder why nothing
  happened.
- **The backend reports itself.** Build version, boot time, uptime and
  the oldest client it will take writes from, on `/api/stats` and on
  the operator tool. The version is stamped in at link time from
  `src/config.js`, so the server and the game it serves cannot claim
  different numbers.
- **Client versions are counted and can be policed.** Every request
  says which build it came from; the server tallies what it sees over
  the last day and the operator tool shows the spread. With
  `-min-client-version` set, a build below the floor is refused writes
  with a 426 and a sentence saying to reload — reads are never gated,
  because an old client that cannot see the leaderboard looks like a
  server that is down.
- **An operator tool: a password-protected web page on its own port**,
  default `127.0.0.1:8001`, with its own API beside it. Statistics, one
  pilot in full, one run in full, reset a high score, remove a pilot,
  change a pilot's password, edit their counters. The admin routes are
  no longer registered on the game's listener at all, so a request for
  one there is answered by the static file handler rather than by a
  password check inside a handler. The page is compiled into the binary
  rather than served from the static root, which is reachable from the
  public port by definition.

### Changed

- **The armourer stands in a hangar now.** It was a flat black rectangle
  with two columns of rows floated on it, which read as a settings page
  that happened to sell things. The bay is drawn around it: a trussed roof
  with lamps, ribbed wall panels down both sides, a plated deck with
  hazard chevrons, and your own ship chocked on the deck under the lights
  — drawn from the live player, so a mod bought on a row above shows up on
  the hull below it. Titled **HANGAR**, with the armourer named under it.
  `SHOP_LAYOUT` holds the margins the frame reserves, and a test measures
  every hull's list against them: the first version fit the list it was
  built against and ran the blurb and the buy note through the floor on
  the hulls that sell twenty-two rows.
- **Ships with several engines draw far more cheaply.** Each engine
  plume switched the canvas composite mode to `lighter` on its own, and
  that switch costs far more than the pixels it blends: eight MONITORs
  cost 15.7ms a frame, and 0.3ms once a ship batches its plumes into
  one switch. Output is pixel-identical — every body was rendered in
  both builds and the PNGs compared.

### Fixed

- **Any co-op game longer than ten minutes ended itself.** The room's
  open deadline was pushed forward on every join and then checked
  whatever the room was doing, so a room with two pilots happily flying
  it was swept ten minutes after the second one arrived and both sockets
  were closed underneath them, mid-run. It read as the backend falling
  over. The open deadline now applies only before the pair is complete.
- **A room both pilots dropped out of was reaped immediately**, so
  neither could rejoin: the idle deadline ran from when the room was
  created, which has always passed by the time a real game ends. It runs
  from when the room actually emptied.
- **The guest kept flying the hull it launched on while the host moved
  on.** Which hull the host is on has been in every snapshot since co-op
  shipped and nothing read it, so the guest drew the new hull's
  attackers, shots and loot against the old hull's walls: shots stopping
  in mid-air, foes inside girders, a boss gate that was not there. Worse
  at the end of a run, where a host on the end screen left the guest
  flying a hull nobody was advancing and no key could leave.
- **A guest's shield was cut to 255 from hull four onwards.** It was one
  byte on the wire, which is fine for a stock hull at 100 — but the
  refit raises the ceiling every hull and it reaches four figures by the
  end of a long run, and the guest takes its own shield from the host
  rather than predicting it. Not a display fault: the shield really was
  cut. Two bytes now, with the ceiling sent beside it, because a bar is
  a fraction and a fraction needs its denominator.
- **The lives count on the wire was always zero.** It was read off a
  field that does not exist — lives belong to the player, not the game —
  so the byte said nothing and the guest copied it into a field nothing
  reads. One count for two pilots is the wrong shape anyway, because
  they lose their own; it is per ship now.
- **Quitting a co-op run raced its own submission off the board.** Found
  in two browsers, with every unit test passing: telling the server you
  are leaving is what closes the room, the co-op board needs the room
  open to know who the second pilot was, and the `POST` came back `409`
  with no row written. The quit now goes out after the run has landed.
- **A peer could put words in the server's mouth.** Text from a client
  was relayed to the other side verbatim, and no client has ever sent
  any — so a forged `refused` ended the far pilot's game and a forged
  `joined` handed it a seed of the sender's choosing. Only the server
  speaks in text now; the one thing a client says back is that it is
  leaving, rate limited like everything else.
- **The co-op view juddered up and down until a run was unreadable.**
  Reported by both pilots. `drawWorld` derives the view's vertical
  offset from nothing but the screen shake, and the only code that wound
  the shake down lived inside `updateCamera` — which co-op skips,
  because co-op places the camera itself. So the first hit set the shake
  and nothing ever took it away, and since a kick caps at fourteen
  pixels, two hits left the whole world layer jittering by up to
  fourteen pixels every frame for the rest of the run. The decay is now
  its own function that every camera path calls, with a test that walks
  all of them.

- **The searchlights threw a NaN into the renderer once a frame, and
  every test passed.** `TOWERS.array` has carried `sweep: 1.1` — radians
  a second for its dish — since the spaceports went in; the searchlight
  arrived with `sweep: { arc, speed, range }`. Every guard that asks
  only whether `sweep` is truthy let the array into the searchlight
  path, `sw.speed` read `undefined`, every angle downstream became NaN,
  and `createLinearGradient` threw once a frame. Found in a browser, in
  one screenshot. Three things changed so node finds the next one: the
  canvas stub rejects a non-finite number handed to any drawing call
  (it was a Proxy returning a no-op for everything, which is exactly why
  it caught nothing) and starts in the state a real context starts in;
  the draw tests park the camera on every structure of every hull and
  separately plant one of every tower kind on both girders; and a test
  asserts no two tower kinds give one property name two different
  shapes.
- **"The world draws on every hull" was drawing hull 1 twenty-five
  times.** `setStartHull` records which hull the hangar has selected and
  nothing else; reaching it means playing the title and launch sequences
  through. The draw tests build the level directly now.
- **Every installation could stand two structures on the same ground.**
  Each rolled an apron width and then placed each kind at its own
  arithmetic inside it: a base put a cistern exactly on top of a depot
  and hung its back three sheds off the end of its own deck, and a
  spaceport stood a lander in a fuel tank. All five lay out along a
  cursor in one shared function now, so the deck cannot come out
  shorter than its contents and nothing shares ground.
- **A searchlight on a hull with no radar dish painted nothing.** The
  paint loop had an early-out from before beams existed — no dish, no
  painting at all — and an air-defence post fields lights, a watchtower,
  sheds and one gun and not a single dish. On the one installation built
  around them, the searchlights did nothing.
- **A searchlight's lamp disagreed with its own beam**, drawn at the
  raw phase accumulator while the beam used the sine of it, so the lamp
  span while the light swung.
- **The controls screen could show a key that did something else.**
  `keyFor` read the default key map directly, so after rebinding HELP
  onto Q the screen still listed Q against QUIT — one key shown
  against two actions, only one of which it did. It reads the live map
  now, and an action whose only key was taken reads as unbound, which
  is the honest thing to print. Found by adding one new action.
- **The operator tool's whole layout was served to anyone who asked.**
  It was in the page under a `hidden` attribute: nothing showed, but
  view source before signing in and you had every tab, every button
  and every route it calls. The shell is built after a password works
  and removed again on sign-out.
- **Searching the operator tool's runs for a short name matched random
  ids.** Ids are 32 hex characters, so a two-letter query lands inside
  a good fraction of them: searching for the pilot `ada` returned her
  runs plus a scattering of other people's whose id happened to contain
  `ad`. Names match anywhere, ids from the start — an id is pasted, not
  remembered. Found by a test that passed most of the time, which is
  how it reached CI.
- **Eighteen of the twenty-five hulls had somewhere the ship could not
  get through.** Reported from play, with a screenshot. The hull walk
  checked each vertical slice for a gap tall enough, which says nothing
  about whether the ship can move *between* two slices: a stub from the
  roof and one from the floor, nineteen pixels apart, leave every slice
  half open and no way past for a ship nineteen pixels wide. The chicane
  was making them — its stubs are capped as a pair now, and the gap
  between them is clear of the ship's width with room to spare. The check
  sweeps the hull as a configuration-space problem, so it answers the
  question that was actually being asked.
- **The gallery tool printed `undefined/10` into the README.** It posed
  the ship's ordnance by replacing the whole ammo object with a literal
  naming three of the four kinds, so the armourer screenshot showed SPIKE
  MINES with no count — and a bomb count of 12 against a cap of 9. It
  merges into the real ammo now, within the caps.
- **The sound dropped out whenever the machine was busy.** Reported from
  play. The sequencer filled a fixed 120ms window of the audio timeline,
  woken by a 25ms `setInterval` — but `setInterval` only promises "no
  sooner than", and a main thread blocked for longer than the window
  leaves a hole exactly as long as the block. A tab the browser has
  backgrounded is throttled to roughly one tick a second whatever the
  interval asks for, which meant 120ms of music per second and 880ms of
  nothing. Measured in a browser against the master tap, with the thread
  blocked for 850ms of every second: **91.8% of the output was silence.
  It is now 5.2%**, all of it in the single tick where the slowdown
  begins, because the scheduler cannot know the machine is slow until it
  has been slow once. The window now tracks the ticks that actually
  arrive, so a healthy machine keeps the short one and an intensity or
  tune change still lands promptly.
- **A stall used to lose the place in the tune.** The old scheduler jumped
  its clock to the present, throwing the stalled stretch away and the
  musical position with it. It steps over the missed steps now, so the
  form — which bar, which section — stays where the clock says it should
  be.
- **A hidden tab kept synthesising.** `requestAnimationFrame` stops when a
  tab is hidden, so the game is frozen, but the sequencer's timer keeps
  going throttled: a stutter played over a frozen game for nobody. The
  music stops on `visibilitychange` and picks up where it left off.
- **A ship deep inside a girder-anchored block could be pushed through
  the girder.** Collision resolved out the shortest side, which for a
  block hanging off the rim is the rim itself. It could not happen while
  every obstacle was static — you are pushed off a wall long before you
  are inside one — but a press jaw closes onto the ship, and a ship held
  under one came out at y=11.5, above the hull.
- **Restarting a run on the hull you died on stood the heavy towers back
  up with the wrong health.** reset() rebuilt the hull only when the index
  moved and otherwise restored the guns by hand, assigning the hull's base
  turretHp flat and dropping the per-tower multiplier: a BASTION came back
  with 6 hit points instead of 19. The hull is always rebuilt now, so the
  restore is gone with the bug.
- The Known gaps section counted eight attackers, six towers and eleven
  mods, long after there were sixteen, fifteen and thirteen. It opens by
  saying a stale gap list is worse than none, so a parity test now
  counts them. The same sentence appears a second time in the hull
  section, where it was also stale and is also checked now.
- The README claimed the narrowest gap in the campaign was 74px. It is
  39px, and has been for some time; a parity test measures it rather
  than trusting the prose.

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

[Unreleased]: https://github.com/rom/rivets_n_ruin/compare/v1.2.0...rom
[1.2.0]: https://github.com/rom/rivets_n_ruin/releases/tag/v1.2.0
[1.1.0]: https://github.com/rom/rivets_n_ruin/releases/tag/v1.1.0
[1.0.0]: https://github.com/rom/rivets_n_ruin/releases/tag/v1.0.0
