import { expect, initApp, test } from './fixtures';

test.describe('Options: navigation, validation and persistence', () => {
  test.beforeEach(async ({ page }) => initApp(page));

  test('navigates to Options and back with the keyboard @core', async ({ page, game }) => {
    await game.open();
    await expect(page.getByTestId('play-button')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('options-button')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/options$/);
    await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
    await page.getByTestId('options-back').click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
  });

  test('rejects out-of-range and malformed values with accessible errors', async ({ page, game }) => {
    await game.open('/#/options');
    const session = page.getByTestId('session-time-input');
    const spawn = page.getByTestId('spawn-interval-input');

    await session.fill('45');
    await spawn.fill('0');
    await page.getByTestId('options-save').click();
    await expect(page.getByTestId('session-time-error')).toHaveText('Must be between 60 and 180 seconds.');
    await expect(page.getByTestId('spawn-interval-error')).toHaveText('Enter a positive number of seconds.');
    await expect(session).toHaveAttribute('aria-invalid', 'true');
    await expect(session).toBeFocused();

    await session.fill('abc');
    await spawn.fill('11');
    await page.getByTestId('options-save').click();
    await expect(page.getByTestId('session-time-error')).toHaveText('Enter a whole number of seconds.');
    await expect(page.getByTestId('spawn-interval-error')).toHaveText('Must be between 1 and 10 seconds.');

    await spawn.fill('2.3');
    await session.fill('90');
    await page.getByTestId('options-save').click();
    await expect(page.getByTestId('spawn-interval-error')).toHaveText('Use steps of 0.5 seconds.');

    // Nothing invalid was persisted.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pb.settings.v1') ?? '{}'));
    expect(stored).toMatchObject({ sessionTime: 120, spawnInterval: 3 });
  });

  test('steppers respect the limits', async ({ page, game }) => {
    await game.open('/#/options');
    const inc = page.getByRole('button', { name: 'Increase game session time' });
    for (let i = 0; i < 8; i++) if (await inc.isEnabled()) await inc.click();
    await expect(page.getByTestId('session-time-input')).toHaveValue('180');
    await expect(inc).toBeDisabled();
    const dec = page.getByRole('button', { name: 'Decrease enemy spawn time' });
    for (let i = 0; i < 6; i++) if (await dec.isEnabled()) await dec.click();
    await expect(page.getByTestId('spawn-interval-input')).toHaveValue('1');
    await expect(dec).toBeDisabled();
  });

  test('saves valid options and keeps them after a refresh @core', async ({ page, game }) => {
    await game.open('/#/options');
    await page.getByTestId('session-time-input').fill('150');
    await page.getByTestId('spawn-interval-input').fill('4.5');
    await page.getByTestId('captain-name-input').fill('Captain Nemo');
    await expect(page.getByTestId('options-status')).toHaveText('You have unsaved changes.');
    await page.getByTestId('options-save').click();
    await expect(page.getByTestId('options-status')).toHaveText('Options saved.');

    await page.reload();
    await expect(page.getByTestId('session-time-input')).toHaveValue('150');
    await expect(page.getByTestId('spawn-interval-input')).toHaveValue('4.5');
    await expect(page.getByTestId('captain-name-input')).toHaveValue('Captain Nemo');

    await page.getByTestId('options-back').click();
    await expect(page.getByText('Captain Nemo · 150 s battle · 4.5 s spawns')).toBeVisible();
  });

  test('a match uses the options saved when it starts', async ({ page, game }) => {
    await game.open('/#/options');
    await page.getByTestId('session-time-input').fill('60');
    await page.getByTestId('options-save').click();
    await page.getByTestId('options-back').click();
    await game.start();
    await expect(page.getByTestId('hud-time')).toHaveText('01:00');
    expect((await game.state()).remaining).toBe(60);
  });
});
