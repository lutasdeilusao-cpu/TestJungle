import type {
  ChaserConfig,
  EnemyKind,
  EnemyVariant,
  PowerUpKind,
  ShipHullConfig,
  ShooterConfig,
  UpgradeKind,
  WeaponConfig,
} from '../config';

export type ShipKind = 'player' | EnemyKind;
export type WeaponSlot = 'front' | 'left' | 'right';
export type EndReason = 'time_up' | 'defeated';

/** Intent read by the simulation each step. Produced by keyboard/touch input or by the AI. */
export interface ShipControls {
  thrust: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  fireFront: boolean;
  fireLeft: boolean;
  fireRight: boolean;
}

export const idleControls = (): ShipControls => ({
  thrust: false,
  turnLeft: false,
  turnRight: false,
  fireFront: false,
  fireLeft: false,
  fireRight: false,
});

/** Per-enemy AI memory (rolled temperament plus behaviour state). */
export interface AiState {
  /** Seconds until the next steering re-evaluation. */
  reactTimer: number;
  reaction: [number, number];
  /** Last chosen heading and throttle, kept between re-evaluations. */
  desired: number;
  thrust: boolean;
  aimError: number;
  /** Current random aim offset (rad), re-rolled after each shot. */
  aimOffset: number;
  /** While > 0 a chaser wanders instead of hunting. */
  distracted: number;
  /** Drifters: true once they switched to hunting. */
  aggro: boolean;
  waypointX: number;
  waypointY: number;
  /** Flankers: +1 clockwise, -1 counter-clockwise. */
  orbit: 1 | -1;
  /** Sentinels: guard post. */
  anchorX: number;
  anchorY: number;
}

export interface Ship {
  id: number;
  kind: ShipKind;
  /** 'player' for the player ship. */
  variant: EnemyVariant | 'player';
  x: number;
  y: number;
  /** Heading in radians; 0 = east, PI/2 = south (screen coordinates). */
  heading: number;
  /** Previous-step pose, used by the renderer to interpolate between steps. */
  prevX: number;
  prevY: number;
  prevHeading: number;
  speed: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  hull: Readonly<ShipHullConfig>;
  /** Resolved stats of the enemy type/variant (undefined for the other kind). */
  chaser?: Readonly<ChaserConfig>;
  shooter?: Readonly<ShooterConfig>;
  ai?: AiState;
  /** Sail colour and tint of the sprites. */
  style: number;
  tint: number;
  /** Seconds since the ship entered the arena. */
  age: number;
  /** Remaining cooldown per weapon slot, in seconds. */
  cooldowns: Record<WeaponSlot, number>;
  controls: ShipControls;
  /** True when the ship touched an obstacle during the last step. */
  blocked: boolean;
}

export interface Projectile {
  id: number;
  owner: 'player' | 'enemy';
  shooterId: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  /** Remaining lifetime in seconds. */
  ttl: number;
  /** Remaining travel distance in px. */
  distanceLeft: number;
  alive: boolean;
}

export interface PowerUp {
  id: number;
  kind: PowerUpKind;
  x: number;
  y: number;
  /** Seconds left before it sinks. */
  ttl: number;
  alive: boolean;
}

export type Upgrades = Record<UpgradeKind, number>;

export type DestroyCause = 'projectile' | 'impact' | 'wave_clear';

export type ProjectileEndReason = 'hit' | 'obstacle' | 'expired' | 'out_of_bounds';

export type SimEvent =
  | { type: 'shot'; shipId: number; kind: ShipKind; slot: WeaponSlot; x: number; y: number; heading: number; count: number }
  | { type: 'hit'; shipId: number; kind: ShipKind; x: number; y: number; damage: number; hp: number; maxHp: number }
  | { type: 'projectile_end'; projectileId: number; reason: ProjectileEndReason; x: number; y: number }
  | { type: 'ship_destroyed'; shipId: number; kind: ShipKind; x: number; y: number; heading: number; cause: DestroyCause }
  | { type: 'ship_spawned'; shipId: number; kind: ShipKind; variant: EnemyVariant }
  | { type: 'powerup_spawned'; id: number; kind: PowerUpKind; x: number; y: number }
  | { type: 'powerup_collected'; id: number; kind: PowerUpKind; x: number; y: number; stacks: number }
  | { type: 'powerup_expired'; id: number; x: number; y: number }
  | { type: 'wave_cleared'; wave: number; nextTarget: number; heal: number; upgrade: UpgradeKind | null }
  | { type: 'impact'; shipId: number; x: number; y: number; damage: number }
  | { type: 'score'; score: number }
  | { type: 'ended'; reason: EndReason };

export type { WeaponConfig, PowerUpKind, UpgradeKind, EnemyVariant };
