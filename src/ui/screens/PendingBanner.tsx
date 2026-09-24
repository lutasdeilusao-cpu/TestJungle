import { useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { flushPending, useSubmittingIds } from '../../api/queries';
import { pendingStore } from '../../state/matchRecords';

/** Lists matches whose registration has not been confirmed yet, with a retry action. */
export function PendingBanner() {
  const client = useQueryClient();
  const { entries } = useSyncExternalStore(pendingStore.subscribe, pendingStore.getSnapshot);
  const submitting = useSubmittingIds();
  if (entries.length === 0) return null;
  const busy = entries.every((e) => submitting.includes(e.submission.matchId));
  const lastError = entries.find((e) => e.lastError)?.lastError;
  return (
    <div className="pending-banner" role="status" data-testid="pending-banner">
      <span>
        {entries.length === 1 ? '1 battle is' : `${entries.length} battles are`} waiting to be recorded
        {busy ? ' — saving…' : lastError ? ` — ${lastError}` : '.'}
      </span>
      <button type="button" className="link-button" disabled={busy} onClick={() => flushPending(client)} data-testid="pending-retry">
        Retry now
      </button>
    </div>
  );
}
