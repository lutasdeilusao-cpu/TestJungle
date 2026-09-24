import type { MatchSubmission } from '../api/contracts';
import { Store } from '../game/session/Store';
import { isRecord, readJson, writeJson } from './storage';

const PENDING_KEY = 'pb.pending.v1';
const LAST_RESULT_KEY = 'pb.lastResult.v1';

export interface PendingEntry {
  submission: MatchSubmission;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

export interface LastResult {
  submission: MatchSubmission;
  /** Set once the server confirmed the record. */
  savedAt: string | null;
}

export function isSubmission(v: unknown): v is MatchSubmission {
  return (
    isRecord(v) &&
    typeof v.matchId === 'string' &&
    typeof v.playerId === 'string' &&
    typeof v.playerName === 'string' &&
    typeof v.playedAt === 'string' &&
    typeof v.score === 'number' &&
    typeof v.durationMs === 'number' &&
    (v.endReason === 'time_up' || v.endReason === 'defeated') &&
    isRecord(v.settings) &&
    typeof v.settings.sessionTime === 'number' &&
    typeof v.settings.spawnInterval === 'number' &&
    (v.wavesCleared === undefined || (typeof v.wavesCleared === 'number' && v.wavesCleared >= 0))
  );
}

const isPendingList = (v: unknown): v is PendingEntry[] =>
  Array.isArray(v) && v.every((e) => isRecord(e) && isSubmission(e.submission) && typeof e.attempts === 'number');

const isLastResult = (v: unknown): v is LastResult =>
  isRecord(v) && isSubmission(v.submission) && (v.savedAt === null || typeof v.savedAt === 'string');

/**
 * Outbox of completed matches not yet confirmed by the server. Survives
 * refreshes; entries leave only after a successful (idempotent) submission.
 */
export const pendingStore = new Store<{ entries: PendingEntry[] }>({ entries: readJson(PENDING_KEY, isPendingList) ?? [] });

/** Result of the last completed match, shown on the Result screen and after a refresh. */
export const lastResultStore = new Store<{ result: LastResult | null }>({ result: readJson(LAST_RESULT_KEY, isLastResult) });

function writePending(entries: PendingEntry[]): void {
  pendingStore.set({ entries });
  writeJson(PENDING_KEY, entries);
}

/** Called once when a match completes: persist the result and queue its registration. */
export function recordCompletedMatch(submission: MatchSubmission): void {
  const result: LastResult = { submission, savedAt: null };
  lastResultStore.set({ result });
  writeJson(LAST_RESULT_KEY, result);
  const entries = pendingStore.getSnapshot().entries;
  if (!entries.some((e) => e.submission.matchId === submission.matchId)) {
    writePending([...entries, { submission, attempts: 0, lastError: null, updatedAt: new Date().toISOString() }]);
  }
}

export function markAttempt(matchId: string, error: string | null): void {
  writePending(
    pendingStore
      .getSnapshot()
      .entries.map((e) =>
        e.submission.matchId === matchId ? { ...e, attempts: e.attempts + 1, lastError: error, updatedAt: new Date().toISOString() } : e,
      ),
  );
}

export function markSaved(matchId: string, savedAt: string): void {
  writePending(pendingStore.getSnapshot().entries.filter((e) => e.submission.matchId !== matchId));
  const current = lastResultStore.getSnapshot().result;
  if (current?.submission.matchId === matchId && !current.savedAt) {
    const result = { ...current, savedAt };
    lastResultStore.set({ result });
    writeJson(LAST_RESULT_KEY, result);
  }
}

export function findPending(matchId: string): PendingEntry | undefined {
  return pendingStore.getSnapshot().entries.find((e) => e.submission.matchId === matchId);
}
