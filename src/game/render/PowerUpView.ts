import { Container, Sprite, type Texture } from 'pixi.js';
import type { PowerUpKind } from '../config';
import type { PowerUp } from '../sim/types';

export interface PowerUpTextures {
  badge: Texture;
  icons: Record<PowerUpKind, Texture>;
}

/** Badge tint per kind, so the four power-ups read apart at a glance. */
export const POWER_UP_TINT: Record<PowerUpKind, number> = {
  damage: 0xffb36b,
  fireRate: 0x9fd8ff,
  spread: 0xffe27a,
  repair: 0x9ff0a8,
};

/**
 * A floating power-up: brass badge with the kind's icon, bobbing on the water
 * and blinking during its last two seconds.
 */
export class PowerUpView {
  readonly container = new Container({ label: 'power-up' });
  private readonly badge: Sprite;
  private time: number;

  constructor(
    readonly powerUp: PowerUp,
    textures: PowerUpTextures,
  ) {
    this.time = powerUp.id * 0.7;
    this.badge = new Sprite({ texture: textures.badge, anchor: 0.5, tint: POWER_UP_TINT[powerUp.kind] });
    this.badge.scale.set(0.72);
    const icon = new Sprite({ texture: textures.icons[powerUp.kind], anchor: 0.5 });
    const size = Math.max(icon.texture.width, icon.texture.height);
    icon.scale.set(26 / size);
    this.container.addChild(this.badge, icon);
    this.container.position.set(powerUp.x, powerUp.y);
    this.update(0);
  }

  update(dt: number): void {
    this.time += dt;
    const p = this.powerUp;
    const bob = Math.sin(this.time * 3.2) * 3;
    this.container.position.set(p.x, p.y + bob);
    this.container.rotation = Math.sin(this.time * 1.7) * 0.12;
    const pulse = 1 + Math.sin(this.time * 5) * 0.05;
    this.container.scale.set(pulse);
    this.container.alpha = p.ttl < 2 ? (Math.sin(this.time * 18) > 0 ? 1 : 0.35) : 1;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
