/**
 * REST contracts shared by the Axios client, the TanStack Query hooks and the
 * MSW handlers/fixtures. Changing a shape here type-checks both sides.
 *
 *   GET  /api/ranking?sessionTime=120&spawnInterval=3&page=1&pageSize=5  -> RankingPage
 *   GET  /api/players/:playerId/matches?page=1&pageSize=5                -> HistoryPage
 *   POST /api/matches   (Idempotency-Key: <matchId>)  body MatchSubmission
 *        201 SubmitMatchResponse { created: true }   first time
 *        200 SubmitMatchResponse { created: false }  same matchId again (no duplicate)
 *        409 ApiErrorBody                            same matchId, different payload
 *        422 ApiErrorBody                            invalid payload
 */

export type EndReason = 'time_up' | 'defeated';

export interface MatchSettings {
  /** Match duration in seconds. */
  sessionTime: number;
  /** Seconds between enemy spawns. */
  spawnInterval: number;
}

export interface MatchSubmission {
  /** Client-generated UUID; doubles as the idempotency key. */
  matchId: string;
  playerId: string;
  playerName: string;
  /** ISO timestamp of the end of the match. */
  playedAt: string;
  score: number;
  /** Effective active play time (pauses excluded). */
  durationMs: number;
  endReason: EndReason;
  settings: MatchSettings;
  /** Waves completed during the match (optional: older clients did not send it). */
  wavesCleared?: number;
}

export interface MatchRecord extends MatchSubmission {
  /** ISO timestamp at which the server stored the record. */
  recordedAt: string;
  /** Ranking bucket: matches are only compared with the same settings. */
  configKey: string;
}

export interface RankingEntry {
  rank: number;
  matchId: string;
  playerId: string;
  playerName: string;
  score: number;
  durationMs: number;
  endReason: EndReason;
  playedAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  /** Monotonic data revision; lets the client drop responses older than its cache. */
  revision: number;
}

export interface RankingPage extends Page<RankingEntry> {
  settings: MatchSettings;
}

export type HistoryPage = Page<MatchRecord>;

export interface SubmitMatchResponse {
  record: MatchRecord;
  created: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export const configKey = (s: MatchSettings): string => `${s.sessionTime}s/${s.spawnInterval}s`;

/**
 * Deterministic ranking order for matches with the same settings:
 * 1. higher score
 * 2. survived (time_up) before defeated
 * 3. longer effective duration
 * 4. earlier playedAt (who got there first)
 * 5. matchId (lexicographic) as the final, unique tie-breaker
 */
export function compareRanking(a: MatchSubmission, b: MatchSubmission): number {
  return (
    b.score - a.score ||
    Number(b.endReason === 'time_up') - Number(a.endReason === 'time_up') ||
    b.durationMs - a.durationMs ||
    a.playedAt.localeCompare(b.playedAt) ||
    a.matchId.localeCompare(b.matchId)
  );
}

export const PAGE_SIZE = 5;
