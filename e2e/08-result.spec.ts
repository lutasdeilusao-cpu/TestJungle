import { expect, initApp, SITTING_DUCK, test } from './fixtures';

test.describe('Result screen and its persistence', () => {
  test.beforeEach(async ({ page }) => initApp(page, { settings: { sessionTime: 60, spawnInterval: 3 }, overrides: SITTING_DUCK }));

  test('shows score, time played, end reason and registration status @core', async ({ page, game }) => {
    await game.open();
    await game.playToEnd();
    await expect(page.getByRole('heading', { name: 'Battle Complete' })).toBeVisible();
    await expect(page.getByTestId('result-score')).toHaveText('1');
    await expect(page.getByTestId('result-duration')).toHaveText('01:00');
    await expect(page.getByTestId('result-reason')).toHaveText('Time up');
    await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'saved');
    await expect(page.getByTestId('play-again-button')).toBeFocused();
    await expect(page.getByTestId('result-menu-button')).toBeVisible();
  });

  test('keeps the last result after a refresh and on the main menu @core', async ({ page, game }) => {
    await game.open();
    await game.playToEnd();
    await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect(page.getByTestId('result-screen')).toBeVisible();
    await expect(page.getByTestId('result-score')).toHaveText('1');
    await expect(page.getByTestId('result-reason')).toHaveText('Time up');
    await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'saved');

    await page.getByTestId('result-menu-button').click();
    await expect(page.getByTestId('last-result-summary')).toHaveText('Last battle: 1 pts · 01:00 · Time up');
    await page.reload();
    await expect(page.getByTestId('last-result-summary')).toBeVisible();
  });

  test('without a completed match, #/result falls back to the menu', async ({ page }) => {
    await page.goto('/#/result');
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await expect(page).toHaveURL(/#\/$/);
  });
});
