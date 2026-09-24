import { expect, initApp, NO_ENEMIES, test, unexpectedErrors } from './fixtures';

test.describe('Abandoning matches, repeated navigation and touch controls', () => {
  test('leaving from the pause menu abandons the match without recording it @core', async ({ page, game }) => {
    await initApp(page);
    await game.open();
    await game.start();
    await game.hold(['KeyW', 'Space'], 5000);
    await page.keyboard.press('Escape');
    await page.getByTestId('exit-button').click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    expect(await page.evaluate(() => window.__PIRATE__!.hasSession())).toBe(false);
    await expect(page.getByTestId('last-result-summary')).toHaveCount(0);
    await expect(page.getByTestId('pending-banner')).toHaveCount(0);

    await page.getByTestId('history-button').click();
    await expect(page.getByTestId('history-empty')).toBeVisible();
  });

  test('a refresh during combat ends the match and lands on the menu', async ({ page, game }) => {
    await initApp(page);
    await game.open();
    await game.start();
    await game.advance(3000);
    await page.reload();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await expect(page).toHaveURL(/#\/$/);
    expect(await page.evaluate(() => localStorage.getItem('pb.pending.v1'))).toBeNull();
  });

  test('the browser back button leaves combat and tears the match down', async ({ page, game }) => {
    await initApp(page);
    await game.open();
    await game.start();
    await page.goBack();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    expect(await page.evaluate(() => window.__PIRATE__!.hasSession())).toBe(false);
    await page.goForward();
    await expect(page.getByTestId('main-menu')).toBeVisible(); // no zombie match on #/play
  });

  test('repeated navigation between screens stays clean', async ({ page, game, consoleErrors }) => {
    await initApp(page, { overrides: NO_ENEMIES });
    await game.open();
    for (let i = 0; i < 5; i++) {
      await game.start();
      await game.hold('KeyW', 500);
      await page.keyboard.press('Escape');
      await page.getByTestId('exit-button').click();
      await expect(page.getByTestId('main-menu')).toBeVisible();
      await page.getByTestId('options-button').click();
      await page.getByTestId('options-back').click();
      await page.getByTestId('ranking-button').click();
      await expect(page.getByTestId('ranking-table')).toBeVisible();
      await page.getByTestId('log-back').click();
    }
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await page.evaluate(() => window.__PIRATE__!.hasSession())).toBe(false);
    await game.start();
    await expect(page.locator('canvas')).toHaveCount(1);
    expect(unexpectedErrors(consoleErrors)).toEqual([]);
  });

  test('game keys are only captured during gameplay', async ({ page, game }) => {
    await initApp(page);
    await game.open('/#/options');
    const name = page.getByTestId('captain-name-input');
    await name.fill('');
    await name.pressSequentially('Wade Q Easy');
    await expect(name).toHaveValue('Wade Q Easy'); // W, A, D, Q, E and Space typed normally
  });

  test('touch controls steer and fire, also simultaneously @core', async ({ page, game }) => {
    await initApp(page, { overrides: NO_ENEMIES });
    await game.open();
    await game.start();
    await expect(page.getByTestId('touch-controls')).toBeVisible();
    const start = (await game.state()).player;

    const press = (id: string, pointerId: number) =>
      page.getByTestId(id).dispatchEvent('pointerdown', { pointerId, pointerType: 'touch', isPrimary: pointerId === 1, button: 0 });
    const release = (id: string, pointerId: number) =>
      page.getByTestId(id).dispatchEvent('pointerup', { pointerId, pointerType: 'touch', button: 0 });

    // Two fingers: sail forward and fire the bow cannon at the same time.
    await press('touch-thrust', 1);
    await press('touch-fireFront', 2);
    await game.advance(1000);
    let s = await game.state();
    expect(s.player.x - start.x).toBeGreaterThan(80);
    expect(s.projectiles.filter((p) => p.owner === 'player').length).toBeGreaterThanOrEqual(2);
    await release('touch-fireFront', 2);

    // Steering with a third finger while still sailing.
    await press('touch-turnRight', 3);
    await game.advance(500);
    await release('touch-turnRight', 3);
    await release('touch-thrust', 1);
    s = await game.state();
    expect(s.player.heading).toBeGreaterThan(1);

    // A quick tap fires one broadside.
    await game.advance(2000);
    const before = (await game.state()).projectiles.length;
    await page.getByTestId('touch-fireLeft').tap().catch(async () => {
      await press('touch-fireLeft', 4);
      await release('touch-fireLeft', 4);
    });
    await game.advance(20);
    expect((await game.state()).projectiles.length).toBe(before + 3);
  });
});
