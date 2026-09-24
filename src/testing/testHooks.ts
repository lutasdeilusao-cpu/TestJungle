import type { QueryClient } from '@tanstack/react-query';
import type { ConfigOverrides } from '../game/config';
import type { GameSession } from '../game/session/GameSession';
import { isRecord, readJson } from '../state/storage';

/**
 * Instrumentation for Playwright and profiling. It can observe the game state
 * and drive the clock, but it never bypasses the rules: inputs still go
 * through the real keyboard/touch controls and `advance()` runs the same fixed
 * steps, collisions and rendering as the real-time loop.
 *
 * Configuration (read when a match starts):
 *   localStorage['pb.test.clock']      'manual' -> time only moves with advance()
 *   localStorage['pb.test.overrides']  JSON ConfigOverrides (seed, spawn, health...)
 *   localStorage['pb.debug.colliders'] 'true' -> draw obstacle colliders
 */
let current: GameSession | null = null;

export function registerSession(session: GameSession | null): void {
  current = session;
}

export function testClock(): 'realtime' | 'manual' {
  try {
    return localStorage.getItem('pb.test.clock') === 'manual' ? 'manual' : 'realtime';
  } catch {
    return 'realtime';
  }
}

export function testOverrides(): ConfigOverrides | undefined {
  return readJson('pb.test.overrides', (v): v is ConfigOverrides => isRecord(v)) ?? undefined;
}

export function debugColliders(): boolean {
  try {
    return localStorage.getItem('pb.debug.colliders') === 'true';
  } catch {
    return false;
  }
}

export interface PirateTestApi {
  hasSession(): boolean;
  state(): ReturnType<GameSession['snapshot']> | null;
  advance(ms: number): void;
  perf(): ReturnType<GameSession['frameStats']['report']> | null;
  resetPerf(): void;
  queryClient: QueryClient;
}

declare global {
  interface Window {
    __PIRATE__?: PirateTestApi;
  }
}

export function installTestHooks(queryClient: QueryClient): void {
  window.__PIRATE__ = {
    hasSession: () => current !== null && current.status !== 'disposed',
    state: () => current?.snapshot() ?? null,
    advance: (ms) => current?.advance(ms),
    perf: () => current?.frameStats.report() ?? null,
    resetPerf: () => current?.frameStats.reset(),
    queryClient,
  };
}
