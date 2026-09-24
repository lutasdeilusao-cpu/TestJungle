import { Rng } from '../game/core/rng';
import { readNumber } from '../state/storage';
import type { Dataset } from './db';

export type Route = 'ranking' | 'history' | 'submit';

/** What a handler should do for one request. */
export type Behavior =
  | { kind: 'ok'; delayMs: number }
  | { kind: 'network-error'; delayMs: number }
  | { kind: 'timeout' }
  | { kind: 'http-error'; status: number; code: string; message: string; delayMs: number }
  /** Store the record, then never answer this attempt (client times out). */
  | { kind: 'commit-then-timeout' };

export interface RequestContext {
  route: Route;
  /** 1-based count of requests to this route since the scenario was activated. */
  count: number;
  /** For submit: 1-based attempt number for this matchId. */
  attempt: number;
  rng: Rng;
  latency: (min: number, max: number) => number;
}

export interface Scenario {
  id: string;
  label: string;
  description: string;
  dataset: Dataset;
  behave(ctx: RequestContext): Behavior;
}

const ok = (delayMs: number): Behavior => ({ kind: 'ok', delayMs });
const normal = (ctx: RequestContext) => ok(ctx.latency(120, 350));

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'default',
    label: 'Success',
    description: 'Rival fixtures, short realistic latency.',
    dataset: 'fixtures',
    behave: normal,
  },
  {
    id: 'empty',
    label: 'Empty lists',
    description: 'No records at all: ranking and history start empty.',
    dataset: 'empty',
    behave: normal,
  },
  {
    id: 'many-pages',
    label: 'Many pages',
    description: '100+ matches, including a long history for you.',
    dataset: 'many',
    behave: normal,
  },
  {
    id: 'slow',
    label: 'Slow network',
    description: 'Every response takes about 2.5 s.',
    dataset: 'fixtures',
    behave: (ctx) => ok(ctx.latency(2300, 2700)),
  },
  {
    id: 'variable-latency',
    label: 'Variable latency',
    description: 'Seeded random latency between 50 ms and 2 s.',
    dataset: 'fixtures',
    behave: (ctx) => ok(ctx.latency(50, 2000)),
  },
  {
    id: 'out-of-order',
    label: 'Out-of-order responses',
    description: 'Odd requests take 2.5 s, even ones 100 ms: older responses arrive after newer ones.',
    dataset: 'fixtures',
    behave: (ctx) => (ctx.route === 'submit' ? normal(ctx) : ok(ctx.count % 2 === 1 ? 2500 : 100)),
  },
  {
    id: 'timeout',
    label: 'Timeout',
    description: 'No response ever arrives; the client times out.',
    dataset: 'fixtures',
    behave: () => ({ kind: 'timeout' }),
  },
  {
    id: 'network-error',
    label: 'Connection failure',
    description: 'Every request fails at the network level.',
    dataset: 'fixtures',
    behave: (ctx) => ({ kind: 'network-error', delayMs: ctx.latency(50, 150) }),
  },
  {
    id: 'server-error',
    label: 'HTTP 500',
    description: 'Every request answers 500 Internal Server Error.',
    dataset: 'fixtures',
    behave: (ctx) => ({ kind: 'http-error', status: 500, code: 'internal', message: 'The server hit an unexpected error.', delayMs: ctx.latency(80, 200) }),
  },
  {
    id: 'client-error',
    label: 'HTTP 4xx',
    description: 'Queries answer 400 and submissions 422 (not retried).',
    dataset: 'fixtures',
    behave: (ctx) =>
      ctx.route === 'submit'
        ? { kind: 'http-error', status: 422, code: 'invalid_match', message: 'The match record was rejected.', delayMs: 100 }
        : { kind: 'http-error', status: 400, code: 'bad_request', message: 'The request was rejected.', delayMs: 100 },
  },
  {
    id: 'ranking-fails',
    label: 'Ranking fails',
    description: 'Only the ranking endpoint returns 503.',
    dataset: 'fixtures',
    behave: (ctx) =>
      ctx.route === 'ranking'
        ? { kind: 'http-error', status: 503, code: 'unavailable', message: 'The ranking service is unavailable.', delayMs: 150 }
        : normal(ctx),
  },
  {
    id: 'history-fails',
    label: 'History fails',
    description: 'Only the match history endpoint returns 503.',
    dataset: 'fixtures',
    behave: (ctx) =>
      ctx.route === 'history'
        ? { kind: 'http-error', status: 503, code: 'unavailable', message: 'The match history service is unavailable.', delayMs: 150 }
        : normal(ctx),
  },
  {
    id: 'submit-timeout-after-commit',
    label: 'Timeout after saving',
    description: 'The first submission of each match is stored but never answered; the retry recovers the stored record.',
    dataset: 'fixtures',
    behave: (ctx) => (ctx.route === 'submit' && ctx.attempt === 1 ? { kind: 'commit-then-timeout' } : normal(ctx)),
  },
  {
    id: 'offline-on-submit',
    label: 'Unavailable at match end',
    description: 'Submissions fail with a connection error until you switch back to Success.',
    dataset: 'fixtures',
    behave: (ctx) => (ctx.route === 'submit' ? { kind: 'network-error', delayMs: 100 } : normal(ctx)),
  },
];

export const DEFAULT_SCENARIO = 'default';

export function findScenario(id: string | null | undefined): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
}

/**
 * Latency multiplier (localStorage `pb.mock.latencyScale`, default 1). Tests
 * set it to 0 to remove waiting from scenarios that do not test latency.
 */
export function latencyScale(): number {
  return Math.max(0, readNumber('pb.mock.latencyScale', 1));
}
