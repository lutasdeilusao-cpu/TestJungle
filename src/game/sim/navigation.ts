import type { Obstacle } from '../arena/arenaMap';
import { obstacleDistance } from './geometry';

const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Grid-based navigation for the enemies.
 *
 * - `blocked` marks cells whose centre is too close to an obstacle for a hull.
 * - `buildFlowField` runs a Dijkstra search from the player's cell; each enemy
 *   then steers towards its cheapest neighbour, which routes them around islands.
 * - `hasLineOfSight` walks the grid between two points; with a clear line the
 *   enemy steers straight at the player instead of following cell centres.
 */
export class NavigationGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly blocked: Uint8Array;
  private readonly cost: Float32Array;
  private readonly queue: Int32Array;
  private targetCell = -1;

  constructor(
    readonly width: number,
    readonly height: number,
    obstacles: readonly Obstacle[],
    readonly cellSize = 32,
    clearance = 22,
  ) {
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n);
    this.cost = new Float32Array(n).fill(Infinity);
    this.queue = new Int32Array(n * 8);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = (c + 0.5) * cellSize;
        const y = (r + 0.5) * cellSize;
        if (obstacles.some((o) => obstacleDistance(x, y, o).d < clearance)) this.blocked[r * this.cols + c] = 1;
      }
    }
  }

  cellOf(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize)));
    return r * this.cols + c;
  }

  isBlockedAt(x: number, y: number): boolean {
    return this.blocked[this.cellOf(x, y)] === 1;
  }

  /** Recomputes path costs towards (x, y). Cheap enough to run several times per second. */
  buildFlowField(x: number, y: number): void {
    const target = this.cellOf(x, y);
    if (target === this.targetCell) return;
    this.targetCell = target;
    const { cols, rows, cost, blocked, queue } = this;
    cost.fill(Infinity);
    cost[target] = 0;
    // Bucket-free Dijkstra approximation: a FIFO with re-insertion on improvement.
    // With uniform grid weights this converges quickly and stays allocation-free.
    let head = 0;
    let tail = 0;
    queue[tail++] = target;
    while (head < tail) {
      const cell = queue[head++]!;
      const cc = cell % cols;
      const cr = (cell - cc) / cols;
      const base = cost[cell]!;
      for (const [dc, dr, w] of NEIGHBOURS) {
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const next = nr * cols + nc;
        if (blocked[next]) continue;
        // No diagonal corner cutting.
        if (dc !== 0 && dr !== 0 && (blocked[cr * cols + nc] || blocked[nr * cols + cc])) continue;
        const nextCost = base + w;
        if (nextCost < cost[next]!) {
          cost[next] = nextCost;
          if (tail < queue.length) queue[tail++] = next;
        }
      }
    }
  }

  /**
   * Direction (radians) towards the cheapest neighbouring cell, or null when the
   * cell has no route (e.g. the ship was pushed into a blocked cell).
   */
  flowDirection(x: number, y: number): number | null {
    const { cols, rows, cost } = this;
    const cell = this.cellOf(x, y);
    const cc = cell % cols;
    const cr = (cell - cc) / cols;
    let best = cost[cell]!;
    let bestCell = -1;
    for (const [dc, dr] of NEIGHBOURS) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const next = nr * cols + nc;
      if (cost[next]! < best) {
        best = cost[next]!;
        bestCell = next;
      }
    }
    if (bestCell < 0) return null;
    const tx = ((bestCell % cols) + 0.5) * this.cellSize;
    const ty = (Math.floor(bestCell / cols) + 0.5) * this.cellSize;
    return Math.atan2(ty - y, tx - x);
  }

  hasLineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const steps = Math.ceil(Math.hypot(dx, dy) / (this.cellSize * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isBlockedAt(ax + dx * t, ay + dy * t)) return false;
    }
    return true;
  }
}
