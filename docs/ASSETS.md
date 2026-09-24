# Assets: sources, conversions and licenses

## Sources

| Asset | Source | License |
| --- | --- | --- |
| Ships, ship parts, effects, tiles, sprite sheets, vectors (`assets/png`, `assets/spritesheet/ships_*`, `assets/tilesheet`, `assets/vector`) | Provided with the Jungle Gaming challenge repository. The file names, sheet layout and Starling XML format match Kenney's **Pirate Pack** (https://kenney.nl/assets/pirate-pack) | Kenney assets are released under **CC0 1.0** (public domain). The challenge repository ships no license file; use is covered by the challenge terms |
| UI atlas and images (`assets/spritesheet/ui_sheet*`, `assets/png/*/ui`), scene background, reference images | Provided with the challenge | Challenge terms |
| Sound effects and loops (`assets/sounds/*.wav`) | Provided with the challenge | Challenge terms |
| Jungle Gaming logo (`assets/logo_jungle_gaming.svg`) | Provided with the challenge | Trademark of Jungle Gaming; used only as brand mark in the game |

No third-party asset was added. Fonts are the system UI font stack (no web font
is downloaded). The generated textures (smoke puff, splash ring, droplets) are
drawn at runtime with Pixi `Graphics`.

## Conversions (`scripts/prepare-assets.mjs`)

The originals in `assets/` are untouched. The script writes runtime files to
`public/assets/`, and the output is committed:

| Output | From | Conversion |
| --- | --- | --- |
| `atlas/ships.{png,json}` | `spritesheet/ships_miscellaneous_sheet.{png,xml}` | Starling XML to Pixi/TexturePacker JSON (the "retina" ships sheet has the same resolution, so only 1x is used) |
| `atlas/tiles{,@2x}.{png,json}` | `tilesheet/tiles_sheet{,_retina}.png` | 16×6 grid of 64 px (128 px) cells to JSON frames `tile_1…tile_96` |
| `atlas/ui{,@2x}.{png,json}` | `spritesheet/ui_sheet{,_retina}.{png,json}` | Copied; `meta.image` rewritten |
| `ui/1x`, `ui/2x` | `png/default/ui`, `png/retina/ui` | Copied (used by CSS for menus, HUD and touch controls) |
| `ui/scene_background.png`, `ui/logo_jungle_gaming.svg`, `ui/ship_emblem.png` | `ui_scene_background.png`, logo, `ships/ship_2.png` | Copied |
| `sounds/*.mp3` | `sounds/*.wav` | ffmpeg: mono, 96 kbps MP3 (about 6 MB of WAV becomes 0.6 MB) |

Re-run with `npm run prepare-assets` (ffmpeg is required only for the audio
step).
