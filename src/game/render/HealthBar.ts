import { Container, Rectangle, Sprite, Texture } from 'pixi.js';

export interface HealthBarSkin {
  frame: Texture;
  /** Fills picked by remaining ratio, highest threshold first. */
  fills: { minRatio: number; texture: Texture }[];
  /** Fill area inside the frame texture (logical px, from the atlas `ui.layout.fill_rect`). */
  fillRect: { x: number; w: number };
}

const STEPS = 40;

/**
 * Health bar drawn from the atlas frame/fill pair. The fill is clipped along x
 * by swapping in a sub-texture of the fill (no masks, so batching is kept);
 * sub-textures are cached per quantised width and shared by all bars.
 */
export class HealthBar {
  readonly container = new Container({ label: 'health-bar' });
  private readonly fill: Sprite;
  private ratio = -1;
  private static readonly clipCache = new Map<Texture, Texture[]>();

  constructor(
    private readonly skin: HealthBarSkin,
    scale: number,
  ) {
    const back = new Sprite({ texture: skin.frame, anchor: { x: 0.5, y: 0.5 } });
    this.fill = new Sprite({ texture: Texture.EMPTY });
    this.fill.position.set(-skin.frame.width / 2, -skin.frame.height / 2);
    this.container.addChild(back, this.fill);
    this.container.scale.set(scale);
  }

  set(ratio: number): void {
    const step = Math.max(0, Math.min(STEPS, Math.ceil(ratio * STEPS)));
    const quantised = step / STEPS;
    if (quantised === this.ratio) return;
    this.ratio = quantised;
    const source = (this.skin.fills.find((f) => quantised >= f.minRatio) ?? this.skin.fills[this.skin.fills.length - 1])!.texture;
    this.fill.texture = step === 0 ? Texture.EMPTY : HealthBar.clipped(source, step, this.skin.fillRect);
  }

  private static clipped(source: Texture, step: number, rect: { x: number; w: number }): Texture {
    let cache = HealthBar.clipCache.get(source);
    if (!cache) {
      cache = [];
      HealthBar.clipCache.set(source, cache);
    }
    let texture = cache[step];
    if (!texture) {
      const full = step === STEPS;
      const width = full ? source.frame.width : rect.x + (rect.w * step) / STEPS;
      texture = new Texture({
        source: source.source,
        frame: new Rectangle(source.frame.x, source.frame.y, width, source.frame.height),
      });
      cache[step] = texture;
    }
    return texture;
  }

  /** Releases cached sub-textures (their source belongs to the shared atlas). */
  static clearCache(): void {
    for (const list of HealthBar.clipCache.values()) list.forEach((t) => t?.destroy(false));
    HealthBar.clipCache.clear();
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
