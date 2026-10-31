import { DT, MAX_FRAME } from './config.js';

// Fixed-timestep update, free-running render. Physics must not change
// character with refresh rate: 60Hz and 144Hz fly identically.
export function startLoop(update, render) {
  let last = performance.now() / 1000;
  let acc = 0;

  function frame(nowMs) {
    const now = nowMs / 1000;
    let delta = now - last;
    last = now;
    if (delta > MAX_FRAME) delta = MAX_FRAME; // tab was backgrounded; don't catch up
    acc += delta;

    let steps = 0;
    while (acc >= DT && steps < 10) { update(DT); acc -= DT; steps++; }
    if (steps === 10) acc = 0; // can't keep up — drop the backlog rather than spiral

    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
