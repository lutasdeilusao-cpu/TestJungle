import { Container, Graphics, Sprite, TilingSprite, type Spritesheet } from 'pixi.js';
import { ISLANDS, OBSTACLES, ROCKS, TILE, type IslandDef } from '../arena/arenaMap';
import { frame } from '../assets/gameAssets';

/** 9-slice tile ids for a sand island (corners, edges, centre variants). */
const SAND = { tl: 1, t: 2, tr: 3, l: 17, c: [18], r: 19, bl: 33, b: 34, br: 35 };
/** The grass island is a 4x4 block; inner rows/columns repeat in pairs. */
const GRASS = [
  [6, 7, 8, 9],
  [22, 23, 24, 25],
  [38, 39, 40, 41],
  [54, 55, 56, 57],
];
/** Shallow-water halo drawn around every island. */
const SHALLOW = { tl: 10, t: 11, tr: 12, l: 26, c: 27, r: 28, bl: 42, b: 43, br: 44 };

function nineSlice(col: number, row: number, cols: number, rows: number, ids: typeof SHALLOW | typeof SAND): number {
  const top = row === 0;
  const bottom = row === rows - 1;
  const left = col === 0;
  const right = col === cols - 1;
  if (top) return left ? ids.tl : right ? ids.tr : ids.t;
  if (bottom) return left ? ids.bl : right ? ids.br : ids.b;
  if (left) return ids.l;
  if (right) return ids.r;
  const c = ids.c;
  return Array.isArray(c) ? (c[(col * 7 + row * 3) % c.length] ?? 18) : c;
}

function grassTile(col: number, row: number, cols: number, rows: number): number {
  // Map any size onto the 4x4 block: edges stay edges, inner cells alternate.
  const pick = (i: number, n: number) => (i === 0 ? 0 : i === n - 1 ? 3 : 1 + ((i - 1) % 2));
  return GRASS[pick(row, rows)]![pick(col, cols)]!;
}

/**
 * Static arena: animated water plus islands, rocks and decorations. The island
 * layer never changes during a match, so it is rendered once and cached as a
 * single texture (`cacheAsTexture`), which keeps the per-frame cost at a few
 * sprites regardless of the number of tiles.
 */
export class ArenaView {
  readonly container = new Container({ label: 'arena' });
  private readonly waterBase: TilingSprite;
  private readonly waterShimmer: TilingSprite;
  private readonly statics = new Container({ label: 'arena-static' });
  private time = 0;

  constructor(tiles: Spritesheet, width: number, height: number, debugColliders = false) {
    const water = frame(tiles, 'tile_73');
    this.waterBase = new TilingSprite({ texture: water, width, height });
    this.waterShimmer = new TilingSprite({ texture: water, width, height, alpha: 0.28 });
    this.waterShimmer.tileScale.set(1.35);
    this.container.addChild(this.waterBase, this.waterShimmer, this.statics);

    for (const island of ISLANDS) this.buildShallow(tiles, island);
    for (const island of ISLANDS) this.buildIsland(tiles, island);
    for (const rock of ROCKS) {
      const sprite = new Sprite({ texture: frame(tiles, rock.frame), anchor: 0.5, x: rock.x, y: rock.y });
      sprite.scale.set(rock.scale ?? 1);
      this.statics.addChild(sprite);
    }
    if (debugColliders) this.statics.addChild(this.buildColliderDebug());
    this.statics.cacheAsTexture({ antialias: true });
  }

  private buildShallow(tiles: Spritesheet, island: IslandDef): void {
    const cols = island.cols + 2;
    const rows = island.rows + 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = nineSlice(c, r, cols, rows, SHALLOW);
        this.statics.addChild(
          new Sprite({
            texture: frame(tiles, `tile_${id}`),
            x: (island.col - 1 + c) * TILE,
            y: (island.row - 1 + r) * TILE,
            width: TILE,
            height: TILE,
            alpha: 0.9,
          }),
        );
      }
    }
  }

  private buildIsland(tiles: Spritesheet, island: IslandDef): void {
    for (let r = 0; r < island.rows; r++) {
      for (let c = 0; c < island.cols; c++) {
        const id =
          island.style === 'grass' ? grassTile(c, r, island.cols, island.rows) : nineSlice(c, r, island.cols, island.rows, SAND);
        this.statics.addChild(
          new Sprite({
            texture: frame(tiles, `tile_${id}`),
            x: (island.col + c) * TILE,
            y: (island.row + r) * TILE,
            width: TILE,
            height: TILE,
          }),
        );
      }
    }
    for (const deco of island.decorations ?? []) {
      const sprite = new Sprite({
        texture: frame(tiles, deco.frame),
        anchor: 0.5,
        x: island.col * TILE + deco.x,
        y: island.row * TILE + deco.y,
        rotation: deco.rotation ?? 0,
      });
      sprite.scale.set(deco.scale ?? 1);
      this.statics.addChild(sprite);
    }
  }

  private buildColliderDebug(): Graphics {
    const g = new Graphics();
    for (const o of OBSTACLES) {
      if (o.kind === 'rect') g.roundRect(o.minX, o.minY, o.maxX - o.minX, o.maxY - o.minY, o.radius);
      else g.circle(o.x, o.y, o.radius);
    }
    return g.stroke({ width: 2, color: 0xff00ff, alpha: 0.9 });
  }

  /** Slow drift of the water layers; `dt` is presentation time (0 while paused). */
  update(dt: number): void {
    this.time += dt;
    this.waterBase.tilePosition.set(this.time * 6, this.time * 3);
    this.waterShimmer.tilePosition.set(-this.time * 9, this.time * 5);
  }

  destroy(): void {
    this.statics.cacheAsTexture(false);
    // Textures belong to the shared atlases and are reused by the next match.
    this.container.destroy({ children: true, context: true, texture: false, textureSource: false });
  }
}
