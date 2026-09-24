#!/usr/bin/env node
/**
 * Performance profile of the optimised build.
 *
 *   npm run build && npm run preview        # in one terminal (http://localhost:4173)
 *   npm run perf                            # in another
 *
 * Options (env):
 *   PERF_URL=http://localhost:4173   target
 *   PERF_SECONDS=180                 match length for the frame-time run
 *   PERF_CYCLES=5                    start/play/leave cycles for the memory run
 *   PERF_HEADLESS=0                  run a visible window (uses the real GPU)
 *   PERF_CHANNEL=chrome              use the installed Google Chrome instead of Playwright's Chromium
 *   PERF_GPU=0                       keep Chromium's software WebGL (SwiftShader) instead of the GPU
 *   PERF_STRESS=1                    stress variant: spawn every second, up to 40 enemies alive, bot only
 *                                    fires broadsides (so enemies and projectiles pile up)
 *
 * 1. Frame run: one real-time match driven by a simple bot through the real
 *    keyboard controls (aims at the nearest enemy, fires, keeps moving).
 *    The player's health is raised so the match lasts the full duration.
 *    Records FPS, frame-time percentiles and entity counts (FrameStats).
 * 2. Memory run: N cycles of start -> play 15 s -> leave to the menu. After each
 *    cycle a full GC is forced through CDP and the JS heap and DOM counters are
 *    sampled, to spot continuous growth.
 *
 * Results: perf/results/profile-<timestamp>.json and a Markdown summary on stdout.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.PERF_URL ?? 'http://localhost:4173';
const SECONDS = Number(process.env.PERF_SECONDS ?? 180);
const CYCLES = Number(process.env.PERF_CYCLES ?? 5);
const HEADLESS = process.env.PERF_HEADLESS !== '0';
const CHANNEL = process.env.PERF_CHANNEL;
// Headless Chromium defaults to software WebGL; these flags use the real GPU.
const GPU_ARGS =
  process.env.PERF_GPU === '0' ? [] : ['--ignore-gpu-blocklist', '--enable-gpu', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])];
const VIEWPORT = { width: 1600, height: 900 };
const STRESS = process.env.PERF_STRESS === '1';
const SETTINGS = { sessionTime: SECONDS, spawnInterval: STRESS ? 1 : 3, muted: true };
const OVERRIDES = STRESS
  ? { player: { maxHealth: 100000 }, spawn: { maxAlive: 40 }, waves: { maxAliveCap: 40, clearBoard: false }, chaser: { impactDamage: 0 } }
  : { player: { maxHealth: 100000 } };

const browser = await chromium.launch({
  headless: HEADLESS,
  channel: CHANNEL,
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    ...GPU_ARGS,
  ],
});
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('HeapProfiler.enable');

await page.addInitScript(
  ({ settings, overrides }) => {
    if (sessionStorage.getItem('perf')) return;
    sessionStorage.setItem('perf', '1');
    localStorage.clear();
    localStorage.setItem('pb.settings.v1', JSON.stringify(settings));
    localStorage.setItem('pb.test.overrides', JSON.stringify(overrides));
    localStorage.setItem('pb.mock.latencyScale', '0');
  },
  { settings: SETTINGS, overrides: OVERRIDES },
);
await page.goto(URL);
await page.getByTestId('main-menu').waitFor();

const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
const environment = {
  date: new Date().toISOString(),
  cpu: os.cpus()[0]?.model,
  cores: os.cpus().length,
  ramGb: Math.round(os.totalmem() / 2 ** 30),
  os: `${os.type()} ${os.release()}`,
  browser: `${CHANNEL ?? 'chromium'} ${browser.version()}${HEADLESS ? ' (headless)' : ''}`,
  gpu,
  viewport: VIEWPORT,
  devicePixelRatio: 1,
  match: { ...SETTINGS, overrides: OVERRIDES, stress: STRESS },
};
console.error('environment', environment);

const state = () => page.evaluate(() => window.__PIRATE__?.state() ?? null);

/** Bot: one decision every 100 ms, expressed as held keys. */
async function drive(ms) {
  const held = new Set();
  const set = async (key, on) => {
    if (on && !held.has(key)) {
      held.add(key);
      await page.keyboard.down(key);
    } else if (!on && held.has(key)) {
      held.delete(key);
      await page.keyboard.up(key);
    }
  };
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await state();
    if (!s || s.session.status !== 'running') break;
    const p = s.player;
    let target = null;
    let best = Infinity;
    for (const e of s.enemies) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < best) [best, target] = [d, e];
    }
    const tx = target?.x ?? 800;
    const ty = target?.y ?? 450;
    let delta = Math.atan2(ty - p.y, tx - p.x) - p.heading;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    await set('KeyW', true);
    await set('KeyA', delta < -0.1);
    await set('KeyD', delta > 0.1);
    await set('Space', !STRESS && !!target && Math.abs(delta) < 0.25);
    await set('KeyQ', !!target && best < 330 && Math.abs(delta + Math.PI / 2) < 0.4);
    await set('KeyE', !!target && best < 330 && Math.abs(delta - Math.PI / 2) < 0.4);
    await page.waitForTimeout(100);
  }
  for (const key of [...held]) await page.keyboard.up(key);
}

async function heapSample(label) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize, totalSize } = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  return {
    label,
    usedHeapMb: +(usedSize / 2 ** 20).toFixed(2),
    totalHeapMb: +(totalSize / 2 ** 20).toFixed(2),
    domNodes: dom.nodes,
    jsEventListeners: dom.jsEventListeners,
    documents: dom.documents,
    canvases,
  };
}

// ---------------------------------------------------------------- frame run
await page.getByTestId('play-button').click();
await page.waitForFunction(() => window.__PIRATE__?.state()?.session.status === 'running', null, { timeout: 30_000 });
await page.evaluate(() => window.__PIRATE__.resetPerf());
const started = Date.now();
await drive(SECONDS * 1000 + 5000);
const frame = await page.evaluate(() => window.__PIRATE__.perf());
const finalState = await state();
const frameRun = {
  wallSeconds: Math.round((Date.now() - started) / 1000),
  ...frame,
  score: finalState?.score,
  spawned: finalState?.spawned,
  endStatus: finalState?.session.status,
};
console.error('frame run', frameRun);
await page.getByTestId('result-screen').waitFor({ timeout: 20_000 }).catch(() => undefined);

// ---------------------------------------------------------------- memory run
await page.goto(`${URL}/#/`);
await page.getByTestId('main-menu').waitFor();
await page.evaluate((s) => localStorage.setItem('pb.settings.v1', JSON.stringify({ ...s, sessionTime: 180 })), SETTINGS);
const memory = [await heapSample('baseline (menu, before any match)')];
for (let i = 1; i <= CYCLES; i++) {
  await page.getByTestId('play-button').click();
  await page.waitForFunction(() => window.__PIRATE__?.state()?.session.status === 'running', null, { timeout: 30_000 });
  await drive(15_000);
  await page.keyboard.press('Escape');
  await page.getByTestId('exit-button').click();
  await page.getByTestId('main-menu').waitFor();
  memory.push(await heapSample(`after cycle ${i}`));
  console.error(memory[memory.length - 1]);
}

await browser.close();

const result = { environment, frameRun, memory };
const out = join(dirname(fileURLToPath(import.meta.url)), 'results');
mkdirSync(out, { recursive: true });
const file = join(out, `profile-${STRESS ? 'stress-' : ''}${environment.date.replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify(result, null, 2));

const md = [
  `### Profile ${environment.date}`,
  '',
  `- Hardware: ${environment.cpu} (${environment.cores} threads), ${environment.ramGb} GB RAM, GPU: ${environment.gpu}`,
  `- Browser: ${environment.browser}, viewport ${VIEWPORT.width}x${VIEWPORT.height} @1x, ${environment.os}`,
  `- Match: ${SECONDS} s, spawn every ${SETTINGS.spawnInterval} s, player health raised to last the whole match${STRESS ? ', STRESS: up to 40 enemies alive' : ''}`,
  '',
  '| Metric | Value |',
  '| --- | ---: |',
  `| Frames | ${frameRun.frames} |`,
  `| Average FPS | ${frameRun.avgFps} |`,
  `| Frame time p50 / p95 / p99 (ms) | ${frameRun.p50FrameMs} / ${frameRun.p95FrameMs} / ${frameRun.p99FrameMs} |`,
  `| Longest frame (ms) | ${frameRun.maxFrameMs} |`,
  `| Frames > 25 ms | ${frameRun.slowFrames} |`,
  `| Ships alive (avg / max) | ${frameRun.avgShips} / ${frameRun.maxShips} |`,
  `| Projectiles (avg / max) | ${frameRun.avgProjectiles} / ${frameRun.maxProjectiles} |`,
  `| Particles (max) | ${frameRun.maxParticles} |`,
  '',
  '| Memory sample | JS heap used (MB) | DOM nodes | JS listeners | Canvases |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...memory.map((m) => `| ${m.label} | ${m.usedHeapMb} | ${m.domNodes} | ${m.jsEventListeners} | ${m.canvases} |`),
  '',
  `Raw data: ${file.replace(/\\/g, '/').replace(/^.*\/perf\//, 'perf/')}`,
].join('\n');
console.log(md);
