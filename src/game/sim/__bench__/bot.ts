import { angleDelta } from '../../core/math';
import type { Simulation } from '../Simulation';
import { idleControls, type ShipControls } from '../types';

/** Simple heuristic player used to evaluate balancing (not part of the game). */
export function botControls(sim: Simulation, skill = 1): ShipControls {
  const c = idleControls();
  const p = sim.player;
  let best: (typeof sim.enemies)[number] | null = null;
  let bestD = Infinity;
  for (const e of sim.enemies) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  c.thrust = true;
  if (!best) {
    const toCenter = Math.atan2(450 - p.y, 800 - p.x);
    const d = angleDelta(p.heading, toCenter);
    c.turnLeft = d < -0.1; c.turnRight = d > 0.1;
    return c;
  }
  const dir = Math.atan2(best.y - p.y, best.x - p.x);
  const delta = angleDelta(p.heading, dir);
  c.turnLeft = delta < -0.08; c.turnRight = delta > 0.08;
  if (Math.abs(delta) < 0.12 * skill && bestD < 480) c.fireFront = true;
  if (bestD < 330) {
    if (Math.abs(delta + Math.PI / 2) < 0.25 * skill) c.fireLeft = true;
    if (Math.abs(delta - Math.PI / 2) < 0.25 * skill) c.fireRight = true;
  }
  // back off chasers a bit
  if (best.kind === 'chaser' && bestD < 90) c.thrust = false;
  return c;
}
