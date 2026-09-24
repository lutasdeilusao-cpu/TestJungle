import { expect, initApp, NO_ENEMIES, SITTING_DUCK, test } from './fixtures';

/**
 * Visual regression with versioned baselines (e2e/__screenshots__/<project>/).
 * Everything on screen is deterministic: fixed profile and settings, seeded
 * simulation, manual clock, fixed fixture dates, no animations.
 * Update with: npm run test:e2e:update
 */
test.describe('Visual regression', () => {
  test('main menu @core', async ({ page, game }) => {
    await initApp(page);
    await game.open();
    await page.evaluate(() => document.fonts.ready);
    await page.getByTestId('play-button').blur();
    await expect(page).toHaveScreenshot('menu.png', { fullPage: true });
  });

  test('arena in a stable state @core', async ({ page, game }) => {
    await initApp(page, {
      overrides: {
        ...NO_ENEMIES,
      },
    });
    await game.open();
    await game.start();
    // Sail a little, leaving a wake, then let everything settle.
    await game.hold('KeyW', 800);
    await game.hold('KeyD', 300);
    await game.advance(1200);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('arena.png');
  });

  test('result screen @core', async ({ page, game }) => {
    await initApp(page, { settings: { sessionTime: 60, spawnInterval: 3 }, overrides: SITTING_DUCK });
    await game.open();
    await game.playToEnd();
    await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'saved');
    await page.getByTestId('play-again-button').blur();
    await expect(page).toHaveScreenshot('result.png');
  });
});
