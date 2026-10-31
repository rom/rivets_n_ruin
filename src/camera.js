import { VIEW_W, LEVEL_LEN, CAM, clamp, smooth } from './config.js';

export const makeCamera = () => ({ x: 0, shake: 0 });

export function updateCamera(cam, player, dt) {
  // Lead the ship by its facing: reversing slides the whole world across,
  // which is what makes a bidirectional scroller feel like one.
  const want = clamp(
    player.x - VIEW_W / 2 + player.facing * CAM.lead,
    0, LEVEL_LEN - VIEW_W,
  );
  cam.x += (want - cam.x) * smooth(CAM.lerp, dt);
  cam.x = clamp(cam.x, 0, LEVEL_LEN - VIEW_W);
  if (cam.shake > 0) cam.shake = Math.max(0, cam.shake - dt * 42);
}

export const kick = (cam, amount) => { cam.shake = Math.min(14, cam.shake + amount); };
