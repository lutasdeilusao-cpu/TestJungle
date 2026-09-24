import type { Obstacle, RoundedRect } from '../arena/arenaMap';
import { clamp } from '../core/math';

export interface Penetration {
  /** Push-out direction (unit vector). */
  nx: number;
  ny: number;
  /** Overlap depth in px (> 0 means overlapping). */
  depth: number;
}

/**
 * Signed distance from a point to a rounded rectangle (negative inside),
 * plus the outward normal at the closest point.
 */
export function roundedRectDistance(px: number, py: number, r: RoundedRect): { d: number; nx: number; ny: number } {
  // A rounded rect is an inner rect grown by `radius`.
  const ix0 = r.minX + r.radius;
  const iy0 = r.minY + r.radius;
  const ix1 = r.maxX - r.radius;
  const iy1 = r.maxY - r.radius;
  const cx = clamp(px, ix0, ix1);
  const cy = clamp(py, iy0, iy1);
  const dx = px - cx;
  const dy = py - cy;
  const len = Math.hypot(dx, dy);
  if (len > 1e-6) {
    return { d: len - r.radius, nx: dx / len, ny: dy / len };
  }
  // Inside the inner rect: exit through the nearest side.
  const toLeft = px - ix0;
  const toRight = ix1 - px;
  const toTop = py - iy0;
  const toBottom = iy1 - py;
  const m = Math.min(toLeft, toRight, toTop, toBottom);
  if (m === toLeft) return { d: -toLeft - r.radius, nx: -1, ny: 0 };
  if (m === toRight) return { d: -toRight - r.radius, nx: 1, ny: 0 };
  if (m === toTop) return { d: -toTop - r.radius, nx: 0, ny: -1 };
  return { d: -toBottom - r.radius, nx: 0, ny: 1 };
}

/** Distance from a point to an obstacle surface (negative inside) with outward normal. */
export function obstacleDistance(px: number, py: number, o: Obstacle): { d: number; nx: number; ny: number } {
  if (o.kind === 'rect') return roundedRectDistance(px, py, o);
  const dx = px - o.x;
  const dy = py - o.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { d: -o.radius, nx: 1, ny: 0 };
  return { d: len - o.radius, nx: dx / len, ny: dy / len };
}

/** Penetration of a circle into an obstacle, or null when they do not touch. */
export function circleVsObstacle(x: number, y: number, radius: number, o: Obstacle): Penetration | null {
  const { d, nx, ny } = obstacleDistance(x, y, o);
  const depth = radius - d;
  return depth > 0 ? { nx, ny, depth } : null;
}

export function pointInsideObstacle(x: number, y: number, o: Obstacle, margin = 0): boolean {
  return obstacleDistance(x, y, o).d < margin;
}
