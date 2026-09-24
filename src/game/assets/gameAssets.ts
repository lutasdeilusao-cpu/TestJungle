import { Assets, type Spritesheet, type Texture } from 'pixi.js';

export interface GameTextures {
  ships: Spritesheet;
  tiles: Spritesheet;
  ui: Spritesheet;
  resolution: 1 | 2;
}

const BASE = `${import.meta.env.BASE_URL}assets/atlas/`;

function manifest(resolution: 1 | 2) {
  const suffix = resolution === 2 ? '@2x' : '';
  return {
    ships: `${BASE}ships.json`,
    tiles: `${BASE}tiles${suffix}.json`,
    ui: `${BASE}ui${suffix}.json`,
  } as const;
}

let loaded: Promise<GameTextures> | null = null;
let loadedResolution: 1 | 2 | null = null;

/**
 * Loads the three texture atlases once and shares them between matches.
 *
 * - The promise is cached, so restarting a match or remounting the game screen
 *   (React Strict Mode) never loads or uploads textures twice.
 * - A failure clears the cache: the caller shows the error and a retry simply
 *   calls this function again (Pixi's loader also drops failed entries).
 * - Retina atlases are used when the effective scale of the arena on screen
 *   (CSS scale x device pixel ratio) is large enough to benefit from them.
 */
export function loadGameTextures(resolution: 1 | 2, onProgress?: (progress: number) => void): Promise<GameTextures> {
  if (loaded && loadedResolution === resolution) {
    onProgress?.(1);
    return loaded;
  }
  const urls = manifest(resolution);
  loadedResolution = resolution;
  loaded = Assets.load<Spritesheet>([urls.ships, urls.tiles, urls.ui], (p) => onProgress?.(p))
    .then((result): GameTextures => {
      const get = (url: string) => {
        const sheet = result[url];
        if (!sheet?.textures) throw new Error(`Atlas ${url} did not load as a spritesheet`);
        return sheet;
      };
      return { ships: get(urls.ships), tiles: get(urls.tiles), ui: get(urls.ui), resolution };
    })
    .catch((error: unknown) => {
      loaded = null;
      loadedResolution = null;
      throw error instanceof Error ? error : new Error(String(error));
    });
  return loaded;
}

export function frame(sheet: Spritesheet, name: string): Texture {
  const texture = sheet.textures[name];
  if (!texture) throw new Error(`Missing frame "${name}"`);
  return texture;
}

/** Picks the atlas resolution for the current screen. */
export function preferredResolution(viewportWidth: number, viewportHeight: number, arenaWidth: number, arenaHeight: number): 1 | 2 {
  const cssScale = Math.min(viewportWidth / arenaWidth, viewportHeight / arenaHeight);
  return cssScale * Math.min(window.devicePixelRatio || 1, 2) > 1.25 ? 2 : 1;
}
