import { Container, Sprite, type Texture } from 'pixi.js';
import { lerp, lerpAngle } from '../core/math';
import type { Ship } from '../sim/types';
import { HealthBar, type HealthBarSkin } from './HealthBar';

/**
 * Sprite sheet order: ship_{style + 6 * stage}, where style is the sail colour
 * (1 white, 2 black, 3 red, 4 green, 5 blue, 6 yellow) and stage 3 is the wreck.
 */
export function shipFrame(style: number, stage: 0 | 1 | 2 | 3): string {
  return `ship_${style + 6 * stage}`;
}

export function damageStage(hpRatio: number): 0 | 1 | 2 {
  return hpRatio > 0.66 ? 0 : hpRatio > 0.33 ? 1 : 2;
}

export interface ShipViewTextures {
  stages: [Texture, Texture, Texture, Texture];
  fire: [Texture, Texture];
  bar: HealthBarSkin;
}

/** Sprite heading offset: the art points its bow down (+y), headings are 0 = east. */
const SPRITE_ROTATION = -Math.PI / 2;
const FLASH_TIME = 0.14;

/**
 * Visual counterpart of a simulation ship. It never mutates game state: every
 * frame it reads the ship's current and previous pose and interpolates.
 */
export class ShipView {
  readonly body = new Container({ label: 'ship' });
  readonly bar: HealthBar;
  private readonly hull: Sprite;
  private readonly fires: Sprite[];
  private stage = -1;
  private flash = 0;
  private time: number;

  constructor(
    readonly ship: Ship,
    private readonly textures: ShipViewTextures,
    barScale: number,
  ) {
    this.time = ship.id * 1.7;
    this.hull = new Sprite({ texture: textures.stages[0], anchor: 0.5 });
    this.hull.scale.set(ship.hull.scale);
    this.body.addChild(this.hull);
    this.fires = [
      new Sprite({ texture: textures.fire[0], anchor: { x: 0.5, y: 0.9 }, x: 6, y: -8, visible: false }),
      new Sprite({ texture: textures.fire[1], anchor: { x: 0.5, y: 0.9 }, x: -8, y: 14, visible: false }),
    ];
    for (const fire of this.fires) {
      fire.scale.set(ship.hull.scale);
      this.body.addChild(fire);
    }
    this.bar = new HealthBar(textures.bar, barScale);
    this.update(1, 0);
  }

  hit(): void {
    this.flash = FLASH_TIME;
  }

  /** @param alpha interpolation factor between the previous and current step. */
  update(alpha: number, dt: number): void {
    const s = this.ship;
    this.time += dt;
    const x = lerp(s.prevX, s.x, alpha);
    const y = lerp(s.prevY, s.y, alpha);
    this.body.position.set(x, y);
    this.body.rotation = lerpAngle(s.prevHeading, s.heading, alpha) + SPRITE_ROTATION;

    const ratio = s.hp / s.maxHp;
    const stage = damageStage(ratio);
    if (stage !== this.stage) {
      this.stage = stage;
      this.hull.texture = this.textures.stages[stage];
      this.fires[0]!.visible = stage >= 1;
      this.fires[1]!.visible = stage >= 2;
    }
    for (let i = 0; i < this.fires.length; i++) {
      const fire = this.fires[i]!;
      if (!fire.visible) continue;
      const flicker = 1 + Math.sin(this.time * (14 + i * 5)) * 0.12;
      fire.scale.set(s.hull.scale * flicker, s.hull.scale * (2 - flicker));
    }

    this.flash = Math.max(0, this.flash - dt);
    this.hull.tint = this.flash > 0 ? 0xff9a8a : s.tint;
    // Enemies fade in right after spawning; the player is visible from the start.
    this.body.alpha = s.kind === 'player' ? 1 : Math.min(1, s.age / 0.5);

    this.bar.set(ratio);
    this.bar.container.position.set(x, y - s.hull.halfLength - 26);
    this.bar.container.alpha = this.body.alpha;
  }

  destroy(): void {
    this.body.destroy({ children: true });
    this.bar.destroy();
  }
}
