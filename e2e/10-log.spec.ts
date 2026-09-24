import { expect, initApp, test } from './fixtures';

test.describe('Ranking and Match History: queries, pagination, loading, empty and error', () => {
  test('ranking is paginated, ordered by score and filtered by settings @core', async ({ page, game }) => {
    await initApp(page);
    await game.open();
    await page.getByTestId('ranking-button').click();
    await expect(page).toHaveURL(/#\/ranking$/);
    const rows = page.getByTestId('ranking-row');
    await expect(rows).toHaveCount(5);
    await expect(page.getByText('Page 1 of 3', { exact: true })).toBeVisible();
    const scores = await page.locator('[data-testid=ranking-row] .score').allInnerTexts();
    expect(scores.map(Number)).toEqual([...scores.map(Number)].sort((a, b) => b - a));
    await expect(rows.first().locator('td').first()).toHaveText('01');

    const firstPage = await rows.allInnerTexts();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('Page 2 of 3', { exact: true })).toBeVisible();
    await expect(rows.first().locator('td').first()).toHaveText('06');
    expect(await rows.allInnerTexts()).not.toEqual(firstPage);
    const lastOfPage1 = Number(firstPage[4]!.split('\t')[2]);
    const firstOfPage2 = Number(await rows.first().locator('.score').innerText());
    expect(firstOfPage2).toBeLessThanOrEqual(lastOfPage1);
    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(page.getByText('Page 1 of 3', { exact: true })).toBeVisible();

    // A different configuration is a different leaderboard.
    await page.getByTestId('ranking-bucket').selectOption('60|3');
    await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible();
  });

  test('tabs are keyboard operable and match history paginates @core', async ({ page, game }) => {
    await initApp(page, { scenario: 'many-pages' });
    await game.open('/#/ranking');
    await page.getByTestId('tab-ranking').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-history')).toBeFocused();
    await expect(page.getByTestId('tab-history')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/#\/history$/);
    await expect(page.getByTestId('history-row')).toHaveCount(5);
    await expect(page.getByText('Page 1 of 5', { exact: true })).toBeVisible();
    const dates = await page.locator('[data-testid=history-row] time').evaluateAll((els) => els.map((e) => e.getAttribute('datetime')!));
    expect(dates).toEqual([...dates].sort().reverse()); // newest first
    for (let p = 2; p <= 5; p++) await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('Page 5 of 5', { exact: true })).toBeVisible();
    await expect(page.getByTestId('history-row')).toHaveCount(3); // 23 records
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  test('shows a loading state while the API is slow', async ({ page, game }) => {
    await initApp(page, { scenario: 'slow', latencyScale: 1 });
    await game.open('/#/ranking');
    await expect(page.getByTestId('ranking-loading')).toBeVisible();
    await expect(page.getByTestId('ranking-table')).toBeVisible({ timeout: 10_000 });
    // Page change keeps the previous page on screen while the next one loads.
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByTestId('ranking-refreshing')).toHaveText('Loading page…');
    await expect(page.getByTestId('ranking-table')).toBeVisible();
    await expect(page.getByText('Page 2 of 3', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('shows empty states @core', async ({ page, game }) => {
    await initApp(page, { scenario: 'empty' });
    await game.open('/#/ranking');
    await expect(page.getByTestId('ranking-empty')).toBeVisible();
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('history-empty')).toBeVisible();
  });

  test('shows errors, keeps the other tab working and recovers on retry @core', async ({ page, game }) => {
    await initApp(page, { scenario: 'ranking-fails' });
    await game.open('/#/ranking');
    await expect(page.getByTestId('ranking-error')).toContainText('The ranking service is unavailable.', { timeout: 15_000 });
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('history-empty')).toBeVisible();

    // Back to a healthy server: retry recovers.
    await page.evaluate(() => localStorage.setItem('pb.mock.scenario', JSON.stringify('default')));
    await page.reload();
    await page.getByTestId('tab-ranking').click();
    await expect(page.getByTestId('ranking-table')).toBeVisible();
  });

  test('retry button refetches after a failure', async ({ page, game }) => {
    await initApp(page, { scenario: 'client-error' });
    await game.open('/#/history');
    // 4xx is not retried automatically: the error shows at once.
    await expect(page.getByTestId('history-error')).toContainText('The request was rejected.');
    await page.getByTestId('log-back').click();
    await page.getByTestId('network-lab-button').click();
    await page.getByTestId('scenario-default').check();
    await page.getByTestId('lab-close').click();
    await page.getByTestId('history-button').click();
    await expect(page.getByTestId('history-empty')).toBeVisible();
  });

  test('API failures never block the game', async ({ page, game }) => {
    await initApp(page, { scenario: 'network-error' });
    await game.open('/#/ranking');
    await expect(page.getByTestId('ranking-error')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('log-back').click();
    await game.start();
    await game.hold('KeyW', 1000);
    expect((await game.state()).player.x).toBeGreaterThan(400);
  });
});
