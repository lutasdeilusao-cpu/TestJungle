import { delay, http, HttpResponse } from 'msw';
import type { ApiErrorBody, MatchSubmission, SubmitMatchResponse } from '../api/contracts';
import { Rng } from '../game/core/rng';
import { isSubmission } from '../state/matchRecords';
import type { MockDb } from './db';
import { latencyScale, type Behavior, type Route, type Scenario } from './scenarios';

export interface MockServerState {
  db: MockDb;
  scenario: () => Scenario;
  /** Seeded RNG for latency; recreated when the scenario changes or is reset. */
  rng: () => Rng;
  counters: Map<Route, number>;
  attempts: Map<string, number>;
  now?: () => string;
}

const errorBody = (code: string, message: string): ApiErrorBody => ({ error: { code, message } });

function positiveInt(value: string | null, fallback: number, max = 1000): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

/** Applies the scenario behaviour; returns a Response to short-circuit, or null to continue. */
async function applyBehavior(behavior: Behavior): Promise<Response | null> {
  switch (behavior.kind) {
    case 'ok':
      await delay(behavior.delayMs);
      return null;
    case 'network-error':
      await delay(behavior.delayMs);
      return HttpResponse.error();
    case 'timeout':
    case 'commit-then-timeout':
      await delay('infinite');
      return null;
    case 'http-error':
      await delay(behavior.delayMs);
      return HttpResponse.json(errorBody(behavior.code, behavior.message), { status: behavior.status });
  }
}

/**
 * REST handlers for ranking and match history. The same handlers (and the same
 * contracts/fixtures) run in development, in the published demo build and in
 * the Playwright suite.
 */
export function createHandlers(state: MockServerState) {
  const behaviorFor = (route: Route, attempt = 1): Behavior => {
    const count = (state.counters.get(route) ?? 0) + 1;
    state.counters.set(route, count);
    const rng = state.rng();
    const scale = latencyScale();
    return state.scenario().behave({
      route,
      count,
      attempt,
      rng,
      latency: (min, max) => Math.round(rng.range(min, max) * scale),
    });
  };
  const now = () => state.now?.() ?? new Date().toISOString();

  return [
    http.get('*/api/ranking', async ({ request }) => {
      const failure = await applyBehavior(behaviorFor('ranking'));
      if (failure) return failure;
      const url = new URL(request.url);
      const sessionTime = Number(url.searchParams.get('sessionTime'));
      const spawnInterval = Number(url.searchParams.get('spawnInterval'));
      if (!Number.isFinite(sessionTime) || !Number.isFinite(spawnInterval) || sessionTime <= 0 || spawnInterval <= 0) {
        return HttpResponse.json(errorBody('bad_request', 'sessionTime and spawnInterval are required.'), { status: 400 });
      }
      const page = positiveInt(url.searchParams.get('page'), 1);
      const pageSize = positiveInt(url.searchParams.get('pageSize'), 5, 50);
      return HttpResponse.json(state.db.ranking({ sessionTime, spawnInterval }, page, pageSize));
    }),

    http.get('*/api/players/:playerId/matches', async ({ request, params }) => {
      const failure = await applyBehavior(behaviorFor('history'));
      if (failure) return failure;
      const url = new URL(request.url);
      const page = positiveInt(url.searchParams.get('page'), 1);
      const pageSize = positiveInt(url.searchParams.get('pageSize'), 5, 50);
      return HttpResponse.json(state.db.history(String(params.playerId), page, pageSize));
    }),

    http.post('*/api/matches', async ({ request }) => {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return HttpResponse.json(errorBody('invalid_json', 'Body must be JSON.'), { status: 400 });
      }
      if (!isSubmission(body)) {
        return HttpResponse.json(errorBody('invalid_match', 'The match record is incomplete.'), { status: 422 });
      }
      const submission: MatchSubmission = body;
      const key = request.headers.get('Idempotency-Key') ?? submission.matchId;
      const attempt = (state.attempts.get(key) ?? 0) + 1;
      state.attempts.set(key, attempt);

      const behavior = behaviorFor('submit', attempt);
      const store = (): SubmitMatchResponse => {
        const existing = state.db.find(submission.matchId);
        if (existing) return { record: existing, created: false };
        return { record: state.db.insert(submission, now()), created: true };
      };

      if (behavior.kind === 'commit-then-timeout') {
        store();
        await delay('infinite');
      }
      const failure = await applyBehavior(behavior);
      if (failure) return failure;

      const existing = state.db.find(submission.matchId);
      if (existing && (existing.score !== submission.score || existing.playerId !== submission.playerId)) {
        return HttpResponse.json(errorBody('conflict', 'A different record already uses this match id.'), { status: 409 });
      }
      const result = store();
      return HttpResponse.json(result, { status: result.created ? 201 : 200 });
    }),
  ];
}
