import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HistoryPage, MatchSubmission, RankingPage, SubmitMatchResponse } from '../api/contracts';
import { Rng } from '../game/core/rng';
import { MockDb } from './db';
import { createHandlers, type MockServerState } from './handlers';
import { findScenario, type Route } from './scenarios';

// The same handlers, fixtures and contracts used by the browser worker.
const player = { id: 'unit-player', name: 'Unit Captain' };
let scenarioId = 'default';
const state: MockServerState = {
  db: new MockDb(() => player, 'fixtures'),
  scenario: () => findScenario(scenarioId),
  rng: () => new Rng(1),
  counters: new Map<Route, number>(),
  attempts: new Map<string, number>(),
  now: () => '2026-09-24T12:00:00.000Z',
};
const server = setupServer(...createHandlers(state));
const BASE = 'http://game.test/api';

const submission = (over: Partial<MatchSubmission> = {}): MatchSubmission => ({
  matchId: 'unit-1',
  playerId: player.id,
  playerName: player.name,
  playedAt: '2026-09-24T11:59:00.000Z',
  score: 50,
  durationMs: 120_000,
  endReason: 'time_up',
  settings: { sessionTime: 120, spawnInterval: 3 },
  ...over,
});

const post = (body: unknown) =>
  fetch(`${BASE}/matches`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
beforeEach(() => {
  scenarioId = 'default';
  state.db.reset('fixtures');
  state.counters.clear();
  state.attempts.clear();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('mock API handlers', () => {
  it('ranks by score within the same settings, deterministically', async () => {
    const page: RankingPage = await (await fetch(`${BASE}/ranking?sessionTime=120&spawnInterval=3&page=1&pageSize=5`)).json();
    expect(page.items).toHaveLength(5);
    expect(page.items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5]);
    const scores = page.items.map((i) => i.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(page.totalPages).toBe(3);
  });

  it('stores a submission once and returns the stored record on resubmission', async () => {
    const first = await post(submission());
    expect(first.status).toBe(201);
    const again = await post(submission());
    expect(again.status).toBe(200);
    const body: SubmitMatchResponse = await again.json();
    expect(body.created).toBe(false);
    const history: HistoryPage = await (await fetch(`${BASE}/players/${player.id}/matches?page=1&pageSize=5`)).json();
    expect(history.totalItems).toBe(1);
    const ranking: RankingPage = await (await fetch(`${BASE}/ranking?sessionTime=120&spawnInterval=3&page=1&pageSize=50`)).json();
    expect(ranking.items.filter((i) => i.matchId === 'unit-1')).toHaveLength(1);
    expect(ranking.items[0]!.matchId).toBe('unit-1'); // 50 points tops the fixtures
  });

  it('rejects a different payload under the same match id and invalid payloads', async () => {
    await post(submission());
    expect((await post(submission({ score: 1 }))).status).toBe(409);
    expect((await post({ matchId: 'x' })).status).toBe(422);
  });

  it('bumps the revision on every insert', async () => {
    const before: HistoryPage = await (await fetch(`${BASE}/players/${player.id}/matches`)).json();
    await post(submission());
    const after: HistoryPage = await (await fetch(`${BASE}/players/${player.id}/matches`)).json();
    expect(after.revision).toBe(before.revision + 1);
  });

  it('commit-then-timeout: the first attempt stores the record, the retry recovers it', async () => {
    scenarioId = 'submit-timeout-after-commit';
    // First attempt: never answered (the client would time out)...
    void post(submission()).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    // ...but the record was stored, so the retry gets it back instead of a duplicate.
    expect(state.db.find('unit-1')).toBeDefined();
    const retry = await post(submission());
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as SubmitMatchResponse).created).toBe(false);
  });

  it('failure scenarios answer with the expected status', async () => {
    scenarioId = 'server-error';
    expect((await fetch(`${BASE}/ranking?sessionTime=120&spawnInterval=3`)).status).toBe(500);
    scenarioId = 'history-fails';
    expect((await fetch(`${BASE}/players/${player.id}/matches`)).status).toBe(503);
    expect((await fetch(`${BASE}/ranking?sessionTime=120&spawnInterval=3`)).status).toBe(200);
    scenarioId = 'network-error';
    await expect(fetch(`${BASE}/ranking?sessionTime=120&spawnInterval=3`)).rejects.toThrow();
  });
});
