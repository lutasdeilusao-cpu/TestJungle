import { expect, initApp, PLAYER, SITTING_DUCK, test } from './fixtures';

const SETTINGS = { sessionTime: 60, spawnInterval: 3 };

test.describe('Resubmission after timeout and out-of-order responses', () => {
  test('a timeout after the server stored the match recovers the record without duplicates @core', async ({ page, game }) => {
    await initApp(page, { settings: SETTINGS, overrides: SITTING_DUCK, scenario: 'submit-timeout-after-commit', apiTimeoutMs: 1500 });
    await game.open();
    await game.playToEnd();
    await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'saving');
    // First attempt times out (the record was stored), the automatic retry gets it back.
    await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });

    // Clicking retry-like actions again must not duplicate anything.
    const submission = await page.evaluate(() => JSON.parse(localStorage.getItem('pb.lastResult.v1')!).submission);
    const again = await page.evaluate(async (body) => {
      const res = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': body.matchId },
        body: JSON.stringify(body),
      });
      return { status: res.status, json: await res.json() };
    }, submission);
    expect(again.status).toBe(200);
    expect(again.json.created).toBe(false);

    await page.getByTestId('result-menu-button').click();
    await page.getByTestId('history-button').click();
    await expect(page.getByTestId('history-row')).toHaveCount(1);
    await page.getByTestId('tab-ranking').click();
    await game.findRankingRow(submission.matchId);
    await expect(page.locator(`[data-testid=ranking-row][data-match-id="${submission.matchId}"]`)).toHaveCount(1);
  });

  test('retry is disabled while a submission is in flight and the match is stored once', async ({ page, game }) => {
    await initApp(page, { settings: SETTINGS, overrides: SITTING_DUCK, scenario: 'slow', latencyScale: 1 });
    await game.open();
    await game.playToEnd();
    await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'saving');
    await page.getByTestId('result-menu-button').click();
    await expect(page.getByTestId('pending-banner')).toContainText('saving');
    await expect(page.getByTestId('pending-retry')).toBeDisabled();
    await expect(page.getByTestId('pending-banner')).toHaveCount(0, { timeout: 15_000 });
    await page.getByTestId('history-button').click();
    await expect(page.getByTestId('history-row')).toHaveCount(1, { timeout: 10_000 });
  });

  test('a late, older response does not overwrite newer data', async ({ page, game }) => {
    // Odd requests take 2.5 s, even ones 100 ms.
    await initApp(page, { scenario: 'out-of-order', latencyScale: 1 });
    await game.open('/#/history');
    // Request #1 (slow) is in flight...
    await expect(page.getByTestId('history-loading')).toBeVisible();
    // ...a match gets recorded meanwhile...
    await page.evaluate(async (player) => {
      await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-late-1' },
        body: JSON.stringify({
          matchId: 'e2e-late-1',
          playerId: player.id,
          playerName: player.name,
          playedAt: new Date().toISOString(),
          score: 7,
          durationMs: 60000,
          endReason: 'time_up',
          settings: { sessionTime: 60, spawnInterval: 3 },
        }),
      });
      // ...and the tabs are invalidated, as after a registration: request #2 (fast) wins.
      await window.__PIRATE__!.queryClient.invalidateQueries({ queryKey: ['history'] });
    }, PLAYER);
    await expect(page.getByTestId('history-row')).toHaveCount(1);
    // Let the stale response arrive: the newer data stays.
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('history-row')).toHaveCount(1);
    await expect(page.getByTestId('history-row')).toContainText('7');
  });
});
