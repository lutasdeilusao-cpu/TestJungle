import { expect, initApp, test } from './fixtures';

/**
 * Beyond the brief: power-ups dropped by every sunk enemy (permanent, stacking,
 * reset per match) and waves that need 2, 4, 6... kills.
 * Stationary harmless shooters spawn 500 px ahead of the player, one at a time.
 */
const DUCKS = (upgrade: 'damage' | 'fireRate' | 'spread') => ({
  spawn: { initialDelay: 0.05, maxAlive: 1, openingSequence: ['shooter'], weights: { chaser: 0, shooter: 1 }, points: [{ x: 830, y: 460 }] },
  shooter: { maxSpeed: 0, turnSpeed: 0, attackRange: 0 },
  powerUps: { weights: { damage: upgrade === 'damage' ? 1 : 0, fireRate: upgrade === 'fireRate' ? 1 : 0, spread: upgrade === 'spread' ? 1 : 0, repair: 0 } },
});

// Keep every duck a standard shooter (variants would move or shoot sideways).
const STANDARD_ONLY = {
  spawn: {
    variants: {
      shooter: { standard: { weight: 1 }, flanker: { weight: 0 }, sentinel: { weight: 0 } },
    },
  },
};

const overrides = (upgrade: 'damage' | 'fireRate' | 'spread') => {
  const d = DUCKS(upgrade);
  return { ...d, spawn: { ...d.spawn, ...STANDARD_ONLY.spawn }, waves: { maxAlivePerWave: 0 } };
};

test.describe('Power-ups and waves', () => {
  test('a sunk enemy drops a power-up that stacks permanently when collected @core', async ({ page, game }) => {
    await initApp(page, { settings: { sessionTime: 120, spawnInterval: 3 }, overrides: overrides('fireRate') });
    await game.open();
    await game.start();
    await game.advance(100);
    await game.hold('Space', 1000);
    await game.advance(1200);
    let s = await game.state();
    expect(s.score).toBe(1);
    expect(s.powerUps).toHaveLength(1);
    expect(s.powerUps[0]).toMatchObject({ kind: 'fireRate' });
    expect(s.upgrades.fireRate).toBe(0);

    // Sail over it.
    await game.hold('KeyW', 3500);
    s = await game.state();
    expect(s.powerUps).toHaveLength(0);
    expect(s.upgrades.fireRate).toBe(1);
    await expect(page.getByTestId('hud-upgrade-fireRate')).toContainText('×1');
    await expect(page.getByTestId('hud-notice')).toContainText('Quick reload');

    // The upgrade is permanent: reload is faster from now on.
    await game.tap('Space');
    const cooldown = (await game.state()).player.cooldowns.front;
    expect(cooldown).toBeLessThan(0.45 / 1.05);
  });

  test('clearing a wave rewards the player and raises the next target @core', async ({ page, game }) => {
    await initApp(page, { settings: { sessionTime: 60, spawnInterval: 3 }, overrides: overrides('damage') });
    await game.open();
    await game.start();
    await expect(page.getByTestId('hud-wave')).toHaveText('Wave 1 · 0/2');
    let s = await game.state();
    for (let i = 0; i < 40 && s.wave === 1; i++) {
      await game.hold('Space', 500);
      s = await game.state();
    }
    expect(s.wave).toBe(2);
    expect(s.score).toBe(2);
    expect(s.waveKills).toBe(0);
    expect(s.waveTarget).toBe(4);
    // Reward: a free upgrade (the only enabled kind is damage).
    expect(s.upgrades.damage).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId('hud-wave')).toHaveText('Wave 2 · 0/4');
    await expect(page.getByTestId('hud-notice')).toContainText('Wave 1 cleared!');

    await game.advance(62_000);
    await expect(page.getByTestId('result-screen')).toBeVisible();
    await expect(page.getByTestId('result-waves')).toContainText(/\d+ waves? cleared/);
    await page.getByTestId('result-menu-button').click();
    await page.getByTestId('history-button').click();
    await expect(page.getByTestId('history-row')).toHaveCount(1);
  });

  test('upgrades and waves reset when a new match starts', async ({ page, game }) => {
    await initApp(page, { settings: { sessionTime: 120, spawnInterval: 3 }, overrides: overrides('spread') });
    await game.open();
    await game.start();
    let s = await game.state();
    for (let i = 0; i < 40 && s.wave === 1; i++) {
      await game.hold('Space', 500);
      s = await game.state();
    }
    expect(s.wave).toBe(2);
    expect(s.upgrades.spread).toBeGreaterThanOrEqual(1);

    await page.keyboard.press('Escape');
    await page.getByTestId('restart-button').click();
    await game.waitForStatus('running');
    s = await game.state();
    expect(s).toMatchObject({ wave: 1, waveKills: 0, waveTarget: 2, upgrades: { damage: 0, fireRate: 0, spread: 0 } });
    expect(s.powerUps).toHaveLength(0);
    await expect(page.getByTestId('hud-wave')).toHaveText('Wave 1 · 0/2');
    await expect(page.getByTestId('hud-upgrades')).toHaveCount(0);
  });
});
