import { useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { submitMatch, useSubmittingIds } from '../../api/queries';
import { pendingStore, type LastResult } from '../../state/matchRecords';
import { MenuButton, Panel } from '../components';
import { formatClock, formatEndReason } from '../format';

type Registration = 'saved' | 'saving' | 'failed' | 'queued';

export function ResultScreen({ result, onPlayAgain, onMenu }: { result: LastResult; onPlayAgain: () => void; onMenu: () => void }) {
  const client = useQueryClient();
  const { entries } = useSyncExternalStore(pendingStore.subscribe, pendingStore.getSnapshot);
  const submitting = useSubmittingIds();
  const { submission } = result;
  const pending = entries.find((e) => e.submission.matchId === submission.matchId);

  const registration: Registration = result.savedAt
    ? 'saved'
    : submitting.includes(submission.matchId)
      ? 'saving'
      : pending?.lastError
        ? 'failed'
        : 'queued';

  const defeated = submission.endReason === 'defeated';
  return (
    <Panel labelledBy="result-title" className="result-panel">
      <div data-testid="result-screen">
        <h2 id="result-title" className="panel-title">
          {defeated ? 'Ship Sunk' : 'Battle Complete'}
        </h2>
        <p className="result-score" data-testid="result-score">
          {submission.score}
        </p>
        <p className="result-meta">
          <span>Points</span> · <span data-testid="result-duration">{formatClock(submission.durationMs / 1000)}</span> ·{' '}
          <span data-testid="result-reason">{formatEndReason(submission.endReason)}</span>
        </p>
        <p className="result-waves" data-testid="result-waves">
          {submission.wavesCleared ?? 0} {submission.wavesCleared === 1 ? 'wave' : 'waves'} cleared
        </p>
        <p className="result-config">
          {submission.settings.sessionTime} s battle · {submission.settings.spawnInterval} s spawn interval
        </p>
        <div className={`registration registration--${registration}`} role="status" aria-live="polite" data-testid="registration-status" data-state={registration}>
          {registration === 'saved' && 'Recorded in the ranking and your match history.'}
          {registration === 'saving' && 'Recording this battle…'}
          {registration === 'queued' && 'Waiting to record this battle…'}
          {registration === 'failed' && (
            <>
              <span>Could not record this battle: {pending?.lastError} It is kept and will be retried.</span>
              <button type="button" className="link-button" onClick={() => submitMatch(client, submission)} data-testid="registration-retry">
                Retry now
              </button>
            </>
          )}
        </div>
        <div className="menu-actions">
          <MenuButton onClick={onPlayAgain} autoFocus data-testid="play-again-button">
            Play Again
          </MenuButton>
          <MenuButton onClick={onMenu} data-testid="result-menu-button">
            Main Menu
          </MenuButton>
        </div>
      </div>
    </Panel>
  );
}
