import { VIEW_W, CAM, clamp, smooth } from './config.js';

export const makeCamera = () => ({ x: 0, shake: 0 });

// Wind the screen shake down.
//
// Its own function because the shake is the ONLY thing that moves the
// view vertically — see drawWorld, where camY is nothing but this —
// and it used to be decayed inside updateCamera and nowhere else. Co-op
// places the camera itself and so never called updateCamera, which
// left the shake at whatever the last hit set it to, for ever: both
// players reported the picture juddering up and down and nothing else
// being readable.
//
// Any code that positions the camera has to call this. There is no
// path that should not.
export function decayShake(cam, dt) {
  if (cam.shake > 0) cam.shake = Math.max(0, cam.shake - dt * 42);
}

export function updateCamera(cam, player, levelLen, dt, lockX = null) {
  if (lockX !== null) {
    // Boss arena: pin the view so the fight is one room, not a scroll.
    cam.x += (lockX - cam.x) * smooth(CAM.lerp * 1.4, dt);
    decayShake(cam, dt);
    return;
  }
  // Lead the ship by its facing: reversing slides the whole world across,
  // which is what makes a bidirectional scroller feel like one.
  const want = clamp(
    player.x - VIEW_W / 2 + player.facing * CAM.lead,
    0, Math.max(0, levelLen - VIEW_W),
  );
  cam.x += (want - cam.x) * smooth(CAM.lerp, dt);
  // Backstop. Nothing downstream can recover from a NaN camera, and the cost
  // of checking is a comparison per frame.
  if (!Number.isFinite(cam.x)) cam.x = clamp(want, 0, Math.max(0, levelLen - VIEW_W));
  cam.x = clamp(cam.x, 0, levelLen - VIEW_W);
  decayShake(cam, dt);
}

export const kick = (cam, amount) => { cam.shake = Math.min(14, cam.shake + amount); };
