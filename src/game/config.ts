import { SPAWN_POINTS } from './arena/arenaMap';

/**
 * Central, typed gameplay configuration.
 *
 * Every balancing number used by the simulation lives here. Systems read the
 * values from the frozen `GameConfig` snapshot they receive when a match starts,
 * so tuning the game never requires touching system logic.
 *
 * Units: distances in world pixels, time in seconds, angles in radians,
 * speeds in px/s, turn rates in rad/s.
 */

export type EnemyKind = 'chaser' | 'shooter';

/** Behavioural variants of the two required enemy types. */
export type ChaserVariant = 'standard' | 'drifter' | 'sprinter';
export type ShooterVariant = 'standard' | 'flanker' | 'sentinel';
export type EnemyVariant = ChaserVariant | ShooterVariant;

export type PowerUpKind = 'damage' | 'fireRate' | 'spread' | 'repair';
/** Permanent upgrades (repair is instant and does not stack). */
export type UpgradeKind = Exclude<PowerUpKind, 'repair'>;

export interface WeaponConfig {
  /** Damage applied once per projectile hit. */
  damage: number;
  /** Projectile speed in px/s. */
  projectileSpeed: number;
  /** Maximum travel distance before the projectile expires. */
  range: number;
  /** Maximum lifetime; whichever of range/lifetime is reached first wins. */
  lifetime: number;
  /** Minimum time between two shots of this weapon. */
  cooldown: number;
  /** Collision radius of the projectile. */
  projectileRadius: number;
}

export interface BroadsideConfig extends WeaponConfig {
  /** Number of parallel projectiles per volley. */
  count: number;
  /** Distance between two parallel projectiles, along the hull. */
  spacing: number;
}

export interface ShipHullConfig {
  maxHealth: number;
  /** Top speed moving forward. */
  maxSpeed: number;
  /** Forward acceleration while thrusting. */
  acceleration: number;
  /** Deceleration when not thrusting. */
  drag: number;
  /** Turn rate in rad/s. */
  turnSpeed: number;
  /** Visual scale applied to the 66x113 ship sprite. */
  scale: number;
  /** Radius of each of the three circles (bow, mid, stern) used against obstacles. */
  hullRadius: number;
  /** Half length of the hull capsule used for projectile hits. */
  halfLength: number;
}

export interface ChaserConfig extends ShipHullConfig {
  /** Damage dealt to the player when the chaser rams it (the chaser explodes). */
  impactDamage: number;
}

export interface ShooterConfig extends ShipHullConfig {
  /** The shooter fires when the player is closer than this distance. */
  attackRange: number;
  /** Distance the shooter tries to keep from the player. */
  preferredDistance: number;
  /** Maximum heading error (rad) that still allows firing. */
  aimTolerance: number;
  weapon: WeaponConfig;
}

export interface VariantConfig<T> {
  /** Relative spawn weight among the variants of the same type. */
  weight: number;
  /** Sail colour of the ship sprites (1..6). */
  style: number;
  /** Optional tint multiplied over the sprite. */
  tint?: number;
  /** Values that differ from the base type config. */
  patch?: DeepPartial<T>;
}

export interface ChaserVariantsConfig {
  standard: VariantConfig<ChaserConfig>;
  /** Wanders around until the player comes close (or shoots it), then hunts. */
  drifter: VariantConfig<ChaserConfig> & { aggroRange: number };
  /** Small, fast and fragile. */
  sprinter: VariantConfig<ChaserConfig>;
}

export interface ShooterVariantsConfig {
  standard: VariantConfig<ShooterConfig>;
  /** Circles the player and only fires sideways (two-ball broadside). */
  flanker: VariantConfig<ShooterConfig> & { broadsideCount: number; broadsideSpacing: number };
  /** Sails to a guard post near its spawn point, then holds and fires from long range. */
  sentinel: VariantConfig<ShooterConfig> & { anchorInset: number };
}

/**
 * Imperfections that make enemies feel less robotic. Each enemy rolls its own
 * values from these ranges when it spawns (seeded RNG).
 */
export interface TemperamentConfig {
  /** Seconds between two re-evaluations of where to steer. */
  reaction: [number, number];
  /** Maximum random aim offset (rad), re-rolled after every shot. */
  aimError: [number, number];
  /** Chance per second that a hunting chaser loses interest for a while. */
  giveUpChance: number;
  giveUpDuration: [number, number];
}

export interface PowerUpConfig {
  /** Probability that an enemy sunk by the player drops a power-up. */
  dropChance: number;
  /** Seconds a power-up floats before sinking. */
  lifetime: number;
  pickupRadius: number;
  weights: Record<PowerUpKind, number>;
  /** Stacks are permanent for the match and capped per kind. */
  maxStacks: Record<UpgradeKind, number>;
  /** Damage multiplier added per `damage` stack. */
  damagePerStack: number;
  /** Cooldown divisor added per `fireRate` stack (cooldown / (1 + n * value)). */
  fireRatePerStack: number;
  /** Extra bow balls per `spread` stack, fanned out by `spreadAngle`. */
  spreadBallsPerStack: number;
  spreadAngle: number;
  /** Health restored by a repair kit. */
  repairAmount: number;
}

export interface WaveConfig {
  /** Kills needed to clear the first wave. */
  firstTarget: number;
  /** Extra kills needed by every following wave. */
  increment: number;
  /** Health restored when a wave is cleared. */
  rewardHeal: number;
  /** A free permanent upgrade is granted when a wave is cleared. */
  rewardUpgrade: boolean;
  /** Remaining enemies and their balls are sunk when a wave is cleared (no score). */
  clearBoard: boolean;
  /** Enemy health multiplier added per wave after the first. */
  enemyHealthPerWave: number;
  /** Enemy damage multiplier added per wave after the first. */
  enemyDamagePerWave: number;
  /** Extra simultaneous enemies allowed per wave (on top of `spawn.maxAlive`), up to `maxAliveCap`. */
  maxAlivePerWave: number;
  maxAliveCap: number;
}

export interface SpawnConfig {
  /** Seconds between two spawns. Exposed in the Options screen. */
  interval: number;
  /** Delay before the first spawn. */
  initialDelay: number;
  /** Relative weights used to pick the type of each spawned enemy. */
  weights: Record<EnemyKind, number>;
  /** Variant of each type (weights, looks and stat patches). */
  variants: { chaser: ChaserVariantsConfig; shooter: ShooterVariantsConfig };
  /**
   * Types forced for the first spawns, which guarantees that both enemy types
   * appear in every default match regardless of the random draw. Forced
   * spawns use the standard variant.
   */
  openingSequence: EnemyKind[];
  /** Spawn points closer than this to the player are rejected. */
  minPlayerDistance: number;
  /**
   * Candidate spawn locations. Each spawn keeps only the candidates that are
   * clear of obstacles and ships and at least `minPlayerDistance` away from
   * the player, then picks one with the seeded RNG.
   */
  points: readonly { x: number; y: number }[];
  /** Simultaneously alive enemies in wave 1 (grows per wave, see `waves`); spawns are skipped above it. */
  maxAlive: number;
  /** Seconds after spawning during which an enemy cannot attack. */
  spawnGrace: number;
}

export interface GameConfig {
  /** Active match duration in seconds (60..180). Exposed in the Options screen. */
  sessionTime: number;
  /** Seed of the deterministic RNG (spawn picks, AI jitter). */
  seed: number;
  /** Fixed simulation step in seconds. */
  fixedStep: number;
  /** Largest frame delta consumed at once; protects against huge catch-ups. */
  maxFrameDelta: number;
  arena: { width: number; height: number };
  player: ShipHullConfig & {
    frontCannon: WeaponConfig;
    broadside: BroadsideConfig;
  };
  chaser: ChaserConfig;
  shooter: ShooterConfig;
  spawn: SpawnConfig;
  temperament: TemperamentConfig;
  powerUps: PowerUpConfig;
  waves: WaveConfig;
  /** Seconds the arena keeps animating after the end before the result is shown. */
  endDelay: number;
}

/** Limits of the two values exposed to the player in the Options screen. */
export const OPTION_LIMITS = {
  sessionTime: { min: 60, max: 180, step: 10, default: 120 },
  spawnInterval: { min: 1, max: 10, step: 0.5, default: 3 },
} as const;

export const DEFAULT_CONFIG: GameConfig = {
  sessionTime: OPTION_LIMITS.sessionTime.default,
  seed: 0x5eed,
  fixedStep: 1 / 60,
  maxFrameDelta: 0.25,
  arena: { width: 1600, height: 900 },
  player: {
    maxHealth: 100,
    maxSpeed: 170,
    acceleration: 220,
    drag: 160,
    turnSpeed: 2.6,
    scale: 0.8,
    hullRadius: 20,
    halfLength: 30,
    frontCannon: {
      damage: 20,
      projectileSpeed: 520,
      range: 520,
      lifetime: 1.2,
      cooldown: 0.45,
      projectileRadius: 5,
    },
    broadside: {
      damage: 25,
      projectileSpeed: 440,
      range: 360,
      lifetime: 1.0,
      cooldown: 1.4,
      projectileRadius: 5,
      count: 3,
      spacing: 22,
    },
  },
  chaser: {
    maxHealth: 30,
    maxSpeed: 115,
    acceleration: 180,
    drag: 160,
    turnSpeed: 1.8,
    scale: 0.7,
    hullRadius: 17,
    halfLength: 26,
    impactDamage: 12,
  },
  shooter: {
    maxHealth: 60,
    maxSpeed: 90,
    acceleration: 160,
    drag: 160,
    turnSpeed: 1.6,
    scale: 0.8,
    hullRadius: 20,
    halfLength: 30,
    attackRange: 420,
    preferredDistance: 300,
    aimTolerance: 0.2,
    weapon: {
      damage: 6,
      projectileSpeed: 340,
      range: 440,
      lifetime: 1.4,
      cooldown: 2.4,
      projectileRadius: 5,
    },
  },
  spawn: {
    interval: OPTION_LIMITS.spawnInterval.default,
    initialDelay: 1.5,
    weights: { chaser: 0.5, shooter: 0.5 },
    variants: {
      chaser: {
        standard: { weight: 0.45, style: 2 },
        drifter: { weight: 0.35, style: 1, aggroRange: 320, patch: { maxSpeed: 95, turnSpeed: 1.5 } },
        sprinter: {
          weight: 0.2,
          style: 2,
          tint: 0xffb0a0,
          patch: { maxHealth: 15, maxSpeed: 160, acceleration: 260, turnSpeed: 2.2, scale: 0.56, hullRadius: 14, halfLength: 21, impactDamage: 8 },
        },
      },
      shooter: {
        standard: { weight: 0.45, style: 3 },
        flanker: {
          weight: 0.35,
          style: 4,
          broadsideCount: 2,
          broadsideSpacing: 18,
          patch: { maxHealth: 45, maxSpeed: 105, turnSpeed: 1.9, preferredDistance: 250, attackRange: 330, aimTolerance: 0.3, weapon: { damage: 6, cooldown: 2.8 } },
        },
        sentinel: {
          weight: 0.2,
          style: 6,
          anchorInset: 170,
          patch: {
            maxHealth: 90,
            maxSpeed: 70,
            attackRange: 560,
            aimTolerance: 0.15,
            weapon: { damage: 8, range: 580, projectileSpeed: 400, lifetime: 1.6, cooldown: 3.2 },
          },
        },
      },
    },
    openingSequence: ['chaser', 'shooter'],
    minPlayerDistance: 480,
    points: SPAWN_POINTS,
    maxAlive: 4,
    spawnGrace: 1,
  },
  temperament: {
    reaction: [0.15, 0.55],
    aimError: [0.03, 0.16],
    giveUpChance: 0.06,
    giveUpDuration: [1.2, 2.5],
  },
  powerUps: {
    dropChance: 1,
    lifetime: 8,
    pickupRadius: 24,
    weights: { damage: 0.3, fireRate: 0.3, spread: 0.2, repair: 0.2 },
    maxStacks: { damage: 5, fireRate: 4, spread: 2 },
    damagePerStack: 0.15,
    fireRatePerStack: 0.1,
    spreadBallsPerStack: 2,
    spreadAngle: 0.12,
    repairAmount: 20,
  },
  waves: {
    firstTarget: 2,
    increment: 2,
    rewardHeal: 15,
    rewardUpgrade: true,
    clearBoard: true,
    enemyHealthPerWave: 0.35,
    enemyDamagePerWave: 0.35,
    maxAlivePerWave: 1,
    maxAliveCap: 10,
  },
  endDelay: 1.6,
};

export interface PlayerSettings {
  sessionTime: number;
  spawnInterval: number;
}

export type ConfigOverrides = DeepPartial<GameConfig>;
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined || patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return (patch === undefined ? base : patch) as T;
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    result[key] = deepMerge(result[key], value);
  }
  return result as T;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Builds the immutable config snapshot for one match: defaults, then the
 * player settings, then optional overrides (seeded test scenarios, balancing
 * experiments), which take precedence.
 */
export function createMatchConfig(settings: PlayerSettings, overrides?: ConfigOverrides): Readonly<GameConfig> {
  const base = structuredClone(DEFAULT_CONFIG);
  base.sessionTime = settings.sessionTime;
  base.spawn.interval = settings.spawnInterval;
  return deepFreeze(deepMerge(base, overrides ?? {}));
}
