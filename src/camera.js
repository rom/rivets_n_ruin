import { VIEW_W, CAM, clamp, smooth } from './config.js';

export const makeCamera = () => ({ x: 0, shake: 0 });

export function updateCamera(cam, player, levelLen, dt, lockX = null) {
  if (lockX !== null) {
    // Boss arena: pin the view so the fight is one room, not a scroll.
    cam.x += (lockX - cam.x) * smooth(CAM.lerp * 1.4, dt);
    if (cam.shake > 0) cam.shake = Math.max(0, cam.shake - dt * 42);
    return;
  }
  // Lead the ship by its facing: reversing slides the whole world across,
  // which is what makes a bidirectional scroller feel like one.
  const want = clamp(
    player.x - VIEW_W / 2 + player.facing * CAM.lead,
    0, levelLen - VIEW_W,
  );
  cam.x += (want - cam.x) * smooth(CAM.lerp, dt);
  cam.x = clamp(cam.x, 0, levelLen - VIEW_W);
  if (cam.shake > 0) cam.shake = Math.max(0, cam.shake - dt * 42);
}

export const kick = (cam, amount) => { cam.shake = Math.min(14, cam.shake + amount); };
