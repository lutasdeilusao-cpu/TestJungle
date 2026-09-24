import { Container, Sprite, type Texture } from 'pixi.js';
import type { Rng } from '../core/rng';

export interface ParticleSpec {
  texture: Texture;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  /** Velocity damping per second (0 = none, 1 = strong). */
  damping?: number;
  life: number;
  delay?: number;
  scaleFrom?: number;
  scaleTo?: number;
  alphaFrom?: number;
  alphaTo?: number;
  rotation?: number;
  spin?: number;
  tint?: number;
}

interface Particle extends Required<Omit<ParticleSpec, 'texture'>> {
  sprite: Sprite;
  age: number;
}

/**
 * Short-lived visual effects (muzzle flashes, smoke, splashes, debris,
 * explosions, wrecks). Sprites are pooled: after warm-up an effect never
 * allocates a display object, which keeps GC pauses out of combat.
 */
export class EffectsLayer {
  readonly container = new Container({ label: 'effects' });
  private readonly active: Particle[] = [];
  private readonly pool: Sprite[] = [];

  get count(): number {
    return this.active.length;
  }

  spawn(spec: ParticleSpec): void {
    const sprite = this.pool.pop() ?? new Sprite({ anchor: 0.5 });
    sprite.texture = spec.texture;
    sprite.visible = false;
    this.container.addChild(sprite);
    this.active.push({
      sprite,
      x: spec.x,
      y: spec.y,
      vx: spec.vx ?? 0,
      vy: spec.vy ?? 0,
      damping: spec.damping ?? 0,
      life: spec.life,
      delay: spec.delay ?? 0,
      scaleFrom: spec.scaleFrom ?? 1,
      scaleTo: spec.scaleTo ?? spec.scaleFrom ?? 1,
      alphaFrom: spec.alphaFrom ?? 1,
      alphaTo: spec.alphaTo ?? 0,
      rotation: spec.rotation ?? 0,
      spin: spec.spin ?? 0,
      tint: spec.tint ?? 0xffffff,
      age: 0,
    });
  }

  /** Radial burst helper. */
  burst(rng: Rng, textures: readonly Texture[], x: number, y: number, n: number, speed: number, base: Partial<ParticleSpec>): void {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const s = speed * rng.range(0.4, 1);
      this.spawn({
        texture: rng.pick(textures),
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        rotation: rng.range(0, Math.PI * 2),
        spin: rng.range(-6, 6),
        life: 0.6,
        ...base,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i]!;
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        this.release(i);
        continue;
      }
      const damp = Math.max(0, 1 - p.damping * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
      const s = p.sprite;
      s.visible = true;
      s.position.set(p.x, p.y);
      s.rotation = p.rotation;
      s.scale.set(p.scaleFrom + (p.scaleTo - p.scaleFrom) * t);
      s.alpha = p.alphaFrom + (p.alphaTo - p.alphaFrom) * t;
      s.tint = p.tint;
    }
  }

  private release(index: number): void {
    const p = this.active[index]!;
    this.active[index] = this.active[this.active.length - 1]!;
    this.active.pop();
    p.sprite.removeFromParent();
    this.pool.push(p.sprite);
  }

  destroy(): void {
    for (const p of this.active) p.sprite.destroy();
    for (const s of this.pool) s.destroy();
    this.active.length = 0;
    this.pool.length = 0;
    this.container.destroy({ children: true });
  }
}
