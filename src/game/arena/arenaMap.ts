/**
 * Static arena layout, shared by the simulation (colliders) and the renderer
 * (tiles and decorations). Everything is expressed in the 64px tile grid of the
 * provided tile sheet and converted to world pixels here.
 */

export const TILE = 64;

export type IslandStyle = 'sand' | 'grass';

export interface IslandDef {
  id: string;
  style: IslandStyle;
  /** Tile coordinates of the top-left tile. */
  col: number;
  row: number;
  /** Size in tiles (sand >= 2x2, grass >= 4x4 and even). */
  cols: number;
  rows: number;
  decorations?: DecorationDef[];
}

export interface DecorationDef {
  /** Frame name from the tile atlas (palms, bushes, grass tufts). */
  frame: string;
  /** Offset in pixels from the island's top-left corner. */
  x: number;
  y: number;
  scale?: number;
  rotation?: number;
}

export interface RockDef {
  id: string;
  frame: string;
  x: number;
  y: number;
  radius: number;
  scale?: number;
}

/** Axis-aligned rectangle with rounded corners, in world pixels. */
export interface RoundedRect {
  kind: 'rect';
  id: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  radius: number;
}

export interface CircleObstacle {
  kind: 'circle';
  id: string;
  x: number;
  y: number;
  radius: number;
}

export type Obstacle = RoundedRect | CircleObstacle;

export const ISLANDS: readonly IslandDef[] = [
  {
    id: 'fort-island',
    style: 'grass',
    col: 4,
    row: 1,
    cols: 4,
    rows: 4,
    decorations: [
      { frame: 'tile_71', x: 70, y: 90, scale: 0.9 },
      { frame: 'tile_72', x: 170, y: 150, scale: 0.8, rotation: 0.6 },
      { frame: 'tile_70', x: 110, y: 170, scale: 0.8 },
    ],
  },
  {
    id: 'sand-bar',
    style: 'sand',
    col: 15,
    row: 1,
    cols: 3,
    rows: 3,
    decorations: [{ frame: 'tile_88', x: 70, y: 70 }],
  },
  {
    id: 'palm-island',
    style: 'grass',
    col: 13,
    row: 8,
    cols: 6,
    rows: 4,
    decorations: [
      { frame: 'tile_71', x: 90, y: 80 },
      { frame: 'tile_72', x: 250, y: 120, scale: 0.9, rotation: 1.1 },
      { frame: 'tile_70', x: 180, y: 160, scale: 0.8, rotation: -0.4 },
      { frame: 'tile_87', x: 300, y: 70 },
    ],
  },
  {
    id: 'south-cay',
    style: 'sand',
    col: 3,
    row: 10,
    cols: 3,
    rows: 2,
    decorations: [{ frame: 'tile_87', x: 60, y: 30 }],
  },
];

export const ROCKS: readonly RockDef[] = [
  { id: 'rock-1', frame: 'tile_66', x: 700, y: 610, radius: 24 },
  { id: 'rock-2', frame: 'tile_49', x: 1400, y: 380, radius: 18 },
  { id: 'rock-3', frame: 'tile_67', x: 1470, y: 790, radius: 18, scale: 0.9 },
];

/**
 * Tile frames are 64px but the drawn island edge sits a few pixels inside the
 * outer tiles; the collider is inset accordingly and rounded like the art.
 */
const ISLAND_INSET = 12;
const ISLAND_CORNER_RADIUS = 44;

export function islandBounds(island: IslandDef): RoundedRect {
  return {
    kind: 'rect',
    id: island.id,
    minX: island.col * TILE + ISLAND_INSET,
    minY: island.row * TILE + ISLAND_INSET,
    maxX: (island.col + island.cols) * TILE - ISLAND_INSET,
    maxY: (island.row + island.rows) * TILE - ISLAND_INSET,
    radius: ISLAND_CORNER_RADIUS,
  };
}

export const OBSTACLES: readonly Obstacle[] = [
  ...ISLANDS.map(islandBounds),
  ...ROCKS.map((r): CircleObstacle => ({ kind: 'circle', id: r.id, x: r.x, y: r.y, radius: r.radius })),
];

/** Where the player starts, facing east (heading 0). */
export const PLAYER_START = { x: 330, y: 460, heading: 0 } as const;

/**
 * Candidate spawn points. At spawn time the spawner keeps only the ones that
 * are free of obstacles and far enough from the player, then picks one with
 * the seeded RNG. They sit close to the arena border so enemies "sail in".
 */
export const SPAWN_POINTS: readonly { x: number; y: number }[] = [
  { x: 80, y: 80 },
  { x: 620, y: 70 },
  { x: 900, y: 60 },
  { x: 1300, y: 70 },
  { x: 1530, y: 90 },
  { x: 1540, y: 300 },
  { x: 1540, y: 560 },
  { x: 1530, y: 830 },
  { x: 1300, y: 850 },
  { x: 700, y: 850 },
  { x: 420, y: 850 },
  { x: 70, y: 840 },
  { x: 60, y: 460 },
  { x: 900, y: 420 },
];
