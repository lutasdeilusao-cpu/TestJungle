import type { RenderStats } from '../render/GameRenderer';

const CAPACITY = 60 * 60 * 5; // five minutes at 60 FPS

export interface FrameReport {
  frames: number;
  durationMs: number;
  avgFps: number;
  p50FrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  /** Frames longer than 1.5x a 60 Hz frame. */
  slowFrames: number;
  maxShips: number;
  maxProjectiles: number;
  maxParticles: number;
  avgShips: number;
  avgProjectiles: number;
}

/**
 * Allocation-free frame time recorder used by the profiling script
 * (window.__PIRATE__.perf()). Records the raw ticker delta of every frame and
 * the entity counts at that frame.
 */
export class FrameStats {
  private readonly deltas = new Float32Array(CAPACITY);
  private readonly ships = new Uint16Array(CAPACITY);
  private readonly projectiles = new Uint16Array(CAPACITY);
  private readonly particles = new Uint16Array(CAPACITY);
  private count = 0;

  record(deltaMs: number, stats: RenderStats | undefined): void {
    if (this.count >= CAPACITY) return;
    const i = this.count++;
    this.deltas[i] = deltaMs;
    this.ships[i] = stats?.ships ?? 0;
    this.projectiles[i] = stats?.projectiles ?? 0;
    this.particles[i] = stats?.particles ?? 0;
  }

  reset(): void {
    this.count = 0;
  }

  report(): FrameReport {
    const n = this.count;
    // Skip the very first frame (includes setup time).
    const deltas = Array.from(this.deltas.subarray(1, n)).sort((a, b) => a - b);
    const pct = (p: number) => deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * p))] ?? 0;
    const total = deltas.reduce((a, b) => a + b, 0);
    const sum = (arr: Uint16Array) => arr.subarray(0, n).reduce((a, b) => a + b, 0);
    const max = (arr: Uint16Array) => arr.subarray(0, n).reduce((a, b) => Math.max(a, b), 0);
    return {
      frames: deltas.length,
      durationMs: Math.round(total),
      avgFps: total > 0 ? +((deltas.length * 1000) / total).toFixed(1) : 0,
      p50FrameMs: +pct(0.5).toFixed(2),
      p95FrameMs: +pct(0.95).toFixed(2),
      p99FrameMs: +pct(0.99).toFixed(2),
      maxFrameMs: +(deltas[deltas.length - 1] ?? 0).toFixed(2),
      slowFrames: deltas.filter((d) => d > 25).length,
      maxShips: max(this.ships),
      maxProjectiles: max(this.projectiles),
      maxParticles: max(this.particles),
      avgShips: n ? +(sum(this.ships) / n).toFixed(1) : 0,
      avgProjectiles: n ? +(sum(this.projectiles) / n).toFixed(1) : 0,
    };
  }
}
