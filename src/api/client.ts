import axios, { AxiosError } from 'axios';
import type {
  ApiErrorBody,
  HistoryPage,
  MatchSettings,
  MatchSubmission,
  RankingPage,
  SubmitMatchResponse,
} from './contracts';
import { readNumber } from '../state/storage';

export type ApiErrorKind = 'timeout' | 'network' | 'http' | 'cancelled';

/** Normalised error so the UI and the retry policy never inspect Axios internals. */
export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Timeouts, connection failures, 5xx and 429 are worth retrying; other 4xx are not. */
  get retryable(): boolean {
    if (this.kind === 'timeout' || this.kind === 'network') return true;
    return this.kind === 'http' && (this.status === 429 || (this.status ?? 0) >= 500);
  }
}

export const DEFAULT_TIMEOUT_MS = 6000;

export const http = axios.create({
  baseURL: `${import.meta.env.BASE_URL}api`,
  headers: { Accept: 'application/json' },
});

// The timeout can be shortened for demos/tests (Network Lab or localStorage).
http.interceptors.request.use((config) => {
  config.timeout = readNumber('pb.api.timeoutMs', DEFAULT_TIMEOUT_MS);
  return config;
});

http.interceptors.response.use(undefined, (error: unknown) => Promise.reject(toApiError(error)));

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (axios.isCancel(error)) return new ApiError('cancelled', 'Request cancelled');
  if (error instanceof AxiosError) {
    if (error.code === AxiosError.ECONNABORTED || error.code === AxiosError.ETIMEDOUT) {
      return new ApiError('timeout', 'The server took too long to respond.');
    }
    if (error.response) {
      const body = error.response.data as Partial<ApiErrorBody> | undefined;
      return new ApiError(
        'http',
        body?.error?.message ?? `Request failed with status ${error.response.status}.`,
        error.response.status,
        body?.error?.code,
      );
    }
    return new ApiError('network', 'Could not reach the server. Check your connection.');
  }
  return new ApiError('network', error instanceof Error ? error.message : 'Unknown error');
}

export const api = {
  async getRanking(settings: MatchSettings, page: number, pageSize: number, signal?: AbortSignal): Promise<RankingPage> {
    const { data } = await http.get<RankingPage>('/ranking', {
      params: { sessionTime: settings.sessionTime, spawnInterval: settings.spawnInterval, page, pageSize },
      signal,
    });
    return data;
  },

  async getHistory(playerId: string, page: number, pageSize: number, signal?: AbortSignal): Promise<HistoryPage> {
    const { data } = await http.get<HistoryPage>(`/players/${encodeURIComponent(playerId)}/matches`, {
      params: { page, pageSize },
      signal,
    });
    return data;
  },

  async submitMatch(submission: MatchSubmission): Promise<SubmitMatchResponse> {
    const { data } = await http.post<SubmitMatchResponse>('/matches', submission, {
      headers: { 'Idempotency-Key': submission.matchId },
    });
    return data;
  },
};
