import { DT, MAX_FRAME } from './config.js';

// Fixed-timestep update, free-running render. Physics must not change
// character with refresh rate: 60Hz and 144Hz fly identically.
export function startLoop(update, render) {
  let last = performance.now() / 1000;
  let acc = 0;

  let errors = 0;
  const MAX_LOGGED = 10;

  function frame(nowMs) {
    // Reschedule FIRST. If this were at the end, a single throw anywhere in
    // update or render would permanently kill the loop and freeze the game
    // with no way back. A glitchy frame is recoverable; a dead loop is not.
    requestAnimationFrame(frame);

    const now = nowMs / 1000;
    let delta = now - last;
    last = now;
    if (delta > MAX_FRAME) delta = MAX_FRAME; // tab was backgrounded; don't catch up
    acc += delta;

    try {
      let steps = 0;
      while (acc >= DT && steps < 10) { update(DT); acc -= DT; steps++; }
      if (steps === 10) acc = 0; // can't keep up — drop the backlog rather than spiral
      render();
    } catch (err) {
      acc = 0; // don't replay the step that blew up
      errors++;
      if (errors <= MAX_LOGGED) {
        console.error('frame error:', err);
        if (errors === MAX_LOGGED) console.error('further frame errors suppressed');
      }
    }
  }
  requestAnimationFrame(frame);
}
