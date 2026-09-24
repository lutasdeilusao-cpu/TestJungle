import { Container, Graphics, Sprite, type Application, type Texture } from 'pixi.js';
import { frame, type GameTextures } from '../assets/gameAssets';
import type { GameConfig } from '../config';
import { lerp } from '../core/math';
import { Rng } from '../core/rng';
import type { Simulation } from '../sim/Simulation';
import type { Ship, SimEvent } from '../sim/types';
import { ArenaView } from './ArenaView';
import { EffectsLayer } from './EffectsLayer';
import type { HealthBarSkin } from './HealthBar';
import { POWER_UP_TINT, PowerUpView, type PowerUpTextures } from './PowerUpView';
import { shipFrame, ShipView, type ShipViewTextures } from './ShipView';

const WAKE_POINTS = 16;
const WAKE_SAMPLE = 0.06;

interface Wake {
  xs: Float32Array;
  ys: Float32Array;
  head: number;
  size: number;
  timer: number;
  width: number;
}

export interface RenderStats {
  ships: number;
  projectiles: number;
  particles: number;
}

/**
 * Owns the Pixi scene graph of one match. It reads the simulation (never
 * writes to it), turns simulation events into visual feedback and adapts the
 * arena to the canvas size while preserving its aspect ratio.
 */
export class GameRenderer {
  /** World space: 1 unit = 1 arena pixel. Scaled and centred to fit the canvas. */
  readonly world = new Container({ label: 'world' });
  private readonly letterbox = new Graphics({ label: 'letterbox' });
  private readonly arena: ArenaView;
  private readonly wakes = new Graphics({ label: 'wakes' });
  private readonly below = new EffectsLayer();
  private readonly powerUpsLayer = new Container({ label: 'power-ups' });
  private readonly shipsLayer = new Container({ label: 'ships' });
  private readonly trails = new Graphics({ label: 'projectile-trails' });
  private readonly ballsLayer = new Container({ label: 'projectiles' });
  private readonly above = new EffectsLayer();
  private readonly barsLayer = new Container({ label: 'health-bars' });

  private readonly shipViews = new Map<number, ShipView>();
  private readonly wakeData = new Map<number, Wake>();
  private readonly balls: Sprite[] = [];
  /** Ship textures per sail colour, built on first use. */
  private readonly stageTextures = new Map<number, ShipViewTextures['stages']>();
  private readonly shipSheet: GameTextures['ships'];
  private readonly bars: { player: HealthBarSkin; enemy: HealthBarSkin };
  private readonly fireTextures: ShipViewTextures['fire'];
  private readonly powerUpViews = new Map<number, PowerUpView>();
  private readonly powerUpTextures: PowerUpTextures;
  private readonly fx: {
    ball: Texture;
    explosions: Texture[];
    wood: Texture[];
    fire: Texture[];
    puff: Texture;
    ring: Texture;
    dot: Texture;
  };
  private readonly rng = new Rng(0xf00d);
  private shake = 0;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor(
    private readonly app: Application,
    textures: GameTextures,
    private readonly config: Readonly<GameConfig>,
    options: { debugColliders?: boolean } = {},
  ) {
    const { width, height } = config.arena;
    this.arena = new ArenaView(textures.tiles, width, height, options.debugColliders);
    this.world.addChild(
      this.arena.container,
      this.wakes,
      this.below.container,
      this.powerUpsLayer,
      this.shipsLayer,
      this.trails,
      this.ballsLayer,
      this.above.container,
      this.barsLayer,
    );
    app.stage.addChild(this.world, this.letterbox);

    const ui = textures.ui;
    const enemyBar: HealthBarSkin = {
      frame: frame(ui, 'enemy_health_frame'),
      fills: [
        { minRatio: 0.5, texture: frame(ui, 'enemy_health_fill_green') },
        { minRatio: 0, texture: frame(ui, 'enemy_health_fill_red') },
      ],
      fillRect: { x: 24, w: 112 },
    };
    const playerBar: HealthBarSkin = {
      frame: frame(ui, 'health_frame'),
      fills: [
        { minRatio: 0.6, texture: frame(ui, 'health_fill_green') },
        { minRatio: 0.3, texture: frame(ui, 'health_fill_amber') },
        { minRatio: 0, texture: frame(ui, 'health_fill_red') },
      ],
      fillRect: { x: 30, w: 196 },
    };
    const ships = textures.ships;
    this.shipSheet = ships;
    this.bars = { player: playerBar, enemy: enemyBar };
    const fire: ShipViewTextures['fire'] = [frame(ships, 'fire_1'), frame(ships, 'fire_2')];
    this.fireTextures = fire;
    this.powerUpTextures = {
      badge: frame(ui, 'button_round_normal'),
      icons: {
        damage: frame(ships, 'cannon_loose'),
        fireRate: frame(ui, 'icon_time'),
        spread: frame(ui, 'icon_fire_front'),
        repair: frame(ui, 'icon_heart'),
      },
    };

    this.fx = {
      ball: frame(ships, 'cannon_ball'),
      explosions: [frame(ships, 'explosion_1'), frame(ships, 'explosion_2'), frame(ships, 'explosion_3')],
      wood: [frame(ships, 'wood_1'), frame(ships, 'wood_2'), frame(ships, 'wood_3'), frame(ships, 'wood_4')],
      fire,
      puff: this.makeTexture((g) => g.circle(16, 16, 14).fill({ color: 0xffffff })),
      ring: this.makeTexture((g) => g.circle(20, 20, 16).stroke({ width: 3, color: 0xffffff })),
      dot: this.makeTexture((g) => g.circle(4, 4, 3).fill({ color: 0xffffff })),
    };
  }

  private generated: Texture[] = [];

  private makeTexture(draw: (g: Graphics) => Graphics): Texture {
    const g = draw(new Graphics());
    const texture = this.app.renderer.generateTexture({ target: g, antialias: true, resolution: 2 });
    g.destroy();
    this.generated.push(texture);
    return texture;
  }

  private stagesFor(style: number): ShipViewTextures['stages'] {
    let stages = this.stageTextures.get(style);
    if (!stages) {
      stages = ([0, 1, 2, 3] as const).map((stage) => frame(this.shipSheet, shipFrame(style, stage))) as ShipViewTextures['stages'];
      this.stageTextures.set(style, stages);
    }
    return stages;
  }

  // ---------------------------------------------------------------------------
  // Layout

  /** Fits the arena into the canvas (CSS pixels), letterboxing the remainder. */
  layout(screenWidth: number, screenHeight: number): void {
    const { width, height } = this.config.arena;
    this.scale = Math.min(screenWidth / width, screenHeight / height);
    this.offsetX = (screenWidth - width * this.scale) / 2;
    this.offsetY = (screenHeight - height * this.scale) / 2;
    this.world.scale.set(this.scale);
    this.world.position.set(this.offsetX, this.offsetY);

    const w = width * this.scale;
    const h = height * this.scale;
    const g = this.letterbox.clear();
    const shade = { color: 0x0b1a2a, alpha: 0.92 };
    if (this.offsetX > 0.5) {
      g.rect(0, 0, this.offsetX, screenHeight).fill(shade);
      g.rect(this.offsetX + w, 0, screenWidth - this.offsetX - w, screenHeight).fill(shade);
    }
    if (this.offsetY > 0.5) {
      g.rect(0, 0, screenWidth, this.offsetY).fill(shade);
      g.rect(0, this.offsetY + h, screenWidth, screenHeight - this.offsetY - h).fill(shade);
    }
    g.rect(this.offsetX, this.offsetY, w, h).stroke({ width: 2, color: 0xf1c27d, alpha: 0.55 });
  }

  /** Converts canvas CSS coordinates to arena coordinates (inverse of `layout`). */
  screenToWorld(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.offsetX) / this.scale, y: (y - this.offsetY) / this.scale };
  }

  get arenaRectOnScreen(): { x: number; y: number; width: number; height: number } {
    return {
      x: this.offsetX,
      y: this.offsetY,
      width: this.config.arena.width * this.scale,
      height: this.config.arena.height * this.scale,
    };
  }

  // ---------------------------------------------------------------------------
  // Frame update

  /**
   * @param alpha interpolation between the last two simulation steps
   * @param dt presentation seconds since the previous frame (0 while paused)
   */
  render(sim: Simulation, alpha: number, dt: number): void {
    this.arena.update(dt);
    this.syncShips(sim, alpha, dt);
    this.syncProjectiles(sim, alpha);
    this.syncPowerUps(sim, dt);
    this.below.update(dt);
    this.above.update(dt);
    this.updateShake(dt);
  }

  private syncShips(sim: Simulation, alpha: number, dt: number): void {
    const live = new Set<number>();
    const visit = (ship: Ship) => {
      if (!ship.alive) return;
      live.add(ship.id);
      let view = this.shipViews.get(ship.id);
      if (!view) {
        const bar = ship.kind === 'player' ? this.bars.player : this.bars.enemy;
        view = new ShipView(ship, { stages: this.stagesFor(ship.style), fire: this.fireTextures, bar }, ship.kind === 'player' ? 0.3 : 0.36);
        this.shipViews.set(ship.id, view);
        this.shipsLayer.addChild(view.body);
        this.barsLayer.addChild(view.bar.container);
      }
      view.update(alpha, dt);
      this.trackWake(ship, dt);
    };
    visit(sim.player);
    for (const enemy of sim.enemies) visit(enemy);

    for (const [id, view] of this.shipViews) {
      if (!live.has(id)) {
        view.destroy();
        this.shipViews.delete(id);
      }
    }
    for (const id of this.wakeData.keys()) if (!live.has(id)) this.wakeData.delete(id);
    this.drawWakes();
  }

  private trackWake(ship: Ship, dt: number): void {
    let wake = this.wakeData.get(ship.id);
    if (!wake) {
      wake = {
        xs: new Float32Array(WAKE_POINTS),
        ys: new Float32Array(WAKE_POINTS),
        head: 0,
        size: 0,
        timer: 0,
        width: ship.hull.hullRadius * 1.1,
      };
      this.wakeData.set(ship.id, wake);
    }
    wake.timer -= dt;
    if (wake.timer > 0) return;
    wake.timer = WAKE_SAMPLE;
    const stern = ship.hull.halfLength * 0.9;
    const speedFactor = ship.speed / ship.hull.maxSpeed;
    if (speedFactor < 0.08 && wake.size > 0) {
      // Standing still: let the wake shrink.
      wake.size--;
      return;
    }
    wake.xs[wake.head] = ship.x - Math.cos(ship.heading) * stern;
    wake.ys[wake.head] = ship.y - Math.sin(ship.heading) * stern;
    wake.head = (wake.head + 1) % WAKE_POINTS;
    wake.size = Math.min(WAKE_POINTS, wake.size + 1);
  }

  private drawWakes(): void {
    const g = this.wakes.clear();
    for (const wake of this.wakeData.values()) {
      for (let i = 1; i < wake.size; i++) {
        const a = (wake.head - i + WAKE_POINTS) % WAKE_POINTS;
        const b = (wake.head - i - 1 + WAKE_POINTS) % WAKE_POINTS;
        const t = 1 - i / WAKE_POINTS;
        g.moveTo(wake.xs[a]!, wake.ys[a]!)
          .lineTo(wake.xs[b]!, wake.ys[b]!)
          .stroke({ width: wake.width * (0.5 + (1 - t) * 0.9), color: 0xffffff, alpha: 0.22 * t, cap: 'round' });
      }
    }
  }

  private syncPowerUps(sim: Simulation, dt: number): void {
    const live = new Set<number>();
    for (const powerUp of sim.powerUps) {
      if (!powerUp.alive) continue;
      live.add(powerUp.id);
      let view = this.powerUpViews.get(powerUp.id);
      if (!view) {
        view = new PowerUpView(powerUp, this.powerUpTextures);
        this.powerUpViews.set(powerUp.id, view);
        this.powerUpsLayer.addChild(view.container);
      }
      view.update(dt);
    }
    for (const [id, view] of this.powerUpViews) {
      if (!live.has(id)) {
        view.destroy();
        this.powerUpViews.delete(id);
      }
    }
  }

  private syncProjectiles(sim: Simulation, alpha: number): void {
    const list = sim.projectiles;
    while (this.balls.length < list.length) {
      const ball = new Sprite({ texture: this.fx.ball, anchor: 0.5 });
      this.balls.push(ball);
      this.ballsLayer.addChild(ball);
    }
    const g = this.trails.clear();
    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i]!;
      const p = list[i];
      if (!p || !p.alive) {
        ball.visible = false;
        continue;
      }
      const x = lerp(p.prevX, p.x, alpha);
      const y = lerp(p.prevY, p.y, alpha);
      ball.visible = true;
      ball.position.set(x, y);
      ball.tint = p.owner === 'enemy' ? 0xffc9b8 : 0xffffff;
      const tail = 0.07;
      g.moveTo(x - p.vx * tail, y - p.vy * tail)
        .lineTo(x, y)
        .stroke({ width: 3, color: p.owner === 'enemy' ? 0xffd9cf : 0xffffff, alpha: 0.55, cap: 'round' });
    }
  }

  private updateShake(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 30);
    const s = this.shake;
    const dx = s > 0 ? this.rng.range(-s, s) : 0;
    const dy = s > 0 ? this.rng.range(-s, s) : 0;
    this.world.position.set(this.offsetX + dx * this.scale, this.offsetY + dy * this.scale);
  }

  // ---------------------------------------------------------------------------
  // Feedback

  handleEvents(events: readonly SimEvent[], sim: Simulation): void {
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          this.muzzle(e.x, e.y, e.heading, e.count, e.slot !== 'front');
          break;
        case 'hit': {
          this.shipViews.get(e.shipId)?.hit();
          this.above.spawn({ texture: this.fx.explosions[2]!, x: e.x, y: e.y, life: 0.28, scaleFrom: 0.35, scaleTo: 0.8, alphaFrom: 1 });
          this.above.burst(this.rng, this.fx.wood, e.x, e.y, 4, 120, { life: 0.7, damping: 2.5, scaleFrom: 0.9, scaleTo: 0.6, alphaFrom: 1 });
          if (e.kind === 'player') this.shake = Math.max(this.shake, 5);
          break;
        }
        case 'projectile_end':
          if (e.reason === 'obstacle') this.dust(e.x, e.y);
          else if (e.reason === 'expired') this.splash(e.x, e.y);
          break;
        case 'ship_destroyed': {
          const ship = this.shipViews.get(e.shipId)?.ship ?? (e.shipId === sim.player.id ? sim.player : undefined);
          this.explode(e.x, e.y, e.heading, { style: ship?.style ?? 2, tint: ship?.tint ?? 0xffffff, scale: ship?.hull.scale ?? 0.75 }, e.shipId);
          if (e.cause === 'impact' || e.kind === 'player') this.shake = Math.max(this.shake, 10);
          break;
        }
        case 'powerup_spawned':
          this.below.spawn({ texture: this.fx.ring, x: e.x, y: e.y, life: 0.7, scaleFrom: 0.3, scaleTo: 1.4, alphaFrom: 0.9, tint: POWER_UP_TINT[e.kind] });
          break;
        case 'powerup_collected':
          this.above.spawn({ texture: this.fx.ring, x: e.x, y: e.y, life: 0.5, scaleFrom: 0.5, scaleTo: 2.2, alphaFrom: 1, tint: POWER_UP_TINT[e.kind] });
          this.above.burst(this.rng, [this.fx.dot], e.x, e.y, 10, 140, { life: 0.6, damping: 2.5, alphaFrom: 1, scaleFrom: 1.4, scaleTo: 0.4, tint: POWER_UP_TINT[e.kind] });
          break;
        case 'powerup_expired':
          this.splash(e.x, e.y);
          break;
        case 'wave_cleared': {
          const p = sim.player;
          for (let i = 0; i < 3; i++) {
            this.above.spawn({ texture: this.fx.ring, x: p.x, y: p.y, life: 0.9, delay: i * 0.15, scaleFrom: 0.5, scaleTo: 9, alphaFrom: 0.9, tint: 0xffe08a });
          }
          this.shake = Math.max(this.shake, 6);
          break;
        }
        default:
          break;
      }
    }
  }

  private muzzle(x: number, y: number, heading: number, count: number, broadside: boolean): void {
    const fx = Math.cos(heading);
    const fy = Math.sin(heading);
    // Broadside flashes are spread along the hull, perpendicular to the shot.
    const spacing = this.config.player.broadside.spacing;
    for (let i = 0; i < count; i++) {
      const along = broadside ? (i - (count - 1) / 2) * spacing : 0;
      const px = x - fy * along;
      const py = y + fx * along;
      this.above.spawn({ texture: this.fx.explosions[2]!, x: px, y: py, life: 0.16, scaleFrom: 0.3, scaleTo: 0.55, alphaFrom: 1 });
      for (let k = 0; k < 3; k++) {
        this.above.spawn({
          texture: this.fx.puff,
          x: px,
          y: py,
          vx: fx * this.rng.range(30, 70) + this.rng.range(-15, 15),
          vy: fy * this.rng.range(30, 70) + this.rng.range(-15, 15),
          damping: 2,
          life: this.rng.range(0.5, 0.8),
          scaleFrom: 0.35,
          scaleTo: 1.1,
          alphaFrom: 0.55,
          tint: 0xd8dde2,
        });
      }
    }
  }

  private splash(x: number, y: number): void {
    this.below.spawn({ texture: this.fx.ring, x, y, life: 0.6, scaleFrom: 0.2, scaleTo: 1, alphaFrom: 0.8 });
    this.below.burst(this.rng, [this.fx.dot], x, y, 5, 60, { life: 0.45, damping: 3, alphaFrom: 0.9, rotation: 0, spin: 0 });
  }

  private dust(x: number, y: number): void {
    this.above.burst(this.rng, [this.fx.puff], x, y, 4, 40, {
      life: 0.6,
      damping: 3,
      scaleFrom: 0.3,
      scaleTo: 0.8,
      alphaFrom: 0.7,
      tint: 0xe8cf9a,
    });
  }

  private explode(x: number, y: number, heading: number, ship: { style: number; tint: number; scale: number }, shipId: number): void {
    // Wreck that slowly sinks below the living ships.
    this.below.spawn({
      texture: this.stagesFor(ship.style)[3],
      x,
      y,
      rotation: heading - Math.PI / 2,
      life: 2.6,
      scaleFrom: ship.scale,
      scaleTo: ship.scale * 0.8,
      tint: ship.tint,
      alphaFrom: 1,
      alphaTo: 0,
    });
    const [big, mid, small] = this.fx.explosions as [Texture, Texture, Texture];
    this.above.spawn({ texture: big, x, y, life: 0.55, scaleFrom: 0.4, scaleTo: 1.3, alphaFrom: 1 });
    this.above.spawn({ texture: mid, x: x + 16, y: y - 10, life: 0.45, delay: 0.08, scaleFrom: 0.3, scaleTo: 1 });
    this.above.spawn({ texture: small, x: x - 14, y: y + 14, life: 0.4, delay: 0.16, scaleFrom: 0.3, scaleTo: 1 });
    this.above.burst(this.rng, this.fx.wood, x, y, 8, 170, { life: 1.1, damping: 2, alphaFrom: 1, scaleFrom: 1, scaleTo: 0.7 });
    this.above.burst(this.rng, this.fx.fire, x, y, 3, 50, { life: 0.8, damping: 2, alphaFrom: 1, scaleFrom: 0.8, scaleTo: 0.3, spin: 0 });
    this.splash(x, y);
    this.wakeData.delete(shipId);
  }

  stats(sim: Simulation): RenderStats {
    return {
      ships: 1 + sim.enemies.length,
      projectiles: sim.projectiles.length,
      particles: this.below.count + this.above.count,
    };
  }

  destroy(): void {
    for (const view of this.shipViews.values()) view.destroy();
    this.shipViews.clear();
    for (const view of this.powerUpViews.values()) view.destroy();
    this.powerUpViews.clear();
    this.wakeData.clear();
    this.arena.destroy();
    this.below.destroy();
    this.above.destroy();
    // `context: true` matters: with an options object, Pixi only frees a
    // Graphics' own GraphicsContext (and its GPU data in the long-lived
    // renderer) when asked to. Without it every match leaked two contexts.
    this.world.destroy({ children: true, context: true });
    this.letterbox.destroy({ context: true });
    for (const texture of this.generated) texture.destroy(true);
    this.generated = [];
  }
}
