/**
 * Small deterministic PRNG (mulberry32). Every random decision of the
 * simulation goes through an instance seeded from the match config, so a
 * given seed + input sequence always reproduces the same match.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) throw new Error('Rng.pick on empty list');
    return item;
  }

  /** Picks a key according to non-negative weights. */
  weighted<K extends string>(weights: Record<K, number>): K {
    const entries = Object.entries(weights) as [K, number][];
    const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
    let roll = this.next() * total;
    for (const [key, w] of entries) {
      roll -= Math.max(0, w);
      if (roll < 0) return key;
    }
    const last = entries[entries.length - 1];
    if (!last) throw new Error('Rng.weighted on empty weights');
    return last[0];
  }
}
