#!/usr/bin/env node
/**
 * Converts the raw challenge assets (./assets) into runtime-ready files under
 * ./public/assets. The output is committed, so a clean checkout builds without
 * running this script. Re-run it only when the source assets change:
 *
 *   node scripts/prepare-assets.mjs            # atlases + UI images
 *   node scripts/prepare-assets.mjs --sounds   # also re-encode WAV -> MP3 (needs ffmpeg)
 *
 * Output:
 *   public/assets/atlas/ships.{png,json}        Starling XML -> Pixi JSON (1x only, the
 *                                               "retina" ships sheet has the same resolution)
 *   public/assets/atlas/tiles{,@2x}.{png,json}  64px grid -> Pixi JSON, frames tile_1..tile_96
 *   public/assets/atlas/ui{,@2x}.{png,json}     provided TexturePacker JSON, image path rewritten
 *   public/assets/ui/{1x,2x}/...                individual UI PNGs used by the React menus
 *   public/assets/sounds/*.mp3                  96 kbps mono MP3 (WAV is ~6 MB, MP3 ~0.6 MB)
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets');
const out = join(root, 'public', 'assets');
const withSounds = process.argv.includes('--sounds');

const ensureDir = (dir) => mkdirSync(dir, { recursive: true });

function pngSize(file) {
  const buf = readFileSync(file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function frame(x, y, w, h) {
  return {
    frame: { x, y, w, h },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w, h },
    sourceSize: { w, h },
  };
}

function writeAtlas(name, image, frames, scale) {
  const size = pngSize(join(out, 'atlas', image));
  const json = {
    frames,
    meta: { app: 'scripts/prepare-assets.mjs', image, format: 'RGBA8888', size, scale: String(scale) },
  };
  writeFileSync(join(out, 'atlas', `${name}.json`), JSON.stringify(json));
}

// ---------------------------------------------------------------------------
ensureDir(join(out, 'atlas'));

// Ships: Starling XML -> Pixi JSON
{
  const xml = readFileSync(join(src, 'spritesheet', 'ships_miscellaneous_sheet.xml'), 'utf8');
  const frames = {};
  for (const m of xml.matchAll(/<SubTexture name="([^"]+)\.png" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)) {
    frames[m[1]] = frame(+m[2], +m[3], +m[4], +m[5]);
  }
  copyFileSync(join(src, 'spritesheet', 'ships_miscellaneous_sheet.png'), join(out, 'atlas', 'ships.png'));
  writeAtlas('ships', 'ships.png', frames, 1);
  console.log(`ships atlas: ${Object.keys(frames).length} frames`);
}

// Tiles: 16 x 6 grid of 64px (128px on retina)
for (const [suffix, file, scale] of [
  ['', 'tiles_sheet.png', 1],
  ['@2x', 'tiles_sheet_retina.png', 2],
]) {
  const image = `tiles${suffix}.png`;
  copyFileSync(join(src, 'tilesheet', file), join(out, 'atlas', image));
  const size = 64 * scale;
  const frames = {};
  for (let i = 0; i < 96; i++) {
    frames[`tile_${i + 1}`] = frame((i % 16) * size, Math.floor(i / 16) * size, size, size);
  }
  writeAtlas(`tiles${suffix}`, image, frames, scale);
}
console.log('tiles atlas: 96 frames (1x, 2x)');

// UI: provided atlas, only the image path changes
for (const [suffix, file] of [
  ['', 'ui_sheet'],
  ['@2x', 'ui_sheet_retina'],
]) {
  const json = JSON.parse(readFileSync(join(src, 'spritesheet', `${file}.json`), 'utf8'));
  json.meta.image = `ui${suffix}.png`;
  copyFileSync(join(src, 'spritesheet', `${file}.png`), join(out, 'atlas', `ui${suffix}.png`));
  writeFileSync(join(out, 'atlas', `ui${suffix}.json`), JSON.stringify(json));
}
console.log('ui atlas: copied (1x, 2x)');

// UI PNGs for CSS (menus, HUD, touch controls)
rmSync(join(out, 'ui'), { recursive: true, force: true });
cpSync(join(src, 'png', 'default', 'ui'), join(out, 'ui', '1x'), { recursive: true });
cpSync(join(src, 'png', 'retina', 'ui'), join(out, 'ui', '2x'), { recursive: true });
copyFileSync(join(src, 'ui_scene_background.png'), join(out, 'ui', 'scene_background.png'));
copyFileSync(join(src, 'logo_jungle_gaming.svg'), join(out, 'ui', 'logo_jungle_gaming.svg'));
copyFileSync(join(src, 'png', 'default', 'ships', 'ship_2.png'), join(out, 'ui', 'ship_emblem.png'));
copyFileSync(join(src, 'png', 'retina', 'ship_parts', 'cannon_loose.png'), join(out, 'ui', 'cannon_loose.png'));
console.log('ui images: copied');

// Sounds
if (withSounds) {
  ensureDir(join(out, 'sounds'));
  for (const wav of readdirSync(join(src, 'sounds')).filter((f) => f.endsWith('.wav'))) {
    const mp3 = join(out, 'sounds', wav.replace(/\.wav$/, '.mp3'));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(src, 'sounds', wav), '-ac', '1', '-b:a', '96k', mp3]);
  }
  console.log('sounds: encoded to mp3');
} else if (!existsSync(join(out, 'sounds'))) {
  console.warn('sounds: public/assets/sounds is missing, run with --sounds (requires ffmpeg)');
}
