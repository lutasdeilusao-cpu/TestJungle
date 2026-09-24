import { expect, initApp, NO_ENEMIES, test } from './fixtures';

test.describe('Movement, rotation, arena limits and island collisions', () => {
  test.beforeEach(async ({ page }) => initApp(page, { overrides: NO_ENEMIES }));

  test('starts a match with full health and the configured time @core', async ({ page, game }) => {
    await game.open();
    await game.start();
    const s = await game.state();
    expect(s.player).toMatchObject({ hp: 100, maxHp: 100, speed: 0 });
    expect(s.score).toBe(0);
    await expect(page.getByTestId('hud-health')).toHaveText('100 / 100');
    await expect(page.getByTestId('hud-score')).toHaveText('0');
    await expect(page.getByTestId('hud-time')).toHaveText('02:00');
    await expect(page.getByTestId('game-canvas')).toBeVisible();
  });

  test('sails forward along the heading and rotates both ways @core', async ({ game }) => {
    await game.open();
    await game.start();
    const start = (await game.state()).player;

    await game.hold('KeyW', 1000);
    const moved = (await game.state()).player;
    expect(moved.x - start.x).toBeGreaterThan(80); // heading 0 = east
    expect(Math.abs(moved.y - start.y)).toBeLessThan(1);

    await game.hold('KeyA', 500);
    const left = (await game.state()).player;
    expect(left.heading).toBeCloseTo(start.heading - 2.6 * 0.5, 1);

    await game.hold('ArrowRight', 1000);
    const right = (await game.state()).player;
    expect(right.heading).toBeCloseTo(left.heading + 2.6, 1);

    // Releasing the throttle: the ship slows down and stops.
    await game.advance(2000);
    expect((await game.state()).player.speed).toBe(0);
  });

  test('moves and rotates at the same time', async ({ game }) => {
    await game.open();
    await game.start();
    const a = (await game.state()).player;
    await game.hold(['KeyW', 'KeyD'], 800);
    const b = (await game.state()).player;
    expect(b.heading).toBeGreaterThan(a.heading + 1);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(40);
  });

  test('cannot sail through an island @core', async ({ game }) => {
    await game.open();
    await game.start();
    // Fort island collider: x 268..500, y 76..308. The player starts at (330, 460) facing east.
    await game.aimAt(330, 0);
    await game.hold('KeyW', 5000);
    const p = (await game.state()).player;
    expect(p.y).toBeGreaterThan(308); // stopped against the south shore
    expect(p.y).toBeLessThan(380);
  });

  test('stays inside the visible arena', async ({ game }) => {
    await game.open();
    await game.start();
    await game.aimAt(0, 460);
    await game.hold('KeyW', 5000);
    let p = (await game.state()).player;
    expect(p.x).toBeGreaterThan(15);
    expect(p.x).toBeLessThan(60);

    await game.aimAt(p.x, 900);
    await game.hold('KeyW', 6000);
    p = (await game.state()).player;
    expect(p.y).toBeLessThan(900 - 15);
    expect(p.y).toBeGreaterThan(820);
  });
});
