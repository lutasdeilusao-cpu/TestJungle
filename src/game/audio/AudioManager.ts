export type SoundId =
  | 'cannon_broadside'
  | 'cannon_fire_1'
  | 'cannon_fire_2'
  | 'cannon_fire_3'
  | 'cannonball_water_hit_1'
  | 'cannonball_water_hit_2'
  | 'game_complete'
  | 'game_over'
  | 'game_pause'
  | 'game_resume'
  | 'game_start'
  | 'health_low'
  | 'ocean_ambience_loop'
  | 'score_point'
  | 'ship_collision'
  | 'ship_explosion_1'
  | 'ship_explosion_2'
  | 'ship_sailing_loop'
  | 'ship_sinking'
  | 'ship_wood_hit_1'
  | 'ship_wood_hit_2'
  | 'time_warning'
  | 'ui_back'
  | 'ui_click'
  | 'ui_close'
  | 'ui_hover'
  | 'ui_open';

const ALL_SOUNDS: readonly SoundId[] = [
  'cannon_broadside', 'cannon_fire_1', 'cannon_fire_2', 'cannon_fire_3', 'cannonball_water_hit_1',
  'cannonball_water_hit_2', 'game_complete', 'game_over', 'game_pause', 'game_resume', 'game_start',
  'health_low', 'ocean_ambience_loop', 'score_point', 'ship_collision', 'ship_explosion_1',
  'ship_explosion_2', 'ship_sailing_loop', 'ship_sinking', 'ship_wood_hit_1', 'ship_wood_hit_2',
  'time_warning', 'ui_back', 'ui_click', 'ui_close', 'ui_hover', 'ui_open',
];

/**
 * Minimal Web Audio wrapper. Sound is an enhancement: decoding or playback
 * failures are swallowed (the game stays fully playable without audio) and the
 * context is only created after a user gesture, as browsers require.
 */
class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SoundId, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private readonly loops = new Map<SoundId, { source: AudioBufferSourceNode; gain: GainNode }>();
  private readonly lastPlayed = new Map<SoundId, number>();
  private muted = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }

  /** Call from a user gesture (Play button). Safe to call repeatedly. */
  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.8;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    this.loading ??= this.loadAll();
  }

  private async loadAll(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      ALL_SOUNDS.map(async (id) => {
        try {
          const response = await fetch(`${import.meta.env.BASE_URL}assets/sounds/${id}.mp3`);
          if (!response.ok) return;
          this.buffers.set(id, await ctx.decodeAudioData(await response.arrayBuffer()));
        } catch {
          // Missing or undecodable sound: play silently.
        }
      }),
    );
  }

  play(id: SoundId, { volume = 1, rate = 1, throttleMs = 40 }: { volume?: number; rate?: number; throttleMs?: number } = {}): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get(id);
    if (!ctx || !this.master || !buffer || this.muted || ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.lastPlayed.get(id) ?? -Infinity) < throttleMs) return;
    this.lastPlayed.set(id, now);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.master);
    source.start();
  }

  startLoop(id: SoundId, volume: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.loops.has(id)) return;
    const buffer = this.buffers.get(id);
    if (!buffer) {
      // Not decoded yet: try again shortly.
      void this.loading?.then(() => this.startLoop(id, volume));
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.master);
    source.start();
    this.loops.set(id, { source, gain });
  }

  setLoopVolume(id: SoundId, volume: number): void {
    const loop = this.loops.get(id);
    if (loop && this.ctx) loop.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.1);
  }

  stopLoop(id: SoundId): void {
    const loop = this.loops.get(id);
    if (!loop) return;
    try {
      loop.source.stop();
    } catch {
      // already stopped
    }
    loop.source.disconnect();
    loop.gain.disconnect();
    this.loops.delete(id);
  }

  stopAllLoops(): void {
    for (const id of [...this.loops.keys()]) this.stopLoop(id);
  }
}

export const audio = new AudioManager();
