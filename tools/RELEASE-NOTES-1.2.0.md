Co-op that survives a bad network, a panel for the pilot beside you, and an operator tool you can read in daylight.

## A dropped connection is not a decision

A socket going quiet and a pilot pressing `Y` used to be the same event. Both arrived as the other pilot leaving, and both ended the run. They are not the same thing: one is a choice, the other is a tab suspended on a phone, a train going into a tunnel, a laptop lid.

A client that is leaving now says so, on the socket it is already holding, and everything follows from that one bit.

**A dropped connection holds the run.** Nothing advances on either machine — the server keeps the empty slot for forty-five seconds, the pilot still there is told what is being waited for and how much longer it is worth waiting, and the one who dropped reconnects onto the same code and carries on mid-run. Holding rather than pausing matters: a returning pilot must not come back to a ship that has been flown somewhere by nobody for half a minute.

**A quit is said out loud.** The host quitting ends the game, because it was running the simulation and there is nothing left to advance the world the guest is drawing — so the guest is told why and given a few seconds to read it rather than being dropped onto the title mid-sentence. The guest quitting is a notice: the host keeps flying the run it is in.

## The other pilot

Two ships share one screen, one hull and one score, and until now the only thing either pilot could tell about the other was where it was. Not how close it was to losing a hull, not whether it had a hull spare. "I'm nearly out" was something the two people had to say out loud, which works if they happen to be in the same room.

There is a panel in the top corner now: their shield against their own ceiling, their spare hulls, and whether they are down or waiting to reconnect. All of it was already being simulated — it was simply never sent and never drawn.

## Both pilots, one hull

Which hull the host is flying has been in every co-op snapshot since the mode shipped, and nothing read it.

So the host cleared a hull, loaded the next one, and the guest kept flying the hull it launched on with the new one's attackers, shots and loot drawn over it: shots stopping in mid-air, foes inside girders, a boss gate that was not there. At the end of a run it was worse — a host on the end screen left the guest flying a hull nobody was advancing, with no key that could leave it.

## Fixed

**Any co-op game longer than ten minutes ended itself.** The room's open deadline was pushed forward on every join and then checked whatever the room was doing, so a room with two pilots happily flying it was swept ten minutes after the second one arrived, with both sockets closed underneath them. It read as the backend falling over.

**A room both pilots dropped out of was reaped immediately**, so neither could rejoin — the idle deadline ran from when the room was created, which has always passed by the time a real game ends.

**A guest's shield was cut to 255 from hull four onwards.** One byte on the wire is fine for a stock hull at 100, but the refit raises the ceiling every hull and it reaches four figures by the end of a long run — and the guest takes its own shield from the host rather than predicting it, so this was not a display fault. The shield really was cut.

**The lives count on the wire was always zero**, read off a field that does not exist. One count for two pilots is the wrong shape anyway: they lose their own.

**Quitting a co-op run raced its own submission off the board.** Saying you are leaving closes the room, the co-op board needs the room open to know who the second pilot was, and the request came back `409` with no row written. Found in two real browsers with every unit test passing, which is why there is now a two-browser harness behind `make coop-smoke`.

**A peer could put words in the server's mouth.** Text from one client was relayed to the other verbatim, and no client has ever sent any — so a forged refusal ended the far pilot's game, and a forged join handed it a seed of the sender's choosing. Only the server speaks in text now.

## The operator tool

**Colour schemes**, in the header. RUIN, the game's own palette, stays the default, because whoever is looking at that page usually has the game open in another tab and a tool that looks like a different product makes you check twice which one you are about to delete something in. That stops being the right trade when you are reading it for an hour in daylight, so there is SLATE, which is light, and EMBER and PHOSPHOR, which are not.

Each scheme is the whole palette rather than a filter over the default, so none of them leaves a panel behind in somebody else's colours.
