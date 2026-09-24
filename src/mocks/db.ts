import { compareRanking, configKey, type MatchRecord, type MatchSettings, type MatchSubmission, type Page } from '../api/contracts';
import { isRecord, readJson, removeKey, writeJson } from '../state/storage';
import { manyPagesFixtures, rivalFixtures } from './fixtures';

const DB_KEY = 'pb.mock.db.v1';

export type Dataset = 'fixtures' | 'empty' | 'many';

interface DbState {
  dataset: Dataset;
  revision: number;
  matches: MatchRecord[];
}

const isDb = (v: unknown): v is DbState =>
  isRecord(v) && typeof v.revision === 'number' && Array.isArray(v.matches) && typeof v.dataset === 'string';

function seed(dataset: Dataset, player: { id: string; name: string }): DbState {
  const matches = dataset === 'empty' ? [] : dataset === 'many' ? manyPagesFixtures(player) : rivalFixtures();
  return { dataset, revision: 1, matches };
}

/**
 * The mock "server" database. It lives in the page (MSW handlers run in the
 * main thread) and is persisted in localStorage, so confirmed records survive
 * refreshes and both endpoints always read the same data.
 */
export class MockDb {
  private state: DbState;

  constructor(
    private readonly player: () => { id: string; name: string },
    dataset: Dataset,
  ) {
    const stored = readJson(DB_KEY, isDb);
    this.state = stored && stored.dataset === dataset ? stored : seed(dataset, player());
    this.persist();
  }

  get revision(): number {
    return this.state.revision;
  }

  /** Restores the initial dataset (Network Lab "Reset"). */
  reset(dataset: Dataset): void {
    removeKey(DB_KEY);
    this.state = seed(dataset, this.player());
    this.persist();
  }

  /** Switching scenario may change the dataset; existing player records are kept when possible. */
  ensureDataset(dataset: Dataset): void {
    if (this.state.dataset !== dataset) this.reset(dataset);
  }

  private persist(): void {
    writeJson(DB_KEY, this.state);
  }

  find(matchId: string): MatchRecord | undefined {
    return this.state.matches.find((m) => m.matchId === matchId);
  }

  insert(submission: MatchSubmission, now: string): MatchRecord {
    const record: MatchRecord = { ...submission, recordedAt: now, configKey: configKey(submission.settings) };
    this.state = { ...this.state, revision: this.state.revision + 1, matches: [...this.state.matches, record] };
    this.persist();
    return record;
  }

  ranking(settings: MatchSettings, page: number, pageSize: number) {
    const key = configKey(settings);
    const sorted = this.state.matches.filter((m) => m.configKey === key).sort(compareRanking);
    const paged = paginate(sorted, page, pageSize, this.state.revision);
    return {
      ...paged,
      items: paged.items.map((m, i) => ({
        rank: (paged.page - 1) * pageSize + i + 1,
        matchId: m.matchId,
        playerId: m.playerId,
        playerName: m.playerName,
        score: m.score,
        durationMs: m.durationMs,
        endReason: m.endReason,
        playedAt: m.playedAt,
      })),
      settings,
    };
  }

  history(playerId: string, page: number, pageSize: number): Page<MatchRecord> {
    const sorted = this.state.matches
      .filter((m) => m.playerId === playerId)
      .sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.matchId.localeCompare(b.matchId));
    return paginate(sorted, page, pageSize, this.state.revision);
  }
}

function paginate<T>(items: T[], page: number, pageSize: number, revision: number): Page<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  return {
    items: items.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    pageSize,
    totalItems: items.length,
    totalPages,
    revision,
  };
}
