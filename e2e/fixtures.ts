import { expect, test as base, type Page } from '@playwright/test';

/** Mirrors the relevant parts of window.__PIRATE__.state() (kept loose on purpose). */
export interface GameState {
  status: 'running' | 'ended';
  endReason: 'time_up' | 'defeated' | null;
  elapsed: number;
  remaining: number;
  score: number;
  spawned: { chaser: number; shooter: number };
  player: Ship;
  enemies: Ship[];
  projectiles: { id: number; owner: 'player' | 'enemy'; x: number; y: number }[];
  wave: number;
  waveKills: number;
  waveTarget: number;
  wavesCleared: number;
  upgrades: { damage: number; fireRate: number; spread: number };
  powerUps: { id: number; kind: 'damage' | 'fireRate' | 'spread' | 'repair'; x: number; y: number; ttl: number }[];
  session: { status: string; score: number; remaining: number; hp: number; pauseReason: string | null };
  render: { ships: number; projectiles: number; particles: number } | null;
}

export interface Ship {
  id: number;
  kind: 'player' | 'chaser' | 'shooter';
  variant: string;
  x: number;
  y: number;
  heading: number;
  speed: number;
  hp: number;
  maxHp: number;
  cooldowns: { front: number; left: number; right: number };
  age: number;
}

export const PLAYER = { id: 'e2e-captain', name: 'Captain Jack' };

/** Enemies spawn and act normally but deal no damage: the match always reaches its time limit. */
export const HARMLESS = { chaser: { impactDamage: 0 }, shooter: { weapon: { damage: 0 } } };

/**
 * Stationary, harmless shooters 500 px ahead of the player (one at a time):
 * three bow shots sink one (score 1). The spawn interval is left untouched
 * because it is part of the recorded match settings (ranking bucket).
 */
export const SITTING_DUCK = {
  spawn: {
    initialDelay: 0.05,
    maxAlive: 1,
    openingSequence: ['shooter'],
    weights: { chaser: 0, shooter: 1 },
    // Standard shooters only: variants carry their own speed/range patches.
    variants: { shooter: { standard: { weight: 1 }, flanker: { weight: 0 }, sentinel: { weight: 0 } } },
    points: [{ x: 830, y: 460 }],
  },
  // One at a time also after wave clears.
  waves: { maxAlivePerWave: 0 },
  shooter: { maxSpeed: 0, turnSpeed: 0, attackRange: 0 },
};

/** Config overrides that remove enemies, for movement tests. */
export const NO_ENEMIES = { spawn: { initialDelay: 9999 } };

export interface InitOptions {
  /** 'manual' (default): the match only advances through game.advance(). */
  clock?: 'manual' | 'realtime';
  /** Mock API latency multiplier (default 0: instant responses). */
  latencyScale?: number;
  scenario?: string;
  overrides?: unknown;
  apiTimeoutMs?: number;
  settings?: { sessionTime: number; spawnInterval: number };
}

/**
 * Seeds localStorage once per test (sessionStorage guard), so reloads inside a
 * test keep whatever the app persisted. Every test gets a fresh browser
 * context, hence an isolated state.
 */
export async function initApp(page: Page, options: InitOptions = {}): Promise<void> {
  await page.addInitScript(
    ({ player, clock, latencyScale, scenario, overrides, apiTimeoutMs, settings }) => {
      if (sessionStorage.getItem('pb.e2e.init')) return;
      sessionStorage.setItem('pb.e2e.init', '1');
      localStorage.clear();
      localStorage.setItem('pb.profile.v1', JSON.stringify(player));
      localStorage.setItem('pb.test.clock', clock);
      localStorage.setItem('pb.mock.latencyScale', String(latencyScale));
      localStorage.setItem('pb.settings.v1', JSON.stringify({ ...settings, muted: true }));
      if (scenario) localStorage.setItem('pb.mock.scenario', JSON.stringify(scenario));
      if (overrides) localStorage.setItem('pb.test.overrides', JSON.stringify(overrides));
      if (apiTimeoutMs) localStorage.setItem('pb.api.timeoutMs', String(apiTimeoutMs));
    },
    {
      player: PLAYER,
      clock: options.clock ?? 'manual',
      latencyScale: options.latencyScale ?? 0,
      scenario: options.scenario ?? null,
      overrides: options.overrides ?? null,
      apiTimeoutMs: options.apiTimeoutMs ?? null,
      settings: options.settings ?? { sessionTime: 120, spawnInterval: 3 },
    },
  );
}

export class Game {
  constructor(readonly page: Page) {}

  /**
   * Plays a whole match with the real controls and waits for the result
   * screen. With SITTING_DUCK overrides the final score is 1.
   */
  async playToEnd(sessionTime = 60): Promise<void> {
    await this.start();
    await this.advance(100);
    await this.hold('Space', 1000);
    await this.advance(sessionTime * 1000);
    await this.advance(2000);
    await expect(this.page.getByTestId('result-screen')).toBeVisible();
  }

  async open(path = '/'): Promise<void> {
    await this.page.goto(path);
    await expect(this.page.getByTestId('main-menu').or(this.page.getByTestId('result-screen')).or(this.page.locator('.panel')).first()).toBeVisible();
  }

  /** Pages through the ranking until the row of `matchId` shows up; returns its rank text. */
  async findRankingRow(matchId: string): Promise<string> {
    const row = this.page.locator(`[data-testid=ranking-row][data-match-id="${matchId}"]`);
    for (let i = 0; i < 20; i++) {
      await expect(this.page.getByTestId('ranking-table')).toBeVisible();
      await expect(this.page.getByTestId('ranking-refreshing')).toHaveText('');
      if ((await row.count()) === 1) return row.locator('td').first().innerText();
      const next = this.page.getByRole('button', { name: 'Next page' });
      if (await next.isDisabled()) break;
      await next.click();
    }
    const cache = await this.page.evaluate(() =>
      (window.__PIRATE__!.queryClient as unknown as { getQueryCache(): { getAll(): { queryKey: unknown; state: { data?: { totalItems: number; revision: number }; dataUpdatedAt: number; fetchStatus: string } }[] } })
        .getQueryCache()
        .getAll()
        .map((q) => ({ key: q.queryKey, total: q.state.data?.totalItems, rev: q.state.data?.revision, at: q.state.dataUpdatedAt, fs: q.state.fetchStatus })),
    );
    throw new Error(`Ranking row ${matchId} not found. Cache: ${JSON.stringify(cache)} db=${await this.page.evaluate(() => localStorage.getItem('pb.mock.db.v1')?.slice(0, 40))}`);
  }

  async setOverrides(overrides: unknown): Promise<void> {
    await this.page.evaluate((o) => localStorage.setItem('pb.test.overrides', JSON.stringify(o)), overrides);
  }

  /** Clicks Play on the main menu and waits for the match to run. */
  async start(): Promise<void> {
    await this.page.getByTestId('play-button').click();
    await this.waitForStatus('running');
  }

  async waitForStatus(status: string): Promise<void> {
    await expect.poll(() => this.page.evaluate(() => (window.__PIRATE__?.state() as { session: { status: string } } | null)?.session.status ?? null), { timeout: 15_000 }).toBe(status);
  }

  state(): Promise<GameState> {
    return this.page.evaluate(() => window.__PIRATE__!.state() as unknown as GameState);
  }

  /** Advances game time; rules, inputs, collisions and rendering run exactly as in real time. */
  async advance(ms: number): Promise<void> {
    await this.page.evaluate((t) => window.__PIRATE__!.advance(t), ms);
  }

  /** Holds keys for `ms` of game time. */
  async hold(keys: string | string[], ms: number): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) await this.page.keyboard.down(k);
    await this.advance(ms);
    for (const k of list) await this.page.keyboard.up(k);
  }

  /** Taps a key and lets `ms` of game time pass (default: one step). */
  async tap(key: string, ms = 20): Promise<void> {
    await this.page.keyboard.down(key);
    await this.advance(ms);
    await this.page.keyboard.up(key);
  }

  /**
   * Closed-loop steering with the real controls: turns (A/D) until the bow
   * points at (x, y) within `tolerance` radians.
   */
  async aimAt(x: number, y: number, tolerance = 0.05): Promise<void> {
    for (let i = 0; i < 80; i++) {
      const { player } = await this.state();
      const want = Math.atan2(y - player.y, x - player.x);
      let delta = (want - player.heading) % (Math.PI * 2);
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) <= tolerance) return;
      const ms = Math.max(17, Math.min(250, (Math.abs(delta) / 2.6) * 1000 * 0.8));
      await this.hold(delta < 0 ? 'KeyA' : 'KeyD', ms);
    }
    throw new Error('aimAt did not converge');
  }
}

export const test = base.extend<{ game: Game; consoleErrors: string[] }>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await use(errors);
  },
  game: async ({ page }, use) => {
    await use(new Game(page));
  },
});

export { expect };

/** Browser-level network errors expected in failure scenarios (not app errors). */
export const EXPECTED_NETWORK_NOISE = /Failed to load resource|net::ERR_|status of (4|5)\d\d/;

export function unexpectedErrors(errors: string[]): string[] {
  return errors.filter((e) => !EXPECTED_NETWORK_NOISE.test(e));
}
