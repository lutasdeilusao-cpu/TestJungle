import { setupWorker } from 'msw/browser';
import { Rng } from '../game/core/rng';
import { Store } from '../game/session/Store';
import { profileStore } from '../state/settings';
import { readNumber, removeKey, writeJson } from '../state/storage';
import { MockDb } from './db';
import { createHandlers, type MockServerState } from './handlers';
import { DEFAULT_SCENARIO, findScenario, type Route } from './scenarios';

const SCENARIO_KEY = 'pb.mock.scenario';
const SEED_KEY = 'pb.mock.seed';
const DEFAULT_SEED = 42;

function initialScenarioId(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('scenario');
  if (fromUrl) {
    writeJson(SCENARIO_KEY, fromUrl);
    return findScenario(fromUrl).id;
  }
  try {
    return findScenario(JSON.parse(localStorage.getItem(SCENARIO_KEY) ?? 'null') as string | null).id;
  } catch {
    return DEFAULT_SCENARIO;
  }
}

export const scenarioStore = new Store<{ id: string; ready: boolean; failed: boolean }>({
  id: initialScenarioId(),
  ready: false,
  failed: false,
});

let rng = new Rng(readNumber(SEED_KEY, DEFAULT_SEED));
const counters = new Map<Route, number>();
const attempts = new Map<string, number>();
const db = new MockDb(() => profileStore.getSnapshot(), findScenario(scenarioStore.getSnapshot().id).dataset);

const state: MockServerState = {
  db,
  scenario: () => findScenario(scenarioStore.getSnapshot().id),
  rng: () => rng,
  counters,
  attempts,
};

function resetRuntime(): void {
  rng = new Rng(readNumber(SEED_KEY, DEFAULT_SEED));
  counters.clear();
  attempts.clear();
}

/** Network Lab: switch the active failure scenario (persisted across refreshes). */
export function setScenario(id: string): void {
  const scenario = findScenario(id);
  writeJson(SCENARIO_KEY, scenario.id);
  resetRuntime();
  db.ensureDataset(scenario.dataset);
  scenarioStore.set({ id: scenario.id });
}

/** Network Lab: back to the default scenario with the initial fixtures. */
export function resetMockServer(): void {
  removeKey(SCENARIO_KEY);
  resetRuntime();
  db.reset(findScenario(DEFAULT_SCENARIO).dataset);
  scenarioStore.set({ id: DEFAULT_SCENARIO });
}

/** Re-seeds the mock database for the current scenario (keeps the scenario). */
export function reseedMockData(): void {
  resetRuntime();
  db.reset(findScenario(scenarioStore.getSnapshot().id).dataset);
}

export const worker = setupWorker(...createHandlers(state));

export async function startMockServer(): Promise<void> {
  try {
    await worker.start({
      serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
      onUnhandledRequest: 'bypass',
      quiet: true,
    });
    scenarioStore.set({ ready: true });
  } catch {
    // Without a service worker the game still runs; ranking/history show errors.
    scenarioStore.set({ ready: true, failed: true });
  }
}
