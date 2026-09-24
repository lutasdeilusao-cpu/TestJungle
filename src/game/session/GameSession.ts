import type { Ticker } from 'pixi.js';
import { loadGameTextures, preferredResolution } from '../assets/gameAssets';
import { audio } from '../audio/AudioManager';
import type { GameConfig, PowerUpKind, UpgradeKind } from '../config';
import { InputController, type GameAction } from '../input/InputController';
import { GameRenderer, type RenderStats } from '../render/GameRenderer';
import { acquirePixi, type PixiLease } from '../render/pixiHost';
import { Simulation, type SimSnapshot } from '../sim/Simulation';
import type { EndReason, SimEvent } from '../sim/types';
import { FrameStats } from './FrameStats';
import { Store } from './Store';

export type SessionStatus = 'loading' | 'error' | 'running' | 'paused' | 'ending' | 'finished' | 'disposed';
export type PauseReason = 'manual' | 'blur' | 'hidden';

export interface HudState {
  status: SessionStatus;
  loadProgress: number;
  error: string | null;
  score: number;
  /** Whole seconds left, rounded up. */
  remaining: number;
  hp: number;
  maxHp: number;
  pauseReason: PauseReason | null;
  endReason: EndReason | null;
  wave: number;
  waveKills: number;
  waveTarget: number;
  /** Permanent upgrade stacks (flat fields so the store can compare them cheaply). */
  upDamage: number;
  upFireRate: number;
  upSpread: number;
  /** Latest banner-worthy event (wave cleared, power-up collected); `id` changes each time. */
  notice: HudNotice | null;
}

export interface HudNotice {
  id: number;
  kind: 'wave' | PowerUpKind;
  title: string;
  detail: string;
}

const POWER_UP_LABEL: Record<PowerUpKind, string> = {
  damage: 'Heavy shot',
  fireRate: 'Quick reload',
  spread: 'Fan shot',
  repair: 'Repair kit',
};

export interface MatchOutcome {
  score: number;
  wavesCleared: number;
  /** Effective active play time. */
  durationMs: number;
  endReason: EndReason;
  endedAt: string;
}

export interface SessionOptions {
  config: Readonly<GameConfig>;
  /** 'manual' freezes the real-time loop; time only advances through `advance()` (tests). */
  clock?: 'realtime' | 'manual';
  debugColliders?: boolean;
  onFinished(outcome: MatchOutcome): void;
}

/**
 * Glue between the pure simulation, the Pixi renderer, the input controller
 * and the React UI. Owns the fixed-step loop and the match lifecycle:
 *
 *   loading -> running <-> paused -> ending -> finished
 *        \-> error (retry -> loading)                    any -> disposed
 *
 * The continuous combat state stays in `Simulation`; React only receives the
 * coarse `HudState` through `store`, which changes a few times per second.
 */
export class GameSession {
  readonly store: Store<HudState>;
  readonly input = new InputController();
  readonly frameStats = new FrameStats();
  readonly sim: Simulation;

  private lease: PixiLease | null = null;
  private renderer: GameRenderer | null = null;
  private accumulator = 0;
  private endTimer = 0;
  private disposed = false;
  private lowHealthWarned = false;
  private lastWarnedSecond = -1;
  private readonly clock: 'realtime' | 'manual';
  private pendingPresentation = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly options: SessionOptions,
  ) {
    this.clock = options.clock ?? 'realtime';
    this.sim = new Simulation(options.config);
    this.store = new Store<HudState>({
      status: 'loading',
      loadProgress: 0,
      error: null,
      score: 0,
      remaining: Math.ceil(options.config.sessionTime),
      hp: options.config.player.maxHealth,
      maxHp: options.config.player.maxHealth,
      pauseReason: null,
      endReason: null,
      wave: 1,
      waveKills: 0,
      waveTarget: options.config.waves.firstTarget,
      upDamage: 0,
      upFireRate: 0,
      upSpread: 0,
      notice: null,
    });
  }

  get config(): Readonly<GameConfig> {
    return this.options.config;
  }

  get status(): SessionStatus {
    return this.store.getSnapshot().status;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle

  /** Loads textures, attaches the canvas and starts the match. Safe to call again after an error. */
  async start(): Promise<void> {
    if (this.disposed) return;
    this.store.set({ status: 'loading', error: null, loadProgress: 0 });
    try {
      const { width, height } = this.config.arena;
      const resolution = preferredResolution(this.host.clientWidth, this.host.clientHeight, width, height);
      const textures = await loadGameTextures(resolution, (p) => {
        if (!this.disposed) this.store.set({ loadProgress: p });
      });
      if (this.disposed) return;
      const lease = await acquirePixi(this.host);
      if (this.disposed) {
        lease.release();
        return;
      }
      this.lease = lease;
      this.renderer = new GameRenderer(lease.app, textures, this.config, { debugColliders: this.options.debugColliders });
      this.renderer.layout(lease.app.screen.width, lease.app.screen.height);
      lease.app.renderer.on('resize', this.handleResize);
      lease.app.ticker.add(this.tick);
      // With the manual clock nothing changes between advance() calls, so the
      // ticker stays stopped and frames are rendered on demand.
      if (this.clock === 'realtime') lease.app.start();
    } catch (error) {
      if (this.disposed) return;
      this.store.set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      return;
    }

    this.input.enable(() => this.togglePause());
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.store.set({ status: 'running', loadProgress: 1 });
    audio.play('game_start', { volume: 0.7 });
    audio.startLoop('ocean_ambience_loop', 0.35);
    audio.startLoop('ship_sailing_loop', 0);
    this.renderFrame(0);
  }

  /** Tears everything down. Idempotent; safe during loading (Strict Mode double mount). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.disable();
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    audio.stopAllLoops();
    if (this.lease) {
      this.lease.app.ticker.remove(this.tick);
      this.lease.app.renderer.off('resize', this.handleResize);
    }
    this.renderer?.destroy();
    this.renderer = null;
    this.lease?.release();
    this.lease = null;
    this.store.set({ status: 'disposed' });
  }

  // ---------------------------------------------------------------------------
  // Pause

  pause(reason: PauseReason): void {
    if (this.status !== 'running') return;
    this.input.setSuspended(true);
    this.accumulator = 0;
    this.store.set({ status: 'paused', pauseReason: reason });
    audio.play('game_pause', { volume: 0.6 });
    audio.setLoopVolume('ship_sailing_loop', 0);
  }

  /** Requires an explicit player action; nothing that happened while paused is replayed. */
  resume(): void {
    if (this.status !== 'paused') return;
    this.input.setSuspended(false);
    this.accumulator = 0;
    this.store.set({ status: 'running', pauseReason: null });
    audio.play('game_resume', { volume: 0.6 });
  }

  togglePause(): void {
    if (this.status === 'running') this.pause('manual');
    else if (this.status === 'paused') this.resume();
  }

  private readonly handleBlur = () => this.pause('blur');
  private readonly handleVisibility = () => {
    if (document.visibilityState === 'hidden') this.pause('hidden');
  };
  private readonly handleResize = (width: number, height: number) => {
    this.renderer?.layout(width, height);
    if (this.clock === 'manual') this.renderFrame(0);
  };

  /** Touch controls forward pointer presses here. */
  press(pointerId: number, action: GameAction): void {
    this.input.pressPointer(pointerId, action);
  }

  release(pointerId: number): void {
    this.input.releasePointer(pointerId);
  }

  // ---------------------------------------------------------------------------
  // Loop

  private readonly tick = (ticker: Ticker): void => {
    const frameDt = Math.min(ticker.deltaMS / 1000, this.config.maxFrameDelta);
    this.frameStats.record(ticker.deltaMS, this.renderer?.stats(this.sim));
    this.advanceBy(frameDt);
  };

  /** Advances simulated and presentation time by `seconds` (only while running/ending). */
  private advanceBy(seconds: number, render = true): void {
    const status = this.status;
    if (status === 'running') {
      const step = this.config.fixedStep;
      this.accumulator += seconds;
      while (this.accumulator >= step - 1e-9 && this.status === 'running') {
        this.sim.step(step, this.input.read());
        this.input.endStep();
        this.accumulator = Math.max(0, this.accumulator - step);
        this.handleEvents(this.sim.drainEvents());
      }
      this.syncHud();
    } else if (status === 'ending') {
      this.endTimer -= seconds;
      if (this.endTimer <= 0) this.finish();
    }
    const presentation = status === 'running' || status === 'ending' ? seconds : 0;
    if (render) this.renderFrame(presentation);
    else this.pendingPresentation += presentation;
  }

  private renderFrame(dt: number): void {
    if (!this.renderer) return;
    const alpha = this.status === 'running' ? this.accumulator / this.config.fixedStep : 1;
    this.renderer.render(this.sim, alpha, dt);
    if (this.clock === 'manual' && this.lease) this.lease.app.render();
  }

  /**
   * Test/profiling hook: advance the match by `ms` of game time in fixed steps,
   * exactly as the real-time loop would (same rules, inputs and rendering).
   */
  advance(ms: number): void {
    // Whole fixed steps: advancing 1000 ms always runs exactly 60 steps.
    const steps = Math.max(0, Math.round(ms / 1000 / this.config.fixedStep));
    for (let i = 0; i < steps; i++) this.advanceBy(this.config.fixedStep, false);
    const presentation = this.pendingPresentation;
    this.pendingPresentation = 0;
    this.renderFrame(presentation);
  }

  private handleEvents(events: SimEvent[]): void {
    if (events.length === 0) return;
    this.renderer?.handleEvents(events, this.sim);
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          if (e.slot === 'front') audio.play(e.kind === 'player' ? 'cannon_fire_1' : 'cannon_fire_3', { volume: e.kind === 'player' ? 0.5 : 0.3 });
          else audio.play('cannon_broadside', { volume: 0.55 });
          break;
        case 'hit':
          audio.play(e.kind === 'player' ? 'ship_wood_hit_1' : 'ship_wood_hit_2', { volume: 0.5 });
          break;
        case 'projectile_end':
          if (e.reason === 'expired') audio.play('cannonball_water_hit_1', { volume: 0.25, throttleMs: 90 });
          break;
        case 'impact':
          audio.play('ship_collision', { volume: 0.7 });
          break;
        case 'ship_destroyed':
          audio.play(e.kind === 'player' ? 'ship_sinking' : 'ship_explosion_1', { volume: 0.6 });
          break;
        case 'score':
          audio.play('score_point', { volume: 0.45 });
          break;
        case 'powerup_collected':
          audio.play('ui_open', { volume: 0.6 });
          this.notify(e.kind, POWER_UP_LABEL[e.kind], this.describePowerUp(e.kind, e.stacks));
          break;
        case 'wave_cleared': {
          audio.play('game_complete', { volume: 0.5 });
          const parts = [e.heal > 0 ? `+${Math.round(e.heal)} hull` : null, e.upgrade ? `${POWER_UP_LABEL[e.upgrade]} bonus` : null].filter(Boolean);
          this.notify('wave', `Wave ${e.wave} cleared!`, `${parts.join(' · ')}${parts.length ? ' — ' : ''}next: sink ${e.nextTarget}`);
          break;
        }
        case 'ended':
          this.beginEnding(e.reason);
          break;
        default:
          break;
      }
    }
  }

  private noticeId = 0;

  private notify(kind: HudNotice['kind'], title: string, detail: string): void {
    this.store.set({ notice: { id: ++this.noticeId, kind, title, detail } });
  }

  private describePowerUp(kind: PowerUpKind, stacks: number): string {
    if (kind === 'repair' || stacks === 0) return `+${this.config.powerUps.repairAmount} hull`;
    const cfg = this.config.powerUps;
    const max = cfg.maxStacks[kind as UpgradeKind];
    const suffix = stacks >= max ? ' (max)' : '';
    if (kind === 'damage') return `Damage ×${(1 + cfg.damagePerStack * stacks).toFixed(2)}${suffix}`;
    if (kind === 'fireRate') return `Reload ${Math.round((1 - 1 / (1 + cfg.fireRatePerStack * stacks)) * 100)}% faster${suffix}`;
    return `Bow cannon fires ${1 + cfg.spreadBallsPerStack * stacks} balls${suffix}`;
  }

  private syncHud(): void {
    const sim = this.sim;
    const remaining = Math.ceil(sim.remaining - 1e-6);
    const p = sim.player;
    this.store.set({
      score: sim.score,
      remaining,
      hp: p.hp,
      maxHp: p.maxHp,
      wave: sim.wave,
      waveKills: sim.waveKills,
      waveTarget: sim.waveTarget,
      upDamage: sim.upgrades.damage,
      upFireRate: sim.upgrades.fireRate,
      upSpread: sim.upgrades.spread,
    });
    audio.setLoopVolume('ship_sailing_loop', (p.speed / p.hull.maxSpeed) * 0.35);
    if (!this.lowHealthWarned && p.hp > 0 && p.hp / p.maxHp <= 0.3) {
      this.lowHealthWarned = true;
      audio.play('health_low', { volume: 0.6 });
    }
    if (remaining <= 10 && remaining > 0 && remaining !== this.lastWarnedSecond) {
      this.lastWarnedSecond = remaining;
      audio.play('time_warning', { volume: 0.45 });
    }
  }

  private beginEnding(reason: EndReason): void {
    this.input.setSuspended(true);
    this.endTimer = this.config.endDelay;
    this.syncHud();
    this.store.set({ status: 'ending', endReason: reason });
    audio.setLoopVolume('ship_sailing_loop', 0);
    audio.play(reason === 'time_up' ? 'game_complete' : 'game_over', { volume: 0.7 });
  }

  private finish(): void {
    if (this.status !== 'ending') return;
    this.store.set({ status: 'finished' });
    audio.stopAllLoops();
    this.options.onFinished({
      score: this.sim.score,
      wavesCleared: this.sim.wavesCleared,
      durationMs: Math.round(this.sim.elapsed * 1000),
      endReason: this.sim.endReason ?? 'time_up',
      endedAt: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // Observation

  snapshot(): SimSnapshot & { session: HudState; render: RenderStats | null; arenaOnScreen: DOMRect | null } {
    const rect = this.renderer?.arenaRectOnScreen;
    const canvas = this.lease?.app.canvas.getBoundingClientRect();
    return {
      ...this.sim.snapshot(),
      session: this.store.getSnapshot(),
      render: this.renderer?.stats(this.sim) ?? null,
      arenaOnScreen: rect && canvas ? new DOMRect(canvas.left + rect.x, canvas.top + rect.y, rect.width, rect.height) : null,
    };
  }
}
