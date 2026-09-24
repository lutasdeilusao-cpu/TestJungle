import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import type { ApiError } from '../../api/client';
import type { MatchSettings } from '../../api/contracts';
import { useHistory, useRanking } from '../../api/queries';
import { OPTION_LIMITS } from '../../game/config';
import { profileStore, settingsStore } from '../../state/settings';
import { MenuButton, Pagination, Panel, Spinner } from '../components';
import { formatClock, formatEndReason, formatPlayedAt } from '../format';
import { navigate } from '../router';

type Tab = 'ranking' | 'history';

export function CaptainsLog({ tab, onBack }: { tab: Tab; onBack: () => void }) {
  const tabs = useRef<Record<Tab, HTMLButtonElement | null>>({ ranking: null, history: null });
  const select = (next: Tab) => navigate({ name: 'log', tab: next }, { replace: true });
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next: Tab = e.key === 'Home' ? 'ranking' : e.key === 'End' ? 'history' : tab === 'ranking' ? 'history' : 'ranking';
    select(next);
    tabs.current[next]?.focus();
  };

  return (
    <Panel wide labelledBy="log-title" className="log-panel">
      <h2 id="log-title" className="panel-title">
        Captain&apos;s Log
      </h2>
      <div className="log-tabs" role="tablist" aria-label="Captain's log" onKeyDown={onKeyDown}>
        {(['ranking', 'history'] as const).map((t) => (
          <button
            key={t}
            ref={(el) => {
              tabs.current[t] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`tabpanel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            className={`menu-button menu-button--sm ${tab === t ? 'menu-button--primary' : 'menu-button--secondary'}`}
            onClick={() => select(t)}
            data-testid={`tab-${t}`}
          >
            <span className="menu-button__label">{t === 'ranking' ? 'Ranking' : 'Match History'}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} className="log-body">
        {tab === 'ranking' ? <RankingTab /> : <HistoryTab />}
      </div>
      <div className="form-actions">
        <MenuButton onClick={onBack} data-testid="log-back">
          Main Menu
        </MenuButton>
      </div>
    </Panel>
  );
}

const PRESETS: MatchSettings[] = [
  { sessionTime: 60, spawnInterval: 3 },
  { sessionTime: 120, spawnInterval: 3 },
  { sessionTime: 180, spawnInterval: 2 },
];

function RankingTab() {
  const client = useQueryClient();
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const profile = useSyncExternalStore(profileStore.subscribe, profileStore.getSnapshot);
  const current: MatchSettings = { sessionTime: settings.sessionTime, spawnInterval: settings.spawnInterval };
  const [bucket, setBucket] = useState<MatchSettings>(current);
  const [page, setPage] = useState(1);
  const query = useRanking(client, bucket, page);

  const options = [current, ...PRESETS].filter(
    (s, i, all) => all.findIndex((o) => o.sessionTime === s.sessionTime && o.spawnInterval === s.spawnInterval) === i,
  );
  const value = `${bucket.sessionTime}|${bucket.spawnInterval}`;

  return (
    <>
      <div className="log-subtitle">
        <label htmlFor="ranking-bucket">Battles compared with the same settings:</label>
        <select
          id="ranking-bucket"
          className="select"
          value={value}
          onChange={(e) => {
            const [st, si] = e.target.value.split('|').map(Number);
            setBucket({ sessionTime: st ?? OPTION_LIMITS.sessionTime.default, spawnInterval: si ?? OPTION_LIMITS.spawnInterval.default });
            setPage(1);
          }}
          data-testid="ranking-bucket"
        >
          {options.map((o) => (
            <option key={`${o.sessionTime}|${o.spawnInterval}`} value={`${o.sessionTime}|${o.spawnInterval}`}>
              {o.sessionTime} second battles · {o.spawnInterval} second spawn interval
            </option>
          ))}
        </select>
      </div>
      <QueryView
        testId="ranking"
        isPending={query.isPending}
        isError={query.isError}
        error={query.error as ApiError | null}
        isFetching={query.isFetching}
        isPlaceholder={query.isPlaceholderData}
        empty={query.data?.items.length === 0}
        emptyText="No battles recorded with these settings yet. Be the first captain on the board!"
        onRetry={() => void query.refetch()}
        loadingText="Loading ranking…"
      >
        {query.data && (
          <>
            <table className="log-table" data-testid="ranking-table">
              <caption className="visually-hidden">
                Ranking for {query.data.settings.sessionTime} second battles with a {query.data.settings.spawnInterval} second spawn interval, page {query.data.page} of{' '}
                {query.data.totalPages}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Captain</th>
                  <th scope="col">Points</th>
                  <th scope="col">Played</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((entry) => {
                  const played = formatPlayedAt(entry.playedAt);
                  const mine = entry.playerId === profile.id;
                  return (
                    <tr key={entry.matchId} className={mine ? 'is-mine' : undefined} data-testid="ranking-row" data-match-id={entry.matchId}>
                      <td className="num">{String(entry.rank).padStart(2, '0')}</td>
                      <th scope="row">
                        {entry.rank === 1 && <span className="star" aria-label="Top captain" role="img" />}
                        {entry.playerName}
                        {mine && <span className="you-badge">You</span>}
                      </th>
                      <td className="num score">{entry.score}</td>
                      <td>
                        <time dateTime={entry.playedAt} title={played.full}>
                          {played.day} · {played.time}
                        </time>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={query.data.page} totalPages={query.data.totalPages} onChange={setPage} label="Ranking pages" />
          </>
        )}
      </QueryView>
    </>
  );
}

function HistoryTab() {
  const client = useQueryClient();
  const profile = useSyncExternalStore(profileStore.subscribe, profileStore.getSnapshot);
  const [page, setPage] = useState(1);
  const query = useHistory(client, profile.id, page);
  return (
    <>
      <p className="log-subtitle">{profile.name} · your recent battles</p>
      <QueryView
        testId="history"
        isPending={query.isPending}
        isError={query.isError}
        error={query.error as ApiError | null}
        isFetching={query.isFetching}
        isPlaceholder={query.isPlaceholderData}
        empty={query.data?.items.length === 0}
        emptyText="No battles yet. Your completed matches will be logged here."
        onRetry={() => void query.refetch()}
        loadingText="Loading match history…"
      >
        {query.data && (
          <>
            <table className="log-table" data-testid="history-table">
              <caption className="visually-hidden">
                Your match history, page {query.data.page} of {query.data.totalPages}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Points</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Result</th>
                  <th scope="col">Waves</th>
                  <th scope="col">Settings</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((m) => {
                  const played = formatPlayedAt(m.playedAt);
                  return (
                    <tr key={m.matchId} data-testid="history-row" data-match-id={m.matchId}>
                      <th scope="row">
                        <time dateTime={m.playedAt} title={played.full}>
                          {played.day} <span className="muted">· {played.time}</span>
                        </time>
                      </th>
                      <td className="num score">{m.score}</td>
                      <td className="num">{formatClock(m.durationMs / 1000)}</td>
                      <td className={`reason reason--${m.endReason}`}>{formatEndReason(m.endReason)}</td>
                      <td className="num">{m.wavesCleared ?? '–'}</td>
                      <td className="muted">
                        {m.settings.sessionTime} s / {m.settings.spawnInterval} s
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={query.data.page} totalPages={query.data.totalPages} onChange={setPage} label="Match history pages" />
          </>
        )}
      </QueryView>
    </>
  );
}

interface QueryViewProps {
  testId: string;
  isPending: boolean;
  isError: boolean;
  error: ApiError | null;
  isFetching: boolean;
  isPlaceholder: boolean;
  empty: boolean;
  emptyText: string;
  loadingText: string;
  onRetry: () => void;
  children: ReactNode;
}

/** Shared loading / empty / error / background-refresh states for both tabs. */
function QueryView({ testId, isPending, isError, error, isFetching, isPlaceholder, empty, emptyText, loadingText, onRetry, children }: QueryViewProps) {
  if (isPending) {
    return (
      <div className="log-state" data-testid={`${testId}-loading`}>
        <Spinner label={loadingText} />
      </div>
    );
  }
  return (
    <div className="log-content" aria-busy={isFetching}>
      {isError && (
        <div className="log-error" role="alert" data-testid={`${testId}-error`}>
          <p>
            {error?.message ?? 'Something went wrong.'}
            {children ? ' Showing the last data we have.' : ''}
          </p>
          <button type="button" className="link-button" onClick={onRetry} disabled={isFetching} data-testid={`${testId}-retry`}>
            {isFetching ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      )}
      <p className="log-refresh" aria-live="polite" data-testid={`${testId}-refreshing`}>
        {isFetching && !isError ? (isPlaceholder ? 'Loading page…' : 'Updating…') : ''}
      </p>
      {empty && !isError ? (
        <p className="log-state" data-testid={`${testId}-empty`}>
          {emptyText}
        </p>
      ) : (
        !empty && children
      )}
    </div>
  );
}
