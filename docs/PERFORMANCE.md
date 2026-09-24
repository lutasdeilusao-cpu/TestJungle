# Performance report

The target is **60 FPS** in the optimised build. It was measured with
`perf/profile.mjs` (`npm run perf`). Raw data and summaries are in
[`perf/results/`](../perf/results).

## Reference environment

| | |
| --- | --- |
| CPU | Intel Core i7-13700HX (16 cores / 24 threads) |
| GPU | Intel UHD Graphics (integrated), ANGLE Direct3D 11 |
| RAM | 16 GB |
| OS | Windows 11 (10.0.26200) |
| Browser | Playwright Chromium 153 (headless, real GPU via `--use-angle=d3d11 --ignore-gpu-blocklist`) |
| Resolution | 1600×900 viewport, device pixel ratio 1, 1x atlases |
| Build | `npm run build` + `npm run preview` (minified production bundle, MSW active) |

## Method

1. **Frame run.** One real-time match (real ticker, no manual clock) driven by
   a bot through the real keyboard controls. Every 100 ms the bot aims at the
   nearest enemy, fires the bow cannon and broadsides and keeps sailing. The
   player's health is raised to 100 000 so the match lasts the full duration;
   every other value is the default config. The in-game `FrameStats` records
   the ticker delta of every frame together with the number of ships,
   projectiles and particles.
2. **Memory run.** Five cycles of start, play for 15 s with the bot, pause and
   leave to the menu. After each cycle a full GC is forced twice through CDP
   (`HeapProfiler.collectGarbage`), then `Runtime.getHeapUsage` and
   `Memory.getDOMCounters` are sampled on the menu.
3. **Stress variant** (`PERF_STRESS=1`): a spawn every second, up to 40
   enemies alive (the game caps it at 7), and the bot only uses broadsides,
   so enemies pile up. This shows the headroom above the real gameplay load.

## Results: default configuration, 3-minute match

Current build (enemy variants, power-ups and waves). 180 s match, spawn every
3 s ([summary](../perf/results/2026-09-24-default.md), [raw](../perf/results/profile-2026-09-24T15-15-40-386Z.json)):

| Metric | Value |
| --- | ---: |
| Frames | 10 798 |
| Average FPS | **60.0** |
| Frame time p50 / **p95** / p99 | 16.7 / **16.7** / 16.8 ms |
| Longest frame | 16.8 ms |
| Frames over 25 ms | 0 |
| Ships alive (average / max) | 2.3 / 5 |
| Projectiles in flight (average / max) | 3.4 / 16 (fan-shot upgrades) |
| Particles (max) | 156 |

Frame times sit on the display's vsync (16.7 ms): the game never missed a
frame in 3 minutes. The ship count stays low because every wave clear sinks
the remaining enemies.

## Results: stress, 120 s, spawn every second, up to 40 enemies

Wave board clears and the per-wave cap are disabled, so enemies pile up
([summary](../perf/results/2026-09-24-stress.md), [raw](../perf/results/profile-stress-2026-09-24T15-23-08-572Z.json)):

| Metric | Value |
| --- | ---: |
| Average FPS | **59.9** |
| Frame time p50 / p95 / p99 | 16.7 / 16.7 / 16.8 ms |
| Longest frame | 100 ms (Pixi's ticker clamps deltas at 100 ms) |
| Frames over 25 ms | 3 of 7 182 |
| Ships alive (average / max) | 25.9 / 37 |
| Projectiles (max) | 16 |
| Particles (max) | 177 |

With almost 4 times the maximum real enemy count (the game caps it at 10),
the frame budget holds. The few long frames are isolated hitches (GC or
first-time texture upload); they do not repeat.

## Memory: 5 start/play/leave cycles

Current build ([summary](../perf/results/2026-09-24-default.md)):

| Sample | JS heap used | DOM nodes | JS listeners | Canvases in DOM |
| --- | ---: | ---: | ---: | ---: |
| Menu, before any match | 8.25 MB | 297 | 209 | 0 |
| After cycle 1 | 8.55 MB | 424 | 214 | 0 |
| After cycle 2 | 8.53 MB | 424 | 214 | 0 |
| After cycle 3 | 8.64 MB | 424 | 214 | 0 |
| After cycle 4 | 8.79 MB | 424 | 214 | 0 |
| After cycle 5 | 8.84 MB | 424 | 214 | 0 |

The first cycle pays one-time costs: the lazy game chunk, shared atlases,
the Pixi renderer and pooled render textures, and the TanStack caches of the
menu. DOM nodes and listeners are constant and no canvas is left behind. The
small drift after that (about 0.07 MB per cycle) was checked with heap
snapshots on a dev build over 8 cycles. Between cycle 2 and cycle 8 the
object growth is about 7 KB in total, and the heap flattens (22.0 MB from
cycle 5 to 8). It is cache warm-up (per-colour ship textures, health-bar
sub-textures), not a leak.

### Leak found and fixed

The first profile showed **continuous growth of about 0.33 MB per cycle**
(8.18, 8.86, 9.20, 9.53, 9.91, 10.21 MB; see
[before-leak-fix](../perf/results/2026-09-24-before-leak-fix.md)). To find it,
heap snapshots were taken on a dev build after cycle 2 and after cycle 6, and
object counts by constructor were compared. Every cycle left behind 2
`GraphicsContext` objects with their `GpuGraphicsContext`, `DefaultBatcher`,
batch geometry and about 30 `BatchableGraphics`.

Cause: in PixiJS 8, `Graphics.destroy(options)` frees the graphics' own
context only when it is called without arguments or with `context: true`. The
scene was destroyed with `{ children: true }`, so the wake and
projectile-trail `Graphics` kept their contexts registered in the long-lived
renderer. The fix is `world.destroy({ children: true, context: true })` in
`GameRenderer.destroy()` and the same in `ArenaView`. After the fix, the
object growth between the two snapshots dropped from about 840 KB to about
2 KB, and the heap stabilised as shown above.

## Why it is cheap

- The static arena (about 200 tile sprites) is rendered once to a cached
  texture; each frame draws two tiling sprites, the cached arena and the
  moving objects.
- Three atlases, so sprites batch into very few draw calls. Health-bar fills
  swap cached sub-textures instead of using masks.
- Particles and projectile sprites are pooled; power-up badges are a few sprites each. The simulation reuses its
  arrays, and the navigation grid uses typed arrays and is only rebuilt when
  the player changes cell (at most 5 times per second).
- React does not re-render per frame: the HUD store changes only on
  score, second, health or status changes.
- The manual clock used by the tests stops the ticker entirely, which keeps
  parallel E2E runs fast.

## Limitations of the measurement

- Headless Chromium on a laptop's **integrated** GPU at DPR 1. On a 2x/3x
  screen the renderer runs at up to 2x resolution with 2x atlases. The GPU
  fill cost is higher but the scene is light. Phones were only emulated
  (Playwright Pixel 7 profile) for layout and touch, not profiled on real
  hardware.
- With software WebGL (`PERF_GPU=0`, SwiftShader, as in default headless
  CI) the same scene runs at about 27 FPS. That measures the CPU rasteriser,
  not the game, so the E2E suite does not assert frame rates.
- The ticker clamps a single frame's delta at 100 ms, so "longest frame"
  cannot show hitches longer than that. None were observed apart from the
  single stress-run frame.
- The bot is an approximation of a player: it keeps enemies and projectiles
  on screen but does not dodge, so real matches have similar or lower entity
  counts (the default config never allows more than 11 ships: 10 enemies plus the player).
