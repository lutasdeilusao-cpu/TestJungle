// Shape of the test hooks installed by src/testing/testHooks.ts, as seen from Playwright.
export {};

declare global {
  interface Window {
    __PIRATE__?: {
      hasSession(): boolean;
      state(): unknown;
      advance(ms: number): void;
      perf(): unknown;
      resetPerf(): void;
      queryClient: { invalidateQueries(filters: { queryKey: readonly unknown[] }): Promise<void> };
    };
  }
}
