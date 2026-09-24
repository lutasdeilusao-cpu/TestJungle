# Architecture

Pirate Battle is a single-page React application. The game itself is a pure
TypeScript simulation rendered with PixiJS. Ranking and match history come
from a REST API that is mocked with MSW in every environment, the deployed
build included.

```
┌──────────────────────────── React (menus, HUD, dialogs, forms) ────────────────────────────┐
│  App ── hash router ── MainMenu · Options · CaptainsLog · Result · GameScreen · NetworkLab │
│                                                  │  ▲ useSyncExternalStore(HudState)       │
└──────────────────────────────────────────────────┼──┼──────────────────────────────────────┘
                                                   ▼  │
                  ┌────────────── GameSession (lifecycle, fixed-step loop) ──────────────┐
                  │  InputController ──controls──▶ Simulation ──events──▶ GameRenderer   │
                  │   keyboard / touch             pure rules           PixiJS scene     │
                  │                                (no DOM, no Pixi)    audio feedback    │
                  └──────────────────────────────────────────────────────────────────────┘
                                 │ MatchOutcome
                                 ▼
   state/ (localStorage: settings, profile, last result, pending outbox)
   api/   (Axios client + TanStack Query hooks) ──HTTP──▶ MSW service worker ──▶ mocks/ (handlers, db, scenarios)
```

| Folder | Responsibility | Depends on |
| --- | --- | --- |
| `src/game/sim` | Rules: movement, AI, weapons, projectiles, collisions, spawning, score, end of match | `config`, `arena`, `core` |
| `src/game/render` | Pixi scene: arena, ship views, health bars, effects, layout. Reads the simulation and never writes to it | `pixi.js`, `sim` (read only) |
| `src/game/input` | Keyboard and touch into `ShipControls` | – |
| `src/game/session` | Match lifecycle, loop, pause, HUD store, frame statistics | all of the above |
| `src/game/config.ts` | Typed, central balancing config. Frozen snapshot per match | – |
| `src/ui` | React screens and components, CSS | `session` (store), `api`, `state` |
| `src/api` | Contracts, Axios client, TanStack Query hooks, submission logic | `state` |
| `src/state` | Local persistence (settings, profile, last result, pending outbox) | – |
| `src/mocks` | MSW handlers, mock database, fixtures, network scenarios | `api/contracts` |
| `src/testing` | Test and profiling hooks (`window.__PIRATE__`) | `session` |

## 1. React and PixiJS integration

**One Pixi application for the whole page** (`render/pixiHost.ts`). A match
*acquires* the application, which moves the canvas into its host element and
attaches a `ResizeObserver`. It *releases* it on teardown, which stops the
ticker, empties the stage and detaches the canvas. The WebGL context and the
GPU copies of the atlases survive between matches. Creating a context per
match would re-upload textures and leak contexts on repeated navigation
(browsers cap them at about 16).

**`GameScreen` owns exactly one `GameSession` per mount.** The session is
created in `useEffect` and disposed in its cleanup. Under React Strict Mode the
mount, unmount, mount sequence creates a session, disposes it (possibly while
it is still loading) and creates a second one. `GameSession.start()` checks a
`disposed` flag after every `await` and the Pixi lease is ownership-checked
(a symbol token), so the discarded session never touches the canvas. The
suite passes against both the production build and the dev server
(`E2E_BASE_URL=http://localhost:5173`), where Strict Mode double-mounts.

**No React render per frame.** The combat state lives in `Simulation`. The
session publishes a coarse `HudState` (status, score, whole seconds, health,
pause reason, load progress) through a minimal external store (`Store.set`
ignores unchanged fields), consumed with `useSyncExternalStore`. React re-renders
the HUD a few times per second at most. Health bars above the ships, effects
and everything else that moves are Pixi objects.

**Division of work.** Pixi draws the arena, ships, projectiles, effects and the
bars above the ships. React draws menus, forms, the HUD (real DOM text, so it
stays readable by assistive tech and tests), the touch controls and the dialogs.
The Pixi chunk is lazy-loaded: the menu never downloads PixiJS.

## 2. Simulation loop

- **Fixed step** of 1/60 s (`config.fixedStep`) with an accumulator. The Pixi
  ticker provides the frame delta, clamped to `maxFrameDelta` (0.25 s) so a
  long hitch does not cause a spiral of catch-up steps. Movement, cooldowns,
  projectile lifetime, spawns and the match clock all advance in simulated
  seconds, so they do not depend on the frame rate.
- **Interpolation.** Each entity keeps its previous pose. The renderer
  interpolates with `alpha = accumulator / step`, which keeps motion smooth on
  120/144 Hz screens with a 60 Hz simulation.
- **Determinism.** Every random decision in the rules (spawn point and enemy
  type) goes through a seeded `Rng` (mulberry32). The same config and the same
  inputs reproduce the same match; a unit test checks this.
- **Events.** `step()` pushes `SimEvent`s (shot, hit, projectile end, ship
  destroyed, spawn, impact, score, end). The session drains them after each
  step and hands them to the renderer (visual feedback) and the audio manager.
  Rules never call rendering code.
- **Order inside a step:** store previous poses, read controls, update the flow
  field, AI decides, move ships and resolve obstacles, ship-vs-ship contacts
  (chaser impacts), fire weapons, move and resolve projectiles, power-up
  pickup and expiry, remove dead entities, spawner, end check.
- **Three RNG streams** derived from the seed: spawning (where and which
  type/variant), AI (temperament, wander waypoints) and loot (drop kind, wave
  reward). Tuning one never shifts the others.
- **Manual clock (tests and profiling).** With `pb.test.clock = manual` the
  ticker is stopped and time only advances through `advance(ms)`, which runs
  whole fixed steps (1000 ms is always exactly 60 steps). Everything else
  (keyboard events, rules, collisions, rendering) is the production code path.

## 3. Collisions

Obstacles (`arena/arenaMap.ts`) are **rounded rectangles** (islands, inset to
the drawn shoreline) and **circles** (rocks). Geometry lives in `sim/geometry.ts`
as signed distance plus outward normal.

| Pair | Shape | Resolution |
| --- | --- | --- |
| Ship vs obstacles and arena border | 3 circles along the hull (bow, mid, stern) | Push-out along the normal, up to 3 iterations; speed capped at 50% while scraping, so ships slide along shores |
| Ship vs ship | Hull circles vs hull circles | Chaser vs player: impact (damage, chaser explodes, no score). Other pairs: symmetric separation |
| Projectile vs ship | Circle vs hull capsule (segment ± hullRadius), also tested at the mid-point of the last step | Damage applied once; projectile removed in the same step |
| Projectile vs obstacle | Point vs obstacle distance | Removed (sand puff) |
| Projectile lifetime | Range (px) and lifetime (s), whichever ends first | Removed (water splash) |
| Projectile out of arena | Bounds check | Removed |

Every projectile has an `alive` flag that is cleared when it first hits, so it
cannot damage twice. A ship is destroyed only once (`alive` guard), which makes
scoring idempotent. Dead ships and projectiles are removed at the end of the
step, so they stop moving, firing and colliding immediately. Player projectiles
only hit enemies and enemy projectiles only hit the player.

## 4. Enemy behaviour and spawning

The two required types (Chaser and Shooter) come in variants, defined in
`spawn.variants` as a weight, a sail colour and a stat patch merged over the
base type config:

| Variant | Behaviour |
| --- | --- |
| Chaser `standard` | Hunts (line of sight or flow field), may lose interest for 1–2.5 s |
| Chaser `drifter` | Wanders between random open-water waypoints until the player is within `aggroRange` or it is hit, then hunts |
| Chaser `sprinter` | Standard hunting with a small, fast, fragile hull |
| Shooter `standard` | Approaches to `preferredDistance`, holds, fires the bow cannon |
| Shooter `flanker` | Orbits the player (tangent steering, bent in or out by the distance error, flips direction when blocked); only fires 2-ball broadsides to the side facing the player |
| Shooter `sentinel` | Sails to a guard post `anchorInset` px inside the arena from its spawn point, holds it, and fires from long range |

**Temperament.** Each enemy rolls a reaction time and an aim error when it
spawns. Steering is only re-evaluated every reaction period, so enemies
overshoot and hesitate. Firing is checked every step, against an aim offset
that is re-rolled after each shot. Forced opening spawns (chaser, then shooter)
always use the standard variant.

- **Navigation:** a 32 px grid of the arena marks cells too close to an
  obstacle for a hull. A Dijkstra flow field towards the player's cell is
  rebuilt at most 5 times per second, and only when the player changes cell.
  With a clear line of sight (grid raycast), an enemy steers straight at the
  player; otherwise it follows the flow field around the islands.
- **Chaser:** full speed towards the player. It slows down for very sharp
  turns so it does not orbit its target. Contact means impact damage and
  self-destruction.
- **Shooter:** approaches until `preferredDistance`, then holds and keeps its
  bow on the player. It fires its bow cannon when the player is in
  `attackRange`, the aim error is within `aimTolerance`, it has line of sight,
  its cooldown is ready and its spawn grace has elapsed.
- **Spawner:** one enemy every `spawn.interval` seconds (after `initialDelay`).
  The first spawns follow `openingSequence` (chaser, then shooter), so both
  types appear in every default match; after that the type is drawn from
  `weights`. A candidate point is valid only when it is clear of obstacles and
  ships and at least `minPlayerDistance` (480 px) away from the player, so no
  damage is unavoidable. Spawns pause while `maxAlive` enemies are alive.
  Enemies fade in and cannot attack for `spawnGrace` seconds.

## 4b. Power-ups and waves (beyond the brief)

- **Drops:** every enemy sunk by the player's cannons (never a ram or a wave
  clear) drops a `PowerUp` at its position (`powerUps.dropChance`, 1 by
  default). It floats for `lifetime` seconds and is collected when the
  player's hull capsule touches it.
- **Upgrades** are permanent for the match and stack up to `maxStacks`.
  `damage` multiplies every player ball's damage, `fireRate` divides all
  player cooldowns, and `spread` adds bow balls fanned out by `spreadAngle`.
  `repair` heals and does not stack; an upgrade that is already maxed turns
  into a repair. A new match builds a new `Simulation`, so everything resets.
- **Waves:** the wave target is `firstTarget + increment × (wave − 1)`
  (2, 4, 6…). Reaching it emits `wave_cleared`: heal `rewardHeal`, one free
  random non-maxed upgrade, and, with `clearBoard`, every remaining enemy is
  sunk with cause `wave_clear` (no score, no loot) and enemy balls are removed.
  Each new wave raises enemy health and damage (`enemyHealthPerWave`,
  `enemyDamagePerWave`) and the number of enemies alive at once
  (`maxAlivePerWave`, up to `maxAliveCap`).
- **Compatibility with the brief:** scoring (1 point per enemy sunk by the
  player), the spawn interval and the end conditions are unchanged.
  `wavesCleared` is an optional field of the match record (older records
  simply lack it) and does not affect the ranking order.
- **Presentation:** `PowerUpView` (a tinted brass badge with an icon that bobs
  and blinks before it sinks), rings on drop and pickup, golden shockwaves on a
  wave clear. The HUD shows `Wave N · kills/target` and upgrade chips, and a
  CSS-animated banner (remounted per notice id, no React timers) announces
  pickups and wave clears; the live region announces them too.

## 5. Match lifecycle and pause

```
loading ──▶ running ◀──▶ paused
   │           │
   ▼           ▼ (time up / hp 0)
 error       ending (1.6 s of effects, simulation frozen) ──▶ finished ──▶ Result screen
 (retry)
any state ──dispose()──▶ disposed   (leaving the screen, refresh, restart)
```

- **Pause** (Escape, P, the HUD button, window `blur`, `visibilitychange`
  hidden): the simulation stops stepping, the accumulator is reset, input is
  suspended and every held key and touch is released. Cooldowns and the clock
  are simulated values, so they freeze too. Resuming needs an explicit action
  (Resume, Escape or P in the dialog); focus coming back alone does not resume.
  Keys still physically held after resuming do nothing until they are pressed
  again, so nothing from the paused period is replayed.
- **End:** `Simulation.end()` freezes the rules (steps become no-ops). The
  session keeps rendering effects for `endDelay`, then reports a
  `MatchOutcome`. The outcome is persisted and queued for registration before
  the Result screen is shown.
- **Restart and Play Again** remount `GameScreen` with a new key, which
  disposes the old session and builds a fresh simulation from a new config
  snapshot. Health, score, clock and entities all start over.
- **Abandon:** leaving `#/play` in any way (pause menu, browser back, refresh)
  disposes the session without producing an outcome, so nothing is recorded.
  A refresh on `#/play` redirects to the menu.

## 6. Rendering and resources

- **Atlases:** `scripts/prepare-assets.mjs` converts the ships (Starling XML)
  and the tile grid to Pixi spritesheet JSON and reuses the provided UI
  TexturePacker JSON. The output is committed in `public/assets`. The
  1x or 2x atlases are chosen from the arena's effective on-screen scale
  (CSS scale × device pixel ratio). Loading goes through one cached promise
  (`assets/gameAssets.ts`): textures are loaded once and shared by every match.
  A failure clears the cache and shows an error dialog with Retry. The match
  never starts with missing textures.
- **Static arena:** water is two drifting `TilingSprite`s. Islands, the shallow
  water halo, rocks and decorations (about 200 tile sprites) are built once and
  rendered to a single cached texture (`cacheAsTexture`).
- **Pools:** effect particles (muzzle flashes, smoke, splashes, debris,
  explosions, sinking wrecks) and projectile sprites are pooled. Wakes and
  projectile trails are drawn into one `Graphics` each per frame. Ship views
  are created and destroyed with their simulation entities.
- **Health bars** use the atlas frame/fill pairs. The fill is clipped by
  swapping in a cached sub-texture (40 widths), not a mask, so batching is kept.
- **Damage states:** each ship colour has four sprites (intact, damaged,
  heavily damaged, wreck). The view switches at 66% and 33% health and adds
  flickering fire. Hits flash the hull and throw debris; sinking leaves a
  fading wreck; ramming and player hits shake the screen.
- **Layout and DPR:** the renderer resolution is `min(devicePixelRatio, 2)`
  with `autoDensity`. The 1600×900 arena is scaled uniformly to fit the canvas
  and letterboxed (darkened margins and a gold border), so proportions and
  arena limits are identical on every screen. `screenToWorld()` is the exact
  inverse of the layout transform. Resizing and rotating only change the
  transform, never the rules.
- **Teardown** (`GameSession.dispose`): input listeners, window/document
  listeners, ticker callback, renderer resize listener, audio loops, ship views,
  pools, generated textures, the scene graph and finally the Pixi lease. Shared
  atlas textures are intentionally kept. The profiling run checks that the
  heap, DOM nodes and listeners do not grow over repeated matches. It caught a
  real leak: with an options object, Pixi's `Graphics.destroy()` only releases
  the graphics' own `GraphicsContext` (and its GPU batch data in the
  long-lived renderer) when `context: true` is passed. Two contexts (wakes and
  projectile trails) were retained per match, about 0.33 MB per cycle. The
  scene is now destroyed with `{ children: true, context: true }` (details in
  docs/PERFORMANCE.md).

## 7. Input

`InputController` maps several keys per action (WASD, arrows, Space/K, Q/J,
E/L) and one pointer per touch button. It tracks every source separately, so
releasing one of two keys bound to the same action keeps the action. Listeners
are attached only while a match is active. Keys typed into inputs are ignored,
so menus and forms behave normally. Fire presses are *latched* until the next
simulation step, so a tap shorter than one step still fires. Touch buttons use
pointer capture and are multi-touch: steer with one thumb and fire with the
other.

## 8. Local persistence

| Key | Content |
| --- | --- |
| `pb.settings.v1` | Session time, spawn interval, sound on/off (validated on read) |
| `pb.profile.v1` | Player id (UUID) and captain name |
| `pb.lastResult.v1` | Last completed match plus `savedAt` once the server confirmed it |
| `pb.pending.v1` | Outbox of completed matches not yet confirmed (attempts, last error) |
| `pb.mock.db.v1` | Mock server database (confirmed records, revision) |
| `pb.mock.scenario`, `pb.mock.seed`, `pb.mock.latencyScale`, `pb.api.timeoutMs` | Network Lab and test controls |
| `pb.test.clock`, `pb.test.overrides`, `pb.debug.colliders` | Test and debug hooks |

Every read validates the stored shape and falls back to defaults, so corrupted
or outdated data cannot break the app.

## 9. Ranking and match history

**Contracts** (`api/contracts.ts`, shared by the client, the hooks and the MSW
handlers):

- `GET /api/ranking?sessionTime&spawnInterval&page&pageSize` returns a `RankingPage`.
- `GET /api/players/:playerId/matches?page&pageSize` returns a `HistoryPage`
  (newest first).
- `POST /api/matches` with an `Idempotency-Key` header returns
  `201 { record, created: true }` the first time and
  `200 { record, created: false }` for the same match id. It returns 409 for
  the same id with a different payload and 422 for an invalid payload.

Each record carries match id, player id and name, date, score, effective
duration, end reason and the settings used. The ranking only compares matches
with the same settings (`configKey`). The order is deterministic: score, then
survived before defeated, then longer duration, then earlier date, then
match id.

**TanStack Query** (`api/queries.ts`):

- Keys: `['ranking', configKey, page, pageSize]` and `['history', playerId, page, pageSize]`.
- `staleTime` 10 s, `refetchOnMount: 'always'` (a tab refetches in the
  background every time it is shown), `refetchOnWindowFocus`, and
  `keepPreviousData` while paging ("Loading page…" over the previous page).
- Retries: timeouts, network errors, 5xx and 429 are retried twice with
  exponential backoff. Other 4xx are not retried. Errors are normalised by the
  Axios interceptor into `ApiError`.
- States: first load (spinner), empty, error (alert plus "Try again", with the
  last good data kept when there is any), background refresh ("Updating…").
- **Stale responses:** superseded requests are cancelled (`AbortSignal` passed
  to Axios, `cancelRefetch` on invalidation). In addition, every page carries a
  monotonic `revision` and the query function keeps the cached page if a
  response is older than it.

**Registration and recovery:**

1. When a match finishes, a `MatchSubmission` with a client-generated UUID is
   written to `pb.lastResult.v1` and to the outbox `pb.pending.v1` **before**
   any request is sent.
2. `submitMatch()` runs the mutation registered with
   `queryClient.setMutationDefaults`, so its callbacks do not depend on a
   mounted component. Mutations share `scope: 'submit-match'` and therefore
   run one at a time. An in-memory set ignores a second submit of a match
   that is already in flight.
3. On success the entry leaves the outbox, the last result gets `savedAt`, and
   both `['ranking']` and `['history']` are invalidated.
4. On failure (after retries) the entry stays in the outbox with its error.
   The Result screen shows "Could not record… Retry now" and the menu shows a
   banner. Pending entries are retried on app start, on the `online` event and
   by hand. The player can keep playing meanwhile.
5. A timeout after the server already stored the record resolves itself: the
   retry hits the idempotency key and gets `200 created: false` with the
   stored record. There is never a second history row or ranking entry.

## 10. MSW mocks

`mocks/handlers.ts` implements the endpoints on top of `mocks/db.ts`, a small
database persisted in localStorage, so confirmed records survive refreshes and
both endpoints read the same data. `mocks/fixtures.ts` generates rival
matches from a fixed seed and date. `mocks/scenarios.ts` defines the
scenarios, and each one decides, per request, a latency, a failure or a
success:

| Scenario | Behaviour |
| --- | --- |
| `default` | Rival fixtures, 120–350 ms |
| `empty` | No records |
| `many-pages` | 100+ records, 23 of them in your own history |
| `slow` | About 2.5 s per response |
| `variable-latency` | Seeded random 50 ms to 2 s |
| `out-of-order` | Odd requests 2.5 s, even ones 100 ms |
| `timeout` | Never answers |
| `network-error` | Connection failure |
| `server-error` | HTTP 500 |
| `client-error` | 400 for queries, 422 for submissions |
| `ranking-fails` / `history-fails` | 503 on one endpoint only |
| `submit-timeout-after-commit` | First submission of each match is stored, then never answered |
| `offline-on-submit` | Submissions fail until you switch back to `default` |

The scenario is chosen in the **Network Lab** (main menu) or with
`?scenario=<id>`, and persisted. **Reset** restores the default scenario and
the initial fixtures. Latency comes from a seeded RNG and is multiplied by
`pb.mock.latencyScale` (the tests use 0 unless they are testing latency). The
worker (`public/mockServiceWorker.js`) is started before the first render in
every build. If service workers are unavailable, the game still runs and the
tabs show errors.

## 11. Accessibility

Real buttons, links and form controls everywhere, with visible focus
(`:focus-visible`). Dialogs use the native `<dialog>`: `showModal()` makes the
page behind inert and traps focus, Escape is handled, and focus is moved to
the first control and restored on close. Tabs follow the WAI-ARIA pattern
(arrow keys, Home, End). Form errors use `aria-invalid`, `aria-describedby`
and `role="alert"`, and focus moves to the first invalid field. The HUD is
semantic (a meter for health, text for score and time). A polite live region
announces only milestones (start, score after a quiet period, 60/30/10 s left,
low hull, pause, resume, end), never every second. Game keys are captured only
while a match is active. Contrast: cream text on dark navy panels. Motion is
reduced under `prefers-reduced-motion`. Touch portrait orientation shows a
"rotate your device" notice (landscape is the supported orientation).

## 12. Testing strategy

- **Unit (Vitest):** `Simulation.test.ts` covers movement, collisions, weapons,
  spawn, scoring, end conditions and determinism, headless.
- **E2E (Playwright):** the 12 required areas, run against the production
  build on desktop Chromium, with the `@core` flows also on a landscape touch
  phone. Tests seed localStorage (profile, settings, scenario, overrides)
  once per test in a fresh context, use the manual clock, and drive the game
  only through the keyboard and the touch buttons. Assertions read
  `window.__PIRATE__.state()`. Visual baselines: menu, arena, result.
- **Balance bench:** `src/game/sim/__bench__` runs a heuristic bot over seeds
  and configurations (`BALANCE=1`).

## 13. Balancing decisions

The values are in `src/game/config.ts`.

- The player out-guns every enemy but can be overwhelmed. The bow cannon
  (20 dmg, 0.45 s) sinks a chaser (30 hp) in two hits and a shooter (60 hp)
  in three. A broadside (3 × 25 dmg, 1.4 s cooldown per side) is the
  high-risk, high-reward close-range option.
- Chasers are faster than the player's turn circle but slower than its top
  speed, so they can be outrun and dodged. A ram costs 12 hp (sprinters 8).
  Shooters are slow and keep about 300 px away, and their balls (6 dmg,
  2.4 s cooldown) are slow enough to dodge.
- **First playtest feedback: too hard, and every enemy felt like a chaser.**
  The answer was variety and imperfection rather than weaker numbers alone:
  variants with distinct behaviours, a rolled reaction time and aim error per
  enemy, chasers that sometimes lose interest, lower base damage, and only 4
  enemies alive in wave 1.
- **Progression:** power-ups and wave rewards make the player stronger over a
  match, so each wave scales enemies up (+35% health and damage, +1 enemy
  alive, up to 10). Upgrades are deliberately modest per stack and capped so a
  long match does not become trivial.
- **Bot bench** (`BALANCE=1`, 8 seeds; the bot aims perfectly but never
  dodges). Before the changes, the default match (120 s, 3 s) killed the bot
  on every seed, between 44 and 103 s. Now the bot survives the default on 7
  of 8 seeds (30–34 kills, 5 waves) and loses on 1 of 8. Longer or faster
  settings get hard again: at 180 s / 2 s the bot sinks on 2 of 8 seeds, and
  with a 1 s interval on 3 of 8.
- The spawn interval can be set between 1 and 10 s (0.5 s steps). Below 1 s,
  spawns would outpace any possible kill rate. Above 10 s, a 60 s match would
  have almost no enemies.

## 14. Limitations and known trade-offs

- There is no real backend: the "server" runs in the page (MSW), so several
  tabs of the same browser share one localStorage database without live sync.
- A refresh while a submission is in flight: the attempt is lost, but the
  outbox entry is not, and it is re-sent on the next start (idempotent).
- Visual baselines were produced on Windows. Font rendering differs between
  operating systems, so on another OS run `npm run test:e2e:update` once, or
  compare in the same OS/CI image.
- Only one arena layout. Islands are axis-aligned rounded rectangles, which
  matches the tile art but not arbitrary coastlines.
- Audio uses Web Audio. It unlocks on the first Play click and can be muted
  in Options. The sounds are the provided WAVs re-encoded to MP3.
