import { expect, initApp, test } from './fixtures';

test.describe('Match end by time and by death, frozen simulation, clean restart', () => {
  test('ends when the time runs out and freezes the world @core', async ({ page, game }) => {
    // Enemies keep spawning and attacking, but harmlessly, so the player survives to the end.
    await initApp(page, {
      settings: { sessionTime: 60, spawnInterval: 3 },
      overrides: { chaser: { impactDamage: 0 }, shooter: { weapon: { damage: 0 } } },
    });
    await game.open();
    await game.start();
    await game.hold('KeyD', 59_000);
    await expect(page.getByTestId('hud-time')).toHaveText('00:01');
    await game.advance(1000);
    let s = await game.state();
    expect(s.status).toBe('ended');
    expect(s.endReason).toBe('time_up');
    expect(s.elapsed).toBeCloseTo(60, 2);
    expect(s.session.status).toBe('ending');
    await expect(page.getByTestId('hud-time')).toHaveText('00:00');

    // During the end animation nothing moves, fires, spawns or scores.
    const frozen = s;
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    await game.advance(1000);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('Space');
    s = await game.state();
    expect(s.player.x).toBe(frozen.player.x);
    expect(s.enemies.map((e) => [e.x, e.y])).toEqual(frozen.enemies.map((e) => [e.x, e.y]));
    expect(s.projectiles).toEqual(frozen.projectiles);
    expect(s.spawned).toEqual(frozen.spawned);
    expect(s.score).toBe(frozen.score);

    await game.advance(1000);
    await expect(page.getByTestId('result-screen')).toBeVisible();
    await expect(page.getByTestId('result-reason')).toHaveText('Time up');
    await expect(page.getByTestId('result-duration')).toHaveText('01:00');
  });

  test('ends when the player is sunk @core', async ({ page, game }) => {
    await initApp(page, {
      overrides: {
        player: { maxHealth: 10 }, // one ram (12) sinks it
        spawn: { initialDelay: 0.05, interval: 9999, openingSequence: ['chaser'], points: [{ x: 1000, y: 460 }] },
      },
    });
    await game.open();
    await game.start();
    let s = await game.state();
    for (let i = 0; i < 80 && s.status === 'running'; i++) {
      await game.advance(250);
      s = await game.state();
    }
    expect(s.status).toBe('ended');
    expect(s.endReason).toBe('defeated');
    expect(s.player.hp).toBe(0);
    const elapsed = s.elapsed;
    await game.advance(1000); // end animation (1.6 s) still running
    expect((await game.state()).elapsed).toBe(elapsed); // clock stopped
    await game.advance(1000);
    await expect(page.getByTestId('result-screen')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ship Sunk' })).toBeVisible();
    await expect(page.getByTestId('result-reason')).toHaveText('Defeated');
  });

  test('restart creates a brand new match', async ({ page, game }) => {
    await initApp(page);
    await game.open();
    await game.start();
    await game.hold(['KeyW', 'KeyD', 'Space'], 6000);
    let s = await game.state();
    expect(s.elapsed).toBeGreaterThan(5.9);
    expect(s.spawned.chaser + s.spawned.shooter).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await page.getByTestId('restart-button').click();
    await game.waitForStatus('running');
    s = await game.state();
    expect(s).toMatchObject({ elapsed: 0, score: 0, remaining: 120, spawned: { chaser: 0, shooter: 0 } });
    expect(s.player).toMatchObject({ x: 330, y: 460, heading: 0, hp: 100, speed: 0 });
    expect(s.enemies).toHaveLength(0);
    expect(s.projectiles).toHaveLength(0);
    await expect(page.getByTestId('hud-time')).toHaveText('02:00');
    await expect(page.getByTestId('hud-health')).toHaveText('100 / 100');
    // Only one canvas: the old scene was torn down, not stacked.
    await expect(page.locator('canvas')).toHaveCount(1);
  });

  test('Play Again from the result screen starts a fresh match', async ({ page, game }) => {
    await initApp(page, { settings: { sessionTime: 60, spawnInterval: 3 } });
    await game.open();
    await game.start();
    await game.advance(62_000);
    await expect(page.getByTestId('result-screen')).toBeVisible();
    await page.getByTestId('play-again-button').click();
    await game.waitForStatus('running');
    const s = await game.state();
    expect(s).toMatchObject({ elapsed: 0, score: 0, remaining: 60 });
  });
});
