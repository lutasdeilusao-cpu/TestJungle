import { expect, initApp, test } from './fixtures';

// Asset requests must reach Playwright's router: with the MSW service worker
// active they would be fetched by the worker instead. The ranking/history
// mocks are not needed here.
test.use({ serviceWorkers: 'block' });

test.describe('Asset loading, failures and retry', () => {
  test('shows loading progress, then the arena @core', async ({ page, game }) => {
    await initApp(page);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/assets/atlas/ui*.png', async (route) => {
      await gate;
      await route.continue();
    });
    await game.open();
    await page.getByTestId('play-button').click();
    const loading = page.getByTestId('loading-overlay');
    await expect(loading).toBeVisible();
    await expect(loading.getByRole('progressbar', { name: 'Loading assets' })).toBeVisible();
    release();
    await expect(loading).toBeHidden();
    await game.waitForStatus('running');
    await expect(page.getByTestId('hud')).toBeVisible();
  });

  test('a failed texture shows an error, retry loads the game @core', async ({ page, game }) => {
    await initApp(page);
    let fail = true;
    await page.route('**/assets/atlas/ships.png', (route) => (fail ? route.abort('failed') : route.continue()));
    await game.open();
    await page.getByTestId('play-button').click();
    const error = page.getByTestId('load-error');
    await expect(error).toBeVisible();
    await expect(error.getByRole('alertdialog')).toContainText('The fleet could not be loaded');
    await expect(page.getByTestId('load-retry')).toBeFocused();
    // The match never started: no HUD, no simulation time.
    await expect(page.getByTestId('hud')).toHaveCount(0);

    fail = false;
    await page.getByTestId('load-retry').click();
    await game.waitForStatus('running');
    await expect(page.getByTestId('hud')).toBeVisible();
    expect((await game.state()).elapsed).toBe(0);
  });

  test('textures are loaded once and reused by the next match', async ({ page, game }) => {
    await initApp(page);
    const atlasRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/assets/atlas/')) atlasRequests.push(r.url());
    });
    await game.open();
    await game.start();
    const first = atlasRequests.length;
    expect(first).toBeGreaterThanOrEqual(6); // 3 JSON + 3 PNG
    await page.keyboard.press('Escape');
    await page.getByTestId('restart-button').click();
    await game.waitForStatus('running');
    await page.keyboard.press('Escape');
    await page.getByTestId('exit-button').click();
    await game.start();
    expect(atlasRequests.length).toBe(first);
  });

  test('leaving during loading cancels the match cleanly', async ({ page, game, consoleErrors }) => {
    await initApp(page);
    await page.route('**/assets/atlas/tiles*.png', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue().catch(() => undefined);
    });
    await game.open();
    await page.getByTestId('play-button').click();
    await expect(page.getByTestId('loading-overlay')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await page.waitForTimeout(2000);
    expect(await page.evaluate(() => window.__PIRATE__!.hasSession())).toBe(false);
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(consoleErrors.filter((e) => !/Failed to load|net::/.test(e))).toEqual([]);
  });
});
