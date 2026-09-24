import { expect, initApp, test } from './fixtures';

/**
 * A stationary, harmless shooter straight ahead of the player (500 px east).
 * Only its movement/attack stats are neutralised; hits, damage and scoring
 * run through the normal rules.
 */
const TARGET = {
  spawn: { initialDelay: 0.05, interval: 9999, openingSequence: ['shooter'], points: [{ x: 830, y: 460 }] },
  shooter: { maxSpeed: 0, turnSpeed: 0, attackRange: 0 },
};

test.describe('Front and broadside cannons, damage, cooldowns and score', () => {
  test.beforeEach(async ({ page }) => initApp(page, { overrides: TARGET }));

  test('bow cannon fires a single ball forward and respects its cooldown @core', async ({ game }) => {
    await game.open();
    await game.setOverrides({ spawn: { initialDelay: 9999 } });
    await game.start();
    await game.tap('Space');
    let s = await game.state();
    const balls = s.projectiles.filter((p) => p.owner === 'player');
    expect(balls).toHaveLength(1);
    expect(balls[0]!.x).toBeGreaterThan(s.player.x);
    expect(balls[0]!.y).toBeCloseTo(s.player.y, 0);
    expect(s.player.cooldowns.front).toBeGreaterThan(0.4);

    // Still cooling down: another press does not fire.
    await game.tap('Space');
    expect((await game.state()).projectiles.filter((p) => p.owner === 'player')).toHaveLength(1);

    // Holding the trigger fires once per cooldown (0.45 s): at 0, 0.45 and 0.9 s.
    await game.advance(500);
    const before = new Set((await game.state()).projectiles.map((p) => p.id));
    await game.hold('Space', 950);
    s = await game.state();
    const fresh = s.projectiles.filter((p) => p.owner === 'player' && !before.has(p.id));
    expect(fresh).toHaveLength(3);
  });

  test('broadsides fire three parallel balls to each side @core', async ({ game }) => {
    await game.open();
    await game.setOverrides({ spawn: { initialDelay: 9999 } });
    await game.start();
    const { player } = await game.state();
    await game.tap('KeyQ');
    await game.advance(150);
    let s = await game.state();
    const port = s.projectiles.filter((p) => p.owner === 'player');
    expect(port).toHaveLength(3);
    // Heading is east, so port (left) is north: all balls above the ship, on one line, spread along the hull.
    for (const b of port) expect(b.y).toBeLessThan(player.y - 20);
    expect(new Set(port.map((b) => Math.round(b.y))).size).toBe(1);
    expect(new Set(port.map((b) => Math.round(b.x))).size).toBe(3);

    await game.tap('KeyE');
    await game.advance(150);
    s = await game.state();
    const starboard = s.projectiles.filter((p) => p.owner === 'player' && p.y > player.y);
    expect(starboard).toHaveLength(3);
    // Each side has its own cooldown.
    expect(s.player.cooldowns.left).toBeGreaterThan(0.9);
    expect(s.player.cooldowns.right).toBeGreaterThan(1.1);
    await game.tap('KeyE');
    expect((await game.state()).projectiles.filter((p) => p.owner === 'player' && p.y > player.y)).toHaveLength(3);
  });

  test('each ball damages once, and a sunk enemy scores exactly one point @core', async ({ page, game }) => {
    await game.open();
    await game.start();
    await game.advance(100);
    const [target] = (await game.state()).enemies;
    expect(target).toMatchObject({ kind: 'shooter', hp: 60 });

    await game.tap('Space');
    await game.advance(1100); // travel time + ball removed on hit
    let s = await game.state();
    expect(s.enemies[0]!.hp).toBe(40);
    expect(s.projectiles).toHaveLength(0);

    // Two more hits sink it.
    await game.hold('Space', 500);
    await game.advance(1200);
    s = await game.state();
    expect(s.enemies).toHaveLength(0);
    expect(s.score).toBe(1);
    await expect(page.getByTestId('hud-score')).toHaveText('1');

    // Firing on at an empty sea never changes the score.
    await game.hold(['Space', 'KeyQ', 'KeyE'], 3000);
    await game.advance(1500);
    expect((await game.state()).score).toBe(1);
  });

  test('balls stop at islands and expire after their range', async ({ game }) => {
    await game.open();
    await game.setOverrides({ spawn: { initialDelay: 9999 } });
    await game.start();
    await game.aimAt(384, 0); // fort island is north
    await game.tap('Space');
    await game.advance(300);
    expect((await game.state()).projectiles).toHaveLength(0); // hit the shore (~150 px away)

    await game.aimAt(1600, 460);
    await game.tap('Space');
    await game.advance(900);
    expect((await game.state()).projectiles).toHaveLength(1);
    await game.advance(300); // range 520 px / 520 px/s
    expect((await game.state()).projectiles).toHaveLength(0);
  });
});
