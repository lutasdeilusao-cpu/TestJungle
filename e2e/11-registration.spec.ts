import { expect, initApp, PLAYER, SITTING_DUCK, test } from './fixtures';

const SETTINGS = { sessionTime: 60, spawnInterval: 3 };

test.describe('Match registration, both tabs updated, pending records survive a refresh', () => {
  test('a completed match appears once in the ranking and in the history @core', async ({ page, game }) => {
    await initApp(page, { settings: SETTINGS, overrides: SITTING_DUCK });
    await game.open();
    // Visit both tabs first so they are cached, then check that they refresh.
    await page.getByTestId('ranking-button').click();
    await expect(page.getByTestId('ranking-table')).toBeVisible();
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('history-empty')).toBeVisible();
    await page.getByTestId('log-back').click();

    await game.playToEnd();
    await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'saved');
    await page.getByTestId('result-menu-button').click();

    await page.getByTestId('history-button').click();
    await expect(page.getByTestId('history-row')).toHaveCount(1);
    await expect(page.getByTestId('history-row')).toContainText('01:00');
    await expect(page.getByTestId('history-row')).toContainText('Time up');
    await expect(page.getByTestId('history-row')).toContainText('60 s / 3 s');
    const matchId = await page.getByTestId('history-row').getAttribute('data-match-id');

    await page.getByTestId('tab-ranking').click();
    await game.findRankingRow(matchId!);
    const mine = page.locator(`[data-testid=ranking-row][data-match-id="${matchId}"]`);
    await expect(mine).toHaveCount(1);
    await expect(mine).toContainText(PLAYER.name);
    await expect(mine).toContainText('You');
    await expect(mine).toHaveClass(/is-mine/);
  });

  test('a failed registration is kept, survives a refresh and is sent after recovery @core', async ({ page, game }) => {
    await initApp(page, { settings: SETTINGS, overrides: SITTING_DUCK, scenario: 'offline-on-submit' });
    await game.open();
    await game.playToEnd();
    await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'failed', { timeout: 15_000 });
    await expect(page.getByTestId('registration-status')).toContainText('Could not reach the server');

    // A new match can start while the record is pending.
    await page.getByTestId('play-again-button').click();
    await game.waitForStatus('running');
    await page.keyboard.press('Escape');
    await page.getByTestId('exit-button').click();

    await page.reload();
    await expect(page.getByTestId('pending-banner')).toContainText('1 battle is waiting to be recorded', { timeout: 15_000 });
    const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('pb.pending.v1') ?? '[]').length);
    expect(pending).toBe(1);

    // The server recovers: switch the scenario in the Network Lab and retry.
    // Wait until the automatic retries gave up, then heal the server and retry by hand.
    await expect(page.getByTestId('pending-retry')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('network-lab-button').click();
    await page.getByTestId('scenario-default').check();
    await page.getByTestId('lab-close').click();
    await page.getByTestId('pending-retry').click();
    await expect(page.getByTestId('pending-banner')).toHaveCount(0);

    await page.getByTestId('history-button').click();
    await expect(page.getByTestId('history-row')).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('pb.pending.v1'))).toBe('[]');
  });

  test('pending records are retried automatically on the next app start', async ({ page, game }) => {
    await initApp(page, { settings: SETTINGS, overrides: SITTING_DUCK, scenario: 'offline-on-submit' });
    await game.open();
    await game.playToEnd();
    await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'failed', { timeout: 15_000 });
    await page.evaluate(() => localStorage.setItem('pb.mock.scenario', JSON.stringify('default')));
    await page.reload();
    await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'saved');
    await page.getByTestId('result-menu-button').click();
    await page.getByTestId('history-button').click();
    await expect(page.getByTestId('history-row')).toHaveCount(1);
  });

  test('4xx rejections are not retried in a loop and are reported', async ({ page, game }) => {
    await initApp(page, { settings: SETTINGS, overrides: SITTING_DUCK, scenario: 'client-error' });
    await game.open();
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/matches')) posts.push(r.url());
    });
    await game.playToEnd();
    await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'failed');
    await expect(page.getByTestId('registration-status')).toContainText('The match record was rejected.');
    await page.waitForTimeout(1500);
    expect(posts.length).toBeLessThanOrEqual(1);
  });
});
