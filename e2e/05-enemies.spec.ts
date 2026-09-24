import { expect, initApp, test, type Ship } from './fixtures';

const single = (kind: 'chaser' | 'shooter', x: number, y: number, extra: Record<string, unknown> = {}) => ({
  spawn: { initialDelay: 0.05, interval: 9999, openingSequence: [kind], points: [{ x, y }] },
  ...extra,
});

const dist = (a: Ship, b: Ship) => Math.hypot(a.x - b.x, a.y - b.y);

/** Island colliders (see src/game/arena/arenaMap.ts). */
const ISLANDS = [
  { minX: 268, minY: 76, maxX: 500, maxY: 308 },
  { minX: 972, minY: 76, maxX: 1140, maxY: 244 },
  { minX: 844, minY: 524, maxX: 1204, maxY: 756 },
  { minX: 204, minY: 652, maxX: 372, maxY: 756 },
];
const insideIsland = (s: Ship) => ISLANDS.some((r) => s.x > r.minX + 8 && s.x < r.maxX - 8 && s.y > r.minY + 8 && s.y < r.maxY - 8);

test.describe('Chaser and Shooter behaviour, spawn interval', () => {
  test('a chaser hunts the player, rams it, explodes and does not score @core', async ({ page, game }) => {
    await initApp(page, { overrides: single('chaser', 1300, 460) });
    await game.open();
    await game.start();
    await game.advance(200);
    let s = await game.state();
    expect(s.enemies).toHaveLength(1);
    const d0 = dist(s.enemies[0]!, s.player);
    await game.advance(2000);
    s = await game.state();
    expect(dist(s.enemies[0]!, s.player)).toBeLessThan(d0 - 150);

    // Chasers occasionally lose interest for a moment (temperament), so allow time.
    for (let i = 0; i < 80 && s.enemies.length > 0; i++) {
      await game.advance(250);
      s = await game.state();
    }
    expect(s.enemies).toHaveLength(0);
    expect(s.player.hp).toBe(88); // impactDamage 12
    expect(s.score).toBe(0);
    await expect(page.getByTestId('hud-health')).toHaveText('88 / 100');
  });

  test('a chaser sails around an island instead of through it', async ({ page, game }) => {
    // Straight line from (1500, 640) to the player crosses the palm island.
    await initApp(page, { overrides: single('chaser', 1500, 640) });
    await game.open();
    await game.start();
    let s = await game.state();
    let reached = false;
    for (let i = 0; i < 80; i++) {
      await game.advance(250);
      s = await game.state();
      if (s.enemies.length === 0) {
        reached = true;
        break;
      }
      expect(insideIsland(s.enemies[0]!)).toBe(false);
    }
    expect(reached).toBe(true);
    expect(s.player.hp).toBe(88);
  });

  test('a shooter closes in, stops at range and fires at the player @core', async ({ page, game }) => {
    await initApp(page, { overrides: single('shooter', 1250, 460) });
    await game.open();
    await game.start();
    await game.advance(200);
    let s = await game.state();
    const d0 = dist(s.enemies[0]!, s.player);
    expect(d0).toBeGreaterThan(420); // out of attack range: no shots yet
    expect(s.projectiles).toHaveLength(0);

    let sawEnemyBall = false;
    for (let i = 0; i < 60; i++) {
      await game.advance(200);
      s = await game.state();
      if (s.projectiles.some((p) => p.owner === 'enemy')) sawEnemyBall = true;
    }
    const d1 = dist(s.enemies[0]!, s.player);
    expect(d1).toBeLessThan(420);
    expect(d1).toBeGreaterThan(150); // keeps its distance instead of ramming
    expect(sawEnemyBall).toBe(true);
    expect(s.player.hp).toBeLessThan(100);
    expect(s.player.hp % 6).toBe(100 % 6); // only whole 6-damage hits
  });

  test('enemies take damage and destroyed ones stop interacting', async ({ page, game }) => {
    await initApp(page, { overrides: single('shooter', 830, 460, { shooter: { maxSpeed: 0, turnSpeed: 0 } }) });
    await game.open();
    await game.start();
    await game.advance(100);
    await game.hold('Space', 1000);
    await game.advance(1200);
    let s = await game.state();
    expect(s.enemies).toHaveLength(0);
    const hp = s.player.hp;
    // Nothing left to shoot at the player.
    await game.advance(4000);
    s = await game.state();
    expect(s.projectiles.filter((p) => p.owner === 'enemy')).toHaveLength(0);
    expect(s.player.hp).toBe(hp);
  });

  test('spawns follow the configured interval, far from the player, with both types', async ({ page, game }) => {
    await initApp(page, { settings: { sessionTime: 120, spawnInterval: 2 } });
    await game.open();
    await game.start();
    const total = async () => {
      const s = await game.state();
      return s.spawned.chaser + s.spawned.shooter;
    };
    await game.advance(1400);
    expect(await total()).toBe(0); // first spawn after 1.5 s
    await game.advance(200);
    expect(await total()).toBe(1);
    let s = await game.state();
    expect(dist(s.enemies[0]!, s.player)).toBeGreaterThanOrEqual(480);
    await game.advance(2000);
    expect(await total()).toBe(2);
    s = await game.state();
    expect(s.spawned).toEqual({ chaser: 1, shooter: 1 });
    const newest = s.enemies.reduce((a, b) => (a.age < b.age ? a : b));
    expect(dist(newest, s.player)).toBeGreaterThanOrEqual(480);
    await game.advance(4000);
    expect(await total()).toBe(4);
  });
});
