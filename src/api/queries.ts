import {
  keepPreviousData,
  MutationObserver,
  QueryClient,
  useMutationState,
  useQuery,
  type QueryKey,
} from '@tanstack/react-query';
import { markAttempt, markSaved, pendingStore } from '../state/matchRecords';
import { api, toApiError } from './client';
import { configKey, PAGE_SIZE, type MatchSettings, type MatchSubmission, type Page, type SubmitMatchResponse } from './contracts';

export const queryKeys = {
  rankingAll: ['ranking'] as const,
  historyAll: ['history'] as const,
  ranking: (settings: MatchSettings, page: number) => ['ranking', configKey(settings), page, PAGE_SIZE] as const,
  history: (playerId: string, page: number) => ['history', playerId, page, PAGE_SIZE] as const,
};

export const SUBMIT_MATCH_KEY = ['submit-match'] as const;

const MAX_RETRIES = 2;
const shouldRetry = (failureCount: number, error: unknown) => failureCount < MAX_RETRIES && toApiError(error).retryable;
const retryDelay = (attempt: number) => Math.min(400 * 2 ** attempt, 3000);

export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        retryDelay,
        refetchOnWindowFocus: true,
      },
    },
  });

  // Mutation defaults live on the client (not on a component), so a submission
  // keeps its callbacks even if the screen that started it unmounts.
  client.setMutationDefaults(SUBMIT_MATCH_KEY, {
    mutationFn: (submission: MatchSubmission) => api.submitMatch(submission),
    // Serialise submissions: two retries of the same match never race.
    scope: { id: 'submit-match' },
    retry: shouldRetry,
    retryDelay,
    onSuccess: async (response: SubmitMatchResponse) => {
      markSaved(response.record.matchId, response.record.recordedAt);
      // Both tabs must show the new record; cancelRefetch drops in-flight (stale) requests.
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.rankingAll }),
        client.invalidateQueries({ queryKey: queryKeys.historyAll }),
      ]);
    },
    onError: (error: unknown, submission: MatchSubmission) => {
      markAttempt(submission.matchId, toApiError(error).message);
    },
  });
  return client;
}

const inFlight = new Set<string>();

/**
 * Submits (or re-submits) a completed match. Repeated calls for a match that
 * is already being sent are ignored; the server's idempotency key covers the
 * remaining cases (e.g. a timeout after the record was stored).
 */
export function submitMatch(client: QueryClient, submission: MatchSubmission): void {
  if (inFlight.has(submission.matchId)) return;
  inFlight.add(submission.matchId);
  const observer = new MutationObserver<SubmitMatchResponse, unknown, MatchSubmission>(client, { mutationKey: SUBMIT_MATCH_KEY });
  observer
    .mutate(submission)
    .catch(() => undefined) // state is recorded by onError; nothing is thrown at the caller
    .finally(() => {
      inFlight.delete(submission.matchId);
      observer.reset();
    });
}

/** Sends every queued match that is not already in flight (app start, reconnect, manual retry). */
export function flushPending(client: QueryClient): void {
  for (const entry of pendingStore.getSnapshot().entries) submitMatch(client, entry.submission);
}

/** Match ids currently being submitted, for "Saving..." indicators. */
export function useSubmittingIds(): string[] {
  return useMutationState({
    filters: { mutationKey: SUBMIT_MATCH_KEY, status: 'pending' },
    select: (m) => (m.state.variables as MatchSubmission | undefined)?.matchId ?? '',
  });
}

/**
 * Wraps a page fetch so that a response carrying an older data revision than
 * the cached one never replaces it (belt and braces on top of TanStack's
 * cancellation of superseded requests).
 */
async function guarded<T extends Page<unknown>>(client: QueryClient, key: QueryKey, fetcher: Promise<T>): Promise<T> {
  const fresh = await fetcher;
  const cached = client.getQueryData<T>(key);
  return cached && cached.revision > fresh.revision ? cached : fresh;
}

export function useRanking(client: QueryClient, settings: MatchSettings, page: number) {
  const key = queryKeys.ranking(settings, page);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => guarded(client, key, api.getRanking(settings, page, PAGE_SIZE, signal)),
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });
}

export function useHistory(client: QueryClient, playerId: string, page: number) {
  const key = queryKeys.history(playerId, page);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => guarded(client, key, api.getHistory(playerId, page, PAGE_SIZE, signal)),
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });
}
