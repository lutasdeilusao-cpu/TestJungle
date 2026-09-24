import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
/**
 * E2E_BASE_URL=http://localhost:5173 runs the suite against the dev server
 * instead (React Strict Mode double-mounts every component there).
 */
const EXTERNAL = process.env.E2E_BASE_URL;

/**
 * E2E suite. Runs against the optimised production build (`vite preview`),
 * i.e. the same bundle that is deployed, with the MSW mocks it ships with.
 *
 * - desktop-chromium: the whole suite.
 * - mobile-chromium:  main flows (tests tagged @core) on a touch landscape phone.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.003, animations: 'disabled', caret: 'hide' },
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Software WebGL is CPU hungry: a few workers keep frame pacing realistic.
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  // Baselines are versioned per project, without the OS suffix.
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: EXTERNAL ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'mobile-chromium',
      grep: /@core/,
      use: { ...devices['Pixel 7 landscape'] },
    },
  ],
  webServer: EXTERNAL
    ? undefined
    : {
        command: 'npm run build && npm run preview',
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
