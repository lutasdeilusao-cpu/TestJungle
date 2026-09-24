import { expect, initApp, NO_ENEMIES, test } from './fixtures';

test.describe('Manual and automatic pause, resume without catch-up', () => {
  test.beforeEach(async ({ page }) => initApp(page, { overrides: NO_ENEMIES }));

  test('Escape pauses: clock, cooldowns and simulation are suspended @core', async ({ page, game }) => {
    await game.open();
    await game.start();
    await game.hold('KeyW', 1000);
    await game.tap('Space');
    const before = await game.state();

    await page.keyboard.press('Escape');
    const dialog = page.getByTestId('pause-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('resume-button')).toBeFocused();
    await game.advance(5000);
    const paused = await game.state();
    expect(paused.session.status).toBe('paused');
    expect(paused.elapsed).toBe(before.elapsed);
    expect(paused.player.x).toBe(before.player.x);
    expect(paused.player.cooldowns.front).toBe(before.player.cooldowns.front);
    expect(paused.projectiles).toEqual(before.projectiles);
    await expect(page.getByTestId('hud-time')).toHaveText('01:59');

    await page.getByTestId('resume-button').click();
    await expect(dialog).toBeHidden();
    await game.waitForStatus('running');
    await game.advance(1000);
    expect((await game.state()).elapsed).toBeCloseTo(before.elapsed + 1, 3);
  });

  test('held keys do not carry over a pause', async ({ page, game }) => {
    await game.open();
    await game.start();
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    await game.advance(500);
    const shotsBefore = (await game.state()).projectiles.length;
    await page.keyboard.press('Escape');
    await game.advance(3000);
    await page.getByTestId('resume-button').click();
    await game.waitForStatus('running');
    // Keys are still physically down, but no new keydown arrived after resuming.
    const resumed = await game.state();
    await game.advance(1000);
    const after = await game.state();
    expect(after.player.speed).toBeLessThan(resumed.player.speed);
    expect(after.projectiles.length).toBeLessThanOrEqual(shotsBefore);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('Space');
  });

  test('losing window focus pauses automatically and waits for the player @core', async ({ page, game }) => {
    await game.open();
    await game.start();
    await game.advance(1000);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.getByTestId('pause-dialog')).toBeVisible();
    await expect(page.getByTestId('pause-dialog')).toContainText('lost focus');
    expect((await game.state()).session.pauseReason).toBe('blur');
    const elapsed = (await game.state()).elapsed;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await game.advance(2000);
    expect((await game.state()).elapsed).toBe(elapsed); // regaining focus alone does not resume
    await page.keyboard.press('KeyP');
    await game.waitForStatus('running');
  });

  test('hiding the tab pauses automatically', async ({ page, game }) => {
    await game.open();
    await game.start();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await game.waitForStatus('paused');
    expect((await game.state()).session.pauseReason).toBe('hidden');
    await page.keyboard.press('Escape');
    await game.waitForStatus('running');
  });

  test('pause button in the HUD and the real-time clock', async ({ page, game }) => {
    await game.open();
    await page.evaluate(() => localStorage.setItem('pb.test.clock', 'realtime'));
    await game.start();
    // Timings are measured with the page clock: the test runner itself may be starved under load.
    const sample = () => page.evaluate(() => ({ now: performance.now() / 1000, elapsed: (window.__PIRATE__!.state() as { elapsed: number }).elapsed }));
    const a = await sample();
    await page.waitForTimeout(1000);
    const b = await sample();
    expect(b.elapsed - a.elapsed).toBeGreaterThan(0.2);
    expect(b.elapsed - a.elapsed).toBeLessThanOrEqual(b.now - a.now + 0.05);

    await page.getByTestId('pause-button').click();
    await game.waitForStatus('paused');
    const p1 = await sample();
    await page.waitForTimeout(1500);
    const p2 = await sample();
    expect(p2.elapsed).toBe(p1.elapsed);

    await page.getByTestId('resume-button').click();
    await game.waitForStatus('running');
    const r1 = await sample();
    await page.waitForTimeout(600);
    const r2 = await sample();
    // Resumed from where it stopped: the paused time was not replayed.
    expect(r1.elapsed - p2.elapsed).toBeLessThan(0.3);
    expect(r2.elapsed - r1.elapsed).toBeLessThanOrEqual(r2.now - r1.now + 0.05);
  });
});
