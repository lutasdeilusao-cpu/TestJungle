import { OBSTACLES, PLAYER_START, type Obstacle } from '../arena/arenaMap';
import {
  deepMerge,
  type ChaserConfig,
  type EnemyKind,
  type EnemyVariant,
  type GameConfig,
  type PowerUpKind,
  type ShipHullConfig,
  type ShooterConfig,
  type UpgradeKind,
  type WeaponConfig,
} from '../config';
import { angleDelta, clamp, dist, dist2, pointSegmentDist2 } from '../core/math';
import { Rng } from '../core/rng';
import { circleVsObstacle, obstacleDistance } from './geometry';
import { NavigationGrid } from './navigation';
import {
  idleControls,
  type AiState,
  type DestroyCause,
  type EndReason,
  type PowerUp,
  type Projectile,
  type ProjectileEndReason,
  type Ship,
  type ShipControls,
  type ShipKind,
  type SimEvent,
  type Upgrades,
  type WeaponSlot,
} from './types';

/** Positions (along the hull axis, as a fraction of halfLength) of the three hull circles. */
const HULL_CIRCLES = [0.8, 0, -0.8] as const;
const FLOW_FIELD_REFRESH = 0.2;
const PLAYER_STYLE = 5;
const UPGRADES: readonly UpgradeKind[] = ['damage', 'fireRate', 'spread'];

export type SimStatus = 'running' | 'ended';

export interface SimSnapshot {
  status: SimStatus;
  endReason: EndReason | null;
  elapsed: number;
  remaining: number;
  score: number;
  spawned: Record<EnemyKind, number>;
  wave: number;
  waveKills: number;
  waveTarget: number;
  wavesCleared: number;
  upgrades: Upgrades;
  player: ShipSnapshot;
  enemies: ShipSnapshot[];
  projectiles: { id: number; owner: Projectile['owner']; x: number; y: number }[];
  powerUps: { id: number; kind: PowerUpKind; x: number; y: number; ttl: number }[];
}

export interface ShipSnapshot {
  id: number;
  kind: ShipKind;
  variant: EnemyVariant | 'player';
  x: number;
  y: number;
  heading: number;
  speed: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  cooldowns: Record<WeaponSlot, number>;
  age: number;
}

/**
 * Pure game rules: no rendering, DOM or wall-clock access. `step(dt)` advances
 * the world by a fixed amount of simulated time; everything else is derived
 * from the config snapshot and seeded RNGs, which makes matches reproducible
 * and testable in isolation.
 *
 * Three independent RNG streams keep concerns apart: spawning (where and what),
 * AI temperament/wandering, and loot. A change in one never shifts the others.
 */
export class Simulation {
  readonly config: Readonly<GameConfig>;
  readonly player: Ship;
  readonly enemies: Ship[] = [];
  readonly projectiles: Projectile[] = [];
  readonly powerUps: PowerUp[] = [];
  readonly obstacles: readonly Obstacle[] = OBSTACLES;

  status: SimStatus = 'running';
  endReason: EndReason | null = null;
  /** Simulated seconds of active play. */
  elapsed = 0;
  score = 0;
  readonly spawned: Record<EnemyKind, number> = { chaser: 0, shooter: 0 };
  /** Permanent upgrades collected during this match (a new match starts from zero). */
  readonly upgrades: Upgrades = { damage: 0, fireRate: 0, spread: 0 };
  /** Current wave (1-based) and kills counted towards it. */
  wave = 1;
  waveKills = 0;

  private readonly rng: Rng;
  private readonly aiRng: Rng;
  private readonly lootRng: Rng;
  private readonly nav: NavigationGrid;
  private nextId = 1;
  private spawnTimer: number;
  private spawnCount = 0;
  private flowTimer = 0;
  private events: SimEvent[] = [];

  constructor(config: Readonly<GameConfig>) {
    this.config = config;
    this.rng = new Rng(config.seed);
    this.aiRng = new Rng(config.seed ^ 0xa11ce);
    this.lootRng = new Rng(config.seed ^ 0x100f);
    this.nav = new NavigationGrid(config.arena.width, config.arena.height, this.obstacles);
    this.spawnTimer = config.spawn.initialDelay;
    this.player = this.createShip('player', 'player', PLAYER_START.x, PLAYER_START.y, PLAYER_START.heading, config.player, {
      style: PLAYER_STYLE,
      tint: 0xffffff,
    });
  }

  get remaining(): number {
    return Math.max(0, this.config.sessionTime - this.elapsed);
  }

  /** Enemies allowed at once: grows with each wave. */
  get maxAlive(): number {
    const w = this.config.waves;
    return Math.min(w.maxAliveCap, this.config.spawn.maxAlive + w.maxAlivePerWave * (this.wave - 1));
  }

  /** Kills needed to clear the current wave: 2, 4, 6... by default. */
  get waveTarget(): number {
    return this.config.waves.firstTarget + this.config.waves.increment * (this.wave - 1);
  }

  get wavesCleared(): number {
    return this.wave - 1;
  }

  /** Returns and clears the events produced since the last call. */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Advances the world by `dt` simulated seconds using the given player controls. */
  step(dt: number, controls: Readonly<ShipControls>): void {
    if (this.status !== 'running') return;

    this.elapsed += dt;
    this.storePreviousPoses();

    Object.assign(this.player.controls, controls);
    this.updateNavigation(dt);
    for (const enemy of this.enemies) this.think(enemy, dt);

    this.moveShip(this.player, dt);
    for (const enemy of this.enemies) this.moveShip(enemy, dt);
    this.resolveShipContacts();

    this.fireWeapons(this.player, dt);
    for (const enemy of this.enemies) this.fireWeapons(enemy, dt);

    this.updateProjectiles(dt);
    this.updatePowerUps(dt);
    this.removeDead();
    this.updateSpawner(dt);
    this.checkEnd();
  }

  // ---------------------------------------------------------------------------
  // Entities

  private createShip(
    kind: ShipKind,
    variant: Ship['variant'],
    x: number,
    y: number,
    heading: number,
    hull: Readonly<ShipHullConfig>,
    extra: Pick<Ship, 'style' | 'tint'> & Partial<Pick<Ship, 'chaser' | 'shooter' | 'ai'>>,
  ): Ship {
    return {
      id: this.nextId++,
      kind,
      variant,
      x,
      y,
      heading,
      prevX: x,
      prevY: y,
      prevHeading: heading,
      speed: 0,
      hp: hull.maxHealth,
      maxHp: hull.maxHealth,
      alive: true,
      hull,
      age: 0,
      cooldowns: { front: 0, left: 0, right: 0 },
      controls: idleControls(),
      blocked: false,
      ...extra,
    };
  }

  private storePreviousPoses(): void {
    const store = (s: Ship) => {
      s.prevX = s.x;
      s.prevY = s.y;
      s.prevHeading = s.heading;
    };
    store(this.player);
    this.enemies.forEach(store);
    for (const p of this.projectiles) {
      p.prevX = p.x;
      p.prevY = p.y;
    }
  }

  // ---------------------------------------------------------------------------
  // Enemy behaviour

  private updateNavigation(dt: number): void {
    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      this.flowTimer = FLOW_FIELD_REFRESH;
      this.nav.buildFlowField(this.player.x, this.player.y);
    }
  }

  /**
   * Writes the enemy's controls for this step. Steering is re-evaluated only
   * every `reaction` seconds (per-enemy temperament), so enemies overshoot,
   * hesitate and can be out-manoeuvred; firing is checked every step against
   * an aim that is slightly off (re-rolled after each shot).
   */
  private think(enemy: Ship, dt: number): void {
    const ai = enemy.ai!;
    const c = enemy.controls;
    const target = this.player;
    const distance = dist(enemy.x, enemy.y, target.x, target.y);
    const lineOfSight = this.nav.hasLineOfSight(enemy.x, enemy.y, target.x, target.y);
    const direct = Math.atan2(target.y - enemy.y, target.x - enemy.x);
    const route = () => (lineOfSight ? direct : (this.nav.flowDirection(enemy.x, enemy.y) ?? direct));
    const canAttack = enemy.age >= this.config.spawn.spawnGrace && lineOfSight;

    ai.distracted = Math.max(0, ai.distracted - dt);
    ai.reactTimer -= dt;
    const decide = ai.reactTimer <= 0;
    if (decide) ai.reactTimer = this.aiRng.range(ai.reaction[0], ai.reaction[1]);

    c.fireFront = false;
    c.fireLeft = false;
    c.fireRight = false;

    switch (enemy.variant) {
      case 'drifter':
        if (!ai.aggro && (distance < this.config.spawn.variants.chaser.drifter.aggroRange || enemy.hp < enemy.maxHp)) ai.aggro = true;
        // An aggravated drifter hunts like a standard chaser.
        if (!ai.aggro) {
          if (decide) this.wander(enemy);
        } else this.hunt(enemy, decide, route);
        break;
      case 'sprinter':
        this.hunt(enemy, decide, route);
        break;
      case 'standard':
        if (enemy.kind === 'chaser') {
          this.hunt(enemy, decide, route);
          break;
        }
        if (decide) {
          const cfg = enemy.shooter!;
          ai.desired = route();
          ai.thrust = true;
          if (lineOfSight && distance <= cfg.preferredDistance) {
            // In position: stop closing in and keep the bow on the target.
            ai.desired = direct;
            ai.thrust = distance > cfg.preferredDistance * 0.85 && Math.abs(angleDelta(enemy.heading, direct)) < 0.5;
          }
        }
        c.fireFront = canAttack && distance <= enemy.shooter!.attackRange && this.aimed(enemy, direct, 0);
        break;
      case 'flanker': {
        const cfg = enemy.shooter!;
        if (decide) {
          if (!lineOfSight || distance > cfg.attackRange * 1.4) {
            ai.desired = route();
          } else {
            if (enemy.blocked) ai.orbit = ai.orbit === 1 ? -1 : 1;
            // Tangent to a circle around the player, bent inwards when too far and outwards when too close.
            const correction = clamp(((distance - cfg.preferredDistance) / cfg.preferredDistance) * 1.2, -0.7, 0.7);
            ai.desired = direct + ai.orbit * (Math.PI / 2 - correction);
          }
          ai.thrust = true;
        }
        if (canAttack && distance <= cfg.attackRange) {
          c.fireRight = this.aimed(enemy, direct, Math.PI / 2);
          c.fireLeft = this.aimed(enemy, direct, -Math.PI / 2);
        }
        break;
      }
      case 'sentinel': {
        if (decide) {
          const toAnchor = dist(enemy.x, enemy.y, ai.anchorX, ai.anchorY);
          if (toAnchor > 30) {
            ai.desired = Math.atan2(ai.anchorY - enemy.y, ai.anchorX - enemy.x);
            ai.thrust = true;
          } else {
            ai.desired = direct;
            ai.thrust = false;
          }
        }
        c.fireFront = canAttack && distance <= enemy.shooter!.attackRange && this.aimed(enemy, direct, 0);
        break;
      }
    }

    c.thrust = ai.thrust;
    const delta = angleDelta(enemy.heading, ai.desired);
    const deadZone = 0.04;
    c.turnLeft = delta < -deadZone;
    c.turnRight = delta > deadZone;
    // Chasers slow down for sharp turns so they do not orbit their target.
    if (Math.abs(delta) > 1.6 && enemy.kind === 'chaser') c.thrust = enemy.speed < enemy.hull.maxSpeed * 0.5;
  }

  /** Chaser steering: straight for the player (or around islands), with occasional loss of interest. */
  private hunt(enemy: Ship, decide: boolean, route: () => number): void {
    const ai = enemy.ai!;
    if (ai.distracted > 0) {
      if (decide) this.wander(enemy);
      return;
    }
    if (!decide) return;
    ai.desired = route();
    ai.thrust = true;
    const meanReaction = (ai.reaction[0] + ai.reaction[1]) * 0.5;
    if (this.aiRng.next() < this.config.temperament.giveUpChance * meanReaction) {
      const [min, max] = this.config.temperament.giveUpDuration;
      ai.distracted = this.aiRng.range(min, max);
      this.pickWaypoint(ai);
    }
  }

  /** True when the weapon pointing at `heading + slotOffset` is within tolerance of the (imperfect) aim. */
  private aimed(enemy: Ship, direct: number, slotOffset: number): boolean {
    const error = Math.abs(angleDelta(enemy.heading + slotOffset, direct + enemy.ai!.aimOffset));
    return error <= enemy.shooter!.aimTolerance;
  }

  /** Aimless sailing between random open-water waypoints. */
  private wander(enemy: Ship): void {
    const ai = enemy.ai!;
    if (enemy.blocked || dist(enemy.x, enemy.y, ai.waypointX, ai.waypointY) < 60) this.pickWaypoint(ai);
    ai.desired = Math.atan2(ai.waypointY - enemy.y, ai.waypointX - enemy.x);
    ai.thrust = true;
  }

  private pickWaypoint(ai: AiState): void {
    const { width, height } = this.config.arena;
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = this.aiRng.range(100, width - 100);
      const y = this.aiRng.range(100, height - 100);
      if (this.obstacles.every((o) => obstacleDistance(x, y, o).d > 60)) {
        ai.waypointX = x;
        ai.waypointY = y;
        return;
      }
    }
    ai.waypointX = width / 2;
    ai.waypointY = height / 2 - 40;
  }

  // ---------------------------------------------------------------------------
  // Movement and obstacle collisions

  private moveShip(ship: Ship, dt: number): void {
    const { hull, controls } = ship;
    ship.age += dt;

    const turn = (controls.turnRight ? 1 : 0) - (controls.turnLeft ? 1 : 0);
    ship.heading += turn * hull.turnSpeed * dt;

    if (controls.thrust) ship.speed = Math.min(hull.maxSpeed, ship.speed + hull.acceleration * dt);
    else ship.speed = Math.max(0, ship.speed - hull.drag * dt);

    ship.x += Math.cos(ship.heading) * ship.speed * dt;
    ship.y += Math.sin(ship.heading) * ship.speed * dt;

    ship.blocked = this.resolveObstacles(ship);
    if (ship.blocked) ship.speed = Math.min(ship.speed, hull.maxSpeed * 0.5);
  }

  /** Pushes the three hull circles out of obstacles and arena borders. */
  private resolveObstacles(ship: Ship): boolean {
    const { width, height } = this.config.arena;
    const r = ship.hull.hullRadius;
    let touched = false;
    for (let iteration = 0; iteration < 3; iteration++) {
      let moved = false;
      const cos = Math.cos(ship.heading);
      const sin = Math.sin(ship.heading);
      for (const offset of HULL_CIRCLES) {
        const along = offset * ship.hull.halfLength;
        const cx = ship.x + cos * along;
        const cy = ship.y + sin * along;
        // Arena borders (the visible arena is the playable area).
        let px = 0;
        let py = 0;
        if (cx - r < 0) px = r - cx;
        else if (cx + r > width) px = width - r - cx;
        if (cy - r < 0) py = r - cy;
        else if (cy + r > height) py = height - r - cy;
        for (const o of this.obstacles) {
          const pen = circleVsObstacle(cx + px, cy + py, r, o);
          if (pen) {
            px += pen.nx * pen.depth;
            py += pen.ny * pen.depth;
          }
        }
        if (px !== 0 || py !== 0) {
          ship.x += px;
          ship.y += py;
          moved = true;
        }
      }
      if (!moved) break;
      touched = true;
    }
    return touched;
  }

  /** Ship-vs-ship contacts: chaser impacts and separation of overlapping hulls. */
  private resolveShipContacts(): void {
    const player = this.player;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const overlap = this.hullOverlap(player, enemy);
      if (overlap <= 0) continue;
      if (enemy.kind === 'chaser') {
        this.chaserImpact(enemy);
      } else {
        this.separate(player, enemy, overlap, 0.5);
      }
    }
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i]!;
      if (!a.alive) continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j]!;
        if (!b.alive) continue;
        const overlap = this.hullOverlap(a, b);
        if (overlap > 0) this.separate(a, b, overlap, 0.5);
      }
    }
  }

  /** Largest overlap between the hull circles of two ships (<= 0 means no contact). */
  private hullOverlap(a: Ship, b: Ship): number {
    let best = -Infinity;
    const ac = Math.cos(a.heading);
    const as = Math.sin(a.heading);
    const bc = Math.cos(b.heading);
    const bs = Math.sin(b.heading);
    for (const oa of HULL_CIRCLES) {
      const ax = a.x + ac * oa * a.hull.halfLength;
      const ay = a.y + as * oa * a.hull.halfLength;
      for (const ob of HULL_CIRCLES) {
        const bx = b.x + bc * ob * b.hull.halfLength;
        const by = b.y + bs * ob * b.hull.halfLength;
        const overlap = a.hull.hullRadius + b.hull.hullRadius - dist(ax, ay, bx, by);
        if (overlap > best) best = overlap;
      }
    }
    return best;
  }

  private separate(a: Ship, b: Ship, overlap: number, share: number): void {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const push = Math.min(overlap, 8);
    a.x -= dx * push * share;
    a.y -= dy * push * share;
    b.x += dx * push * (1 - share);
    b.y += dy * push * (1 - share);
    this.resolveObstacles(a);
    this.resolveObstacles(b);
  }

  private chaserImpact(chaser: Ship): void {
    const damage = chaser.chaser!.impactDamage;
    this.events.push({ type: 'impact', shipId: chaser.id, x: chaser.x, y: chaser.y, damage });
    // Self-destruction: no score, no loot and no wave progress for the player.
    this.destroyShip(chaser, 'impact');
    this.damageShip(this.player, damage, chaser.x, chaser.y, 'impact');
  }

  // ---------------------------------------------------------------------------
  // Weapons and projectiles

  /** Multipliers from the permanent upgrades collected this match. */
  private get damageMultiplier(): number {
    return 1 + this.config.powerUps.damagePerStack * this.upgrades.damage;
  }

  private get cooldownMultiplier(): number {
    return 1 / (1 + this.config.powerUps.fireRatePerStack * this.upgrades.fireRate);
  }

  private fireWeapons(ship: Ship, dt: number): void {
    const cd = ship.cooldowns;
    cd.front = Math.max(0, cd.front - dt);
    cd.left = Math.max(0, cd.left - dt);
    cd.right = Math.max(0, cd.right - dt);
    if (!ship.alive) return;

    if (ship.kind === 'player') {
      const { frontCannon, broadside } = this.config.player;
      const damage = this.damageMultiplier;
      const cooldown = this.cooldownMultiplier;
      if (ship.controls.fireFront && cd.front <= 0) {
        cd.front = frontCannon.cooldown * cooldown;
        const balls = 1 + this.config.powerUps.spreadBallsPerStack * this.upgrades.spread;
        this.fireFront(ship, frontCannon, 'player', balls, damage);
      }
      if (ship.controls.fireLeft && cd.left <= 0) {
        cd.left = broadside.cooldown * cooldown;
        this.fireBroadside(ship, 'left', broadside, broadside.count, broadside.spacing, 'player', damage);
      }
      if (ship.controls.fireRight && cd.right <= 0) {
        cd.right = broadside.cooldown * cooldown;
        this.fireBroadside(ship, 'right', broadside, broadside.count, broadside.spacing, 'player', damage);
      }
      return;
    }

    const shooter = ship.shooter;
    if (!shooter) return;
    const weapon = shooter.weapon;
    if (ship.controls.fireFront && cd.front <= 0) {
      cd.front = weapon.cooldown;
      this.fireFront(ship, weapon, 'enemy', 1, 1);
      this.rerollAim(ship);
    }
    if ((ship.controls.fireLeft || ship.controls.fireRight) && cd.left <= 0 && cd.right <= 0) {
      const flanker = this.config.spawn.variants.shooter.flanker;
      // Both sides share one reload: a flanker fires one side at a time.
      cd.left = weapon.cooldown;
      cd.right = weapon.cooldown;
      this.fireBroadside(ship, ship.controls.fireLeft ? 'left' : 'right', weapon, flanker.broadsideCount, flanker.broadsideSpacing, 'enemy', 1);
      this.rerollAim(ship);
    }
  }

  private rerollAim(ship: Ship): void {
    const ai = ship.ai;
    if (ai) ai.aimOffset = this.aiRng.range(-ai.aimError, ai.aimError);
  }

  /** Bow cannon; with `balls` > 1 the balls fan out symmetrically (spread upgrade). */
  private fireFront(ship: Ship, weapon: Readonly<WeaponConfig>, owner: Projectile['owner'], balls: number, damageMultiplier: number): void {
    const bow = ship.hull.halfLength + ship.hull.hullRadius * 0.6;
    const x = ship.x + Math.cos(ship.heading) * bow;
    const y = ship.y + Math.sin(ship.heading) * bow;
    const angle = this.config.powerUps.spreadAngle;
    for (let i = 0; i < balls; i++) {
      const heading = ship.heading + (i - (balls - 1) / 2) * angle;
      this.spawnProjectile(owner, ship.id, x, y, heading, weapon, weapon.damage * damageMultiplier);
    }
    this.events.push({ type: 'shot', shipId: ship.id, kind: ship.kind, slot: 'front', x, y, heading: ship.heading, count: balls });
  }

  /** Parallel balls perpendicular to the hull, spread along its length. */
  private fireBroadside(
    ship: Ship,
    side: 'left' | 'right',
    weapon: Readonly<WeaponConfig>,
    count: number,
    spacing: number,
    owner: Projectile['owner'],
    damageMultiplier: number,
  ): void {
    const sign = side === 'left' ? -1 : 1;
    const dir = ship.heading + (sign * Math.PI) / 2;
    const fx = Math.cos(ship.heading);
    const fy = Math.sin(ship.heading);
    const sx = Math.cos(dir);
    const sy = Math.sin(dir);
    const out = ship.hull.hullRadius + 2;
    for (let i = 0; i < count; i++) {
      const along = (i - (count - 1) / 2) * spacing;
      this.spawnProjectile(owner, ship.id, ship.x + fx * along + sx * out, ship.y + fy * along + sy * out, dir, weapon, weapon.damage * damageMultiplier);
    }
    this.events.push({
      type: 'shot',
      shipId: ship.id,
      kind: ship.kind,
      slot: side,
      x: ship.x + sx * out,
      y: ship.y + sy * out,
      heading: dir,
      count,
    });
  }

  private spawnProjectile(
    owner: Projectile['owner'],
    shooterId: number,
    x: number,
    y: number,
    heading: number,
    weapon: Readonly<WeaponConfig>,
    damage: number,
  ): void {
    this.projectiles.push({
      id: this.nextId++,
      owner,
      shooterId,
      x,
      y,
      prevX: x,
      prevY: y,
      vx: Math.cos(heading) * weapon.projectileSpeed,
      vy: Math.sin(heading) * weapon.projectileSpeed,
      damage,
      radius: weapon.projectileRadius,
      ttl: weapon.lifetime,
      distanceLeft: weapon.range,
      alive: true,
    });
  }

  private updateProjectiles(dt: number): void {
    const { width, height } = this.config.arena;
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.ttl -= dt;
      p.distanceLeft -= Math.hypot(p.vx, p.vy) * dt;

      if (p.owner === 'player') {
        for (const enemy of this.enemies) {
          if (enemy.alive && this.projectileHits(p, enemy)) {
            this.endProjectile(p, 'hit');
            this.damageShip(enemy, p.damage, p.x, p.y);
            break;
          }
        }
      } else if (this.player.alive && this.projectileHits(p, this.player)) {
        this.endProjectile(p, 'hit');
        this.damageShip(this.player, p.damage, p.x, p.y);
      }
      if (!p.alive) continue;

      if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) this.endProjectile(p, 'out_of_bounds');
      else if (this.obstacles.some((o) => obstacleDistance(p.x, p.y, o).d < p.radius * 0.5)) this.endProjectile(p, 'obstacle');
      else if (p.ttl <= 0 || p.distanceLeft <= 0) this.endProjectile(p, 'expired');
    }
  }

  /** Projectile circle vs ship capsule (hull axis grown by hullRadius). */
  private projectileHits(p: Projectile, ship: Ship): boolean {
    const hl = ship.hull.halfLength;
    const cos = Math.cos(ship.heading);
    const sin = Math.sin(ship.heading);
    const reach = ship.hull.hullRadius + p.radius;
    // Test the swept segment end points to avoid tunnelling at high speed.
    const d2 = Math.min(
      pointSegmentDist2(p.x, p.y, ship.x - cos * hl, ship.y - sin * hl, ship.x + cos * hl, ship.y + sin * hl),
      pointSegmentDist2(
        (p.x + p.prevX) / 2,
        (p.y + p.prevY) / 2,
        ship.x - cos * hl,
        ship.y - sin * hl,
        ship.x + cos * hl,
        ship.y + sin * hl,
      ),
    );
    return d2 <= reach * reach;
  }

  private endProjectile(p: Projectile, reason: ProjectileEndReason): void {
    p.alive = false;
    this.events.push({ type: 'projectile_end', projectileId: p.id, reason, x: p.x, y: p.y });
  }

  // ---------------------------------------------------------------------------
  // Power-ups

  private dropPowerUp(x: number, y: number): void {
    const cfg = this.config.powerUps;
    if (this.lootRng.next() >= cfg.dropChance) return;
    let kind = this.lootRng.weighted(cfg.weights);
    if (kind !== 'repair' && this.upgrades[kind] >= cfg.maxStacks[kind]) kind = 'repair';
    const powerUp: PowerUp = { id: this.nextId++, kind, x, y, ttl: cfg.lifetime, alive: true };
    this.powerUps.push(powerUp);
    this.events.push({ type: 'powerup_spawned', id: powerUp.id, kind, x, y });
  }

  private updatePowerUps(dt: number): void {
    const p = this.player;
    const reach = this.config.powerUps.pickupRadius + p.hull.hullRadius;
    const hl = p.hull.halfLength;
    const cos = Math.cos(p.heading);
    const sin = Math.sin(p.heading);
    for (const powerUp of this.powerUps) {
      if (!powerUp.alive) continue;
      powerUp.ttl -= dt;
      const d2 = pointSegmentDist2(powerUp.x, powerUp.y, p.x - cos * hl, p.y - sin * hl, p.x + cos * hl, p.y + sin * hl);
      if (p.alive && d2 <= reach * reach) {
        powerUp.alive = false;
        const stacks = this.applyPowerUp(powerUp.kind);
        this.events.push({ type: 'powerup_collected', id: powerUp.id, kind: powerUp.kind, x: powerUp.x, y: powerUp.y, stacks });
      } else if (powerUp.ttl <= 0) {
        powerUp.alive = false;
        this.events.push({ type: 'powerup_expired', id: powerUp.id, x: powerUp.x, y: powerUp.y });
      }
    }
  }

  /** Applies a power-up; returns the resulting stack count (0 for repair). */
  private applyPowerUp(kind: PowerUpKind): number {
    const cfg = this.config.powerUps;
    if (kind === 'repair' || this.upgrades[kind] >= cfg.maxStacks[kind]) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + cfg.repairAmount);
      return 0;
    }
    this.upgrades[kind] += 1;
    return this.upgrades[kind];
  }

  /** A random upgrade that is not maxed yet, or null when everything is maxed. */
  private pickUpgrade(): UpgradeKind | null {
    const cfg = this.config.powerUps;
    const open = UPGRADES.filter((k) => this.upgrades[k] < cfg.maxStacks[k]);
    if (open.length === 0) return null;
    const weights = Object.fromEntries(open.map((k) => [k, cfg.weights[k]])) as Record<UpgradeKind, number>;
    return this.lootRng.weighted(weights);
  }

  // ---------------------------------------------------------------------------
  // Damage, destruction, score and waves

  private damageShip(ship: Ship, damage: number, x: number, y: number, cause: DestroyCause = 'projectile'): void {
    if (!ship.alive || this.status !== 'running') return;
    ship.hp = Math.max(0, ship.hp - damage);
    this.events.push({ type: 'hit', shipId: ship.id, kind: ship.kind, x, y, damage, hp: ship.hp, maxHp: ship.maxHp });
    if (ship.hp <= 0) this.destroyShip(ship, cause);
  }

  private destroyShip(ship: Ship, cause: DestroyCause): void {
    if (!ship.alive) return;
    ship.alive = false;
    ship.speed = 0;
    this.events.push({ type: 'ship_destroyed', shipId: ship.id, kind: ship.kind, x: ship.x, y: ship.y, heading: ship.heading, cause });
    // Only enemies sunk by the player's cannons score, drop loot and count towards the wave.
    if (ship.kind === 'player' || cause !== 'projectile') return;
    this.score += 1;
    this.events.push({ type: 'score', score: this.score });
    this.dropPowerUp(ship.x, ship.y);
    this.waveKills += 1;
    if (this.waveKills >= this.waveTarget) this.clearWave();
  }

  /** Wave reward: heal, a free upgrade, and (optionally) a clean sea for the next wave. */
  private clearWave(): void {
    const cfg = this.config.waves;
    const cleared = this.wave;
    this.wave += 1;
    this.waveKills = 0;
    const player = this.player;
    const heal = Math.min(cfg.rewardHeal, player.maxHp - player.hp);
    player.hp += heal;
    const upgrade = cfg.rewardUpgrade ? this.pickUpgrade() : null;
    if (upgrade) this.upgrades[upgrade] += 1;
    if (cfg.clearBoard) {
      for (const enemy of this.enemies) if (enemy.alive) this.destroyShip(enemy, 'wave_clear');
      for (const p of this.projectiles) if (p.alive && p.owner === 'enemy') this.endProjectile(p, 'expired');
    }
    this.events.push({ type: 'wave_cleared', wave: cleared, nextTarget: this.waveTarget, heal, upgrade });
  }

  private removeDead(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) if (!this.enemies[i]!.alive) this.enemies.splice(i, 1);
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (!this.projectiles[i]!.alive) this.projectiles.splice(i, 1);
    for (let i = this.powerUps.length - 1; i >= 0; i--) if (!this.powerUps[i]!.alive) this.powerUps.splice(i, 1);
  }

  // ---------------------------------------------------------------------------
  // Spawning

  private updateSpawner(dt: number): void {
    const cfg = this.config.spawn;
    this.spawnTimer -= dt;
    while (this.spawnTimer <= 0) {
      this.spawnTimer += cfg.interval;
      if (this.enemies.length >= this.maxAlive) continue;
      const point = this.pickSpawnPoint();
      if (!point) continue;
      const forced = cfg.openingSequence[this.spawnCount];
      const kind = forced ?? this.rng.weighted(cfg.weights);
      const variant: EnemyVariant = forced
        ? 'standard'
        : this.rng.weighted(
            Object.fromEntries(Object.entries(cfg.variants[kind]).map(([id, v]) => [id, (v as { weight: number }).weight])) as Record<
              EnemyVariant,
              number
            >,
          );
      this.spawnCount++;
      const enemy = this.createEnemy(kind, variant, point.x, point.y);
      this.enemies.push(enemy);
      this.spawned[kind]++;
      this.events.push({ type: 'ship_spawned', shipId: enemy.id, kind, variant });
    }
  }

  private createEnemy(kind: EnemyKind, variant: EnemyVariant, x: number, y: number): Ship {
    const variants = this.config.spawn.variants;
    const def = kind === 'chaser' ? variants.chaser[variant as keyof typeof variants.chaser] : variants.shooter[variant as keyof typeof variants.shooter];
    const base = kind === 'chaser' ? this.config.chaser : this.config.shooter;
    const stats = deepMerge(structuredClone(base), def.patch ?? {}) as ChaserConfig | ShooterConfig;
    // Later waves bring sturdier, harder-hitting enemies.
    const w = this.wave - 1;
    stats.maxHealth = Math.round(stats.maxHealth * (1 + this.config.waves.enemyHealthPerWave * w));
    const hit = 1 + this.config.waves.enemyDamagePerWave * w;
    if (kind === 'chaser') (stats as ChaserConfig).impactDamage *= hit;
    else (stats as ShooterConfig).weapon = { ...(stats as ShooterConfig).weapon, damage: (stats as ShooterConfig).weapon.damage * hit };

    const t = this.config.temperament;
    const aimError = this.aiRng.range(t.aimError[0], t.aimError[1]);
    const reaction: [number, number] = [t.reaction[0], this.aiRng.range(t.reaction[0], t.reaction[1])];
    const ai: AiState = {
      reactTimer: 0,
      reaction,
      desired: Math.atan2(this.player.y - y, this.player.x - x),
      thrust: true,
      aimError,
      aimOffset: this.aiRng.range(-aimError, aimError),
      distracted: 0,
      aggro: false,
      waypointX: x,
      waypointY: y,
      orbit: this.aiRng.next() < 0.5 ? 1 : -1,
      anchorX: x,
      anchorY: y,
    };
    if (variant === 'drifter') this.pickWaypoint(ai);
    if (variant === 'sentinel') {
      // Guard post: a little inside the arena from the spawn point, in open water.
      const { width, height } = this.config.arena;
      const inset = variants.shooter.sentinel.anchorInset;
      const a = Math.atan2(height / 2 - y, width / 2 - x);
      const ax = x + Math.cos(a) * inset;
      const ay = y + Math.sin(a) * inset;
      if (this.obstacles.every((o) => obstacleDistance(ax, ay, o).d > 60)) {
        ai.anchorX = ax;
        ai.anchorY = ay;
      }
    }
    const heading = Math.atan2(this.player.y - y, this.player.x - x);
    return this.createShip(kind, variant, x, y, heading, stats, {
      style: def.style,
      tint: def.tint ?? 0xffffff,
      ...(kind === 'chaser' ? { chaser: stats as ChaserConfig } : { shooter: stats as ShooterConfig }),
      ai,
    });
  }

  /** A random candidate that is free of obstacles and ships and far from the player. */
  private pickSpawnPoint(): { x: number; y: number } | null {
    const minD2 = this.config.spawn.minPlayerDistance ** 2;
    const clearance = 56;
    const valid = this.config.spawn.points.filter(
      (p) =>
        dist2(p.x, p.y, this.player.x, this.player.y) >= minD2 &&
        this.obstacles.every((o) => obstacleDistance(p.x, p.y, o).d >= clearance) &&
        this.enemies.every((e) => dist2(p.x, p.y, e.x, e.y) >= clearance * clearance * 4),
    );
    return valid.length > 0 ? this.rng.pick(valid) : null;
  }

  // ---------------------------------------------------------------------------
  // Match end

  private checkEnd(): void {
    if (!this.player.alive || this.player.hp <= 0) this.end('defeated');
    else if (this.elapsed >= this.config.sessionTime - 1e-9) this.end('time_up');
  }

  private end(reason: EndReason): void {
    if (this.status === 'ended') return;
    this.status = 'ended';
    this.endReason = reason;
    this.elapsed = clamp(this.elapsed, 0, this.config.sessionTime);
    this.player.speed = 0;
    this.events.push({ type: 'ended', reason });
  }

  // ---------------------------------------------------------------------------
  // Observation (tests, HUD, profiling)

  snapshot(): SimSnapshot {
    const ship = (s: Ship): ShipSnapshot => ({
      id: s.id,
      kind: s.kind,
      variant: s.variant,
      x: s.x,
      y: s.y,
      heading: s.heading,
      speed: s.speed,
      hp: s.hp,
      maxHp: s.maxHp,
      alive: s.alive,
      cooldowns: { ...s.cooldowns },
      age: s.age,
    });
    return {
      status: this.status,
      endReason: this.endReason,
      elapsed: this.elapsed,
      remaining: this.remaining,
      score: this.score,
      spawned: { ...this.spawned },
      wave: this.wave,
      waveKills: this.waveKills,
      waveTarget: this.waveTarget,
      wavesCleared: this.wavesCleared,
      upgrades: { ...this.upgrades },
      player: ship(this.player),
      enemies: this.enemies.map(ship),
      projectiles: this.projectiles.map((p) => ({ id: p.id, owner: p.owner, x: p.x, y: p.y })),
      powerUps: this.powerUps.map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, ttl: p.ttl })),
    };
  }
}

