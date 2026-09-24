import { describe, expect, it } from 'vitest';
import { OBSTACLES } from '../arena/arenaMap';
import { createMatchConfig, type ConfigOverrides } from '../config';
import { obstacleDistance } from './geometry';
import { Simulation } from './Simulation';
import { idleControls, type ShipControls } from './types';

const settings = { sessionTime: 60, spawnInterval: 3 };

function makeSim(overrides?: ConfigOverrides) {
  return new Simulation(createMatchConfig(settings, overrides));
}

function run(sim: Simulation, seconds: number, controls: Partial<ShipControls> = {}) {
  const c = { ...idleControls(), ...controls };
  const steps = Math.round(seconds / sim.config.fixedStep);
  for (let i = 0; i < steps; i++) sim.step(sim.config.fixedStep, c);
}

const noSpawns: ConfigOverrides = { spawn: { initialDelay: 9999 } };

describe('Simulation', () => {
  it('moves forward along the heading and rotates both ways', () => {
    const sim = makeSim(noSpawns);
    const x0 = sim.player.x;
    run(sim, 1, { thrust: true });
    expect(sim.player.x).toBeGreaterThan(x0 + 50);
    const h = sim.player.heading;
    run(sim, 0.5, { turnLeft: true });
    expect(sim.player.heading).toBeLessThan(h);
    run(sim, 1, { turnRight: true });
    expect(sim.player.heading).toBeGreaterThan(h);
  });

  it('keeps the player inside the arena and out of islands', () => {
    const sim = makeSim(noSpawns);
    // Sail north into the fort island and then keep going for a while.
    sim.player.heading = -Math.PI / 2;
    sim.player.x = 380;
    run(sim, 8, { thrust: true });
    for (const o of OBSTACLES) expect(obstacleDistance(sim.player.x, sim.player.y, o).d).toBeGreaterThan(0);
    // West into the border.
    sim.player.heading = Math.PI;
    run(sim, 8, { thrust: true });
    expect(sim.player.x).toBeGreaterThanOrEqual(0);
  });

  it('fires one front ball and three broadside balls, respecting cooldowns', () => {
    const sim = makeSim(noSpawns);
    run(sim, 0.1, { fireFront: true });
    expect(sim.projectiles.filter((p) => p.owner === 'player')).toHaveLength(1);
    run(sim, 0.1, { fireLeft: true });
    expect(sim.projectiles).toHaveLength(4);
    run(sim, 0.1, { fireLeft: true });
    expect(sim.projectiles).toHaveLength(4); // left still cooling down
    run(sim, 0.05, { fireRight: true });
    expect(sim.projectiles).toHaveLength(7);
  });

  it('removes projectiles after their range', () => {
    const sim = makeSim(noSpawns);
    run(sim, 0.02, { fireFront: true });
    run(sim, 2);
    expect(sim.projectiles).toHaveLength(0);
  });

  it('spawns both enemy types far from the player', () => {
    const sim = makeSim();
    run(sim, 8);
    expect(sim.spawned.chaser).toBeGreaterThan(0);
    expect(sim.spawned.shooter).toBeGreaterThan(0);
  });

  it('scores once per enemy sunk by the player and not for chaser self-destruction', () => {
    const sim = makeSim({ spawn: { initialDelay: 0.01, interval: 999, openingSequence: ['chaser'] } });
    run(sim, 0.05);
    const chaser = sim.enemies[0]!;
    expect(chaser.kind).toBe('chaser');
    // Let it ram the player.
    run(sim, 10);
    expect(sim.enemies).toHaveLength(0);
    expect(sim.score).toBe(0);
    expect(sim.player.hp).toBe(sim.config.player.maxHealth - sim.config.chaser.impactDamage);
  });

  it('ends on time and freezes the world', () => {
    const sim = makeSim(noSpawns);
    run(sim, 61, { thrust: true });
    expect(sim.status).toBe('ended');
    expect(sim.endReason).toBe('time_up');
    const x = sim.player.x;
    run(sim, 1, { thrust: true });
    expect(sim.player.x).toBe(x);
    expect(sim.elapsed).toBeCloseTo(60, 5);
  });

  it('ends when the player dies', () => {
    const sim = makeSim({ player: { maxHealth: 10 }, spawn: { initialDelay: 0.01, interval: 999, openingSequence: ['chaser'] } });
    run(sim, 15);
    expect(sim.status).toBe('ended');
    expect(sim.endReason).toBe('defeated');
  });

  it('is deterministic for a given seed', () => {
    const a = makeSim();
    const b = makeSim();
    run(a, 20, { thrust: true, turnLeft: true, fireFront: true });
    run(b, 20, { thrust: true, turnLeft: true, fireFront: true });
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('shooter approaches and fires at the player', () => {
    const sim = makeSim({ spawn: { initialDelay: 0.01, interval: 999, openingSequence: ['shooter'] } });
    run(sim, 20);
    expect(sim.player.hp).toBeLessThan(sim.config.player.maxHealth);
  });
});

/** Only one variant of one type spawns, at (x, y). */
function only(kind: 'chaser' | 'shooter', variant: string, x = 1200, y = 460): ConfigOverrides {
  const pick = (v: Record<string, unknown>) => Object.fromEntries(Object.keys(v).map((k) => [k, { weight: k === variant ? 1 : 0 }]));
  return {
    spawn: {
      initialDelay: 0.01,
      interval: 999,
      openingSequence: [],
      weights: { chaser: kind === 'chaser' ? 1 : 0, shooter: kind === 'shooter' ? 1 : 0 },
      points: [{ x, y }],
      variants: {
        chaser: pick({ standard: 0, drifter: 0, sprinter: 0 }) as never,
        shooter: pick({ standard: 0, flanker: 0, sentinel: 0 }) as never,
      },
    },
  };
}

describe('Enemy variants', () => {
  it('a drifter wanders while the player is far away', () => {
    const sim = makeSim(only('chaser', 'drifter', 1540, 300));
    run(sim, 3);
    const e = sim.enemies[0]!;
    expect(e.variant).toBe('drifter');
    expect(sim.player.hp).toBe(sim.config.player.maxHealth);
    expect(Math.hypot(e.x - sim.player.x, e.y - sim.player.y)).toBeGreaterThan(sim.config.spawn.variants.chaser.drifter.aggroRange);
  });

  it('a sentinel sails to its guard post and holds it', () => {
    const sim = makeSim(only('shooter', 'sentinel', 1540, 560));
    run(sim, 6);
    const a = { x: sim.enemies[0]!.x, y: sim.enemies[0]!.y };
    run(sim, 3);
    const b = sim.enemies[0]!;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(15);
    expect(Math.hypot(b.x - 1540, b.y - 560)).toBeGreaterThan(100);
  });

  it('a flanker only fires sideways, two balls at a time', () => {
    const sim = makeSim(only('shooter', 'flanker', 900, 460));
    const shots: { slot: string; count: number }[] = [];
    for (let i = 0; i < 60 * 15; i++) {
      sim.step(sim.config.fixedStep, idleControls());
      for (const e of sim.drainEvents()) if (e.type === 'shot' && e.kind === 'shooter') shots.push(e);
    }
    expect(shots.length).toBeGreaterThan(0);
    for (const s of shots) {
      expect(s.slot).not.toBe('front');
      expect(s.count).toBe(2);
    }
  });
});

describe('Power-ups and waves', () => {
  const duck: ConfigOverrides = {
    spawn: { initialDelay: 0.01, interval: 0.5, openingSequence: ['shooter'], weights: { chaser: 0, shooter: 1 }, maxAlive: 1, points: [{ x: 830, y: 460 }] },
    shooter: { maxSpeed: 0, turnSpeed: 0, attackRange: 0 },
  };

  it('every enemy sunk by the player drops a power-up; sailing over it grants a permanent stack', () => {
    const sim = makeSim({ ...duck, powerUps: { weights: { damage: 1, fireRate: 0, spread: 0, repair: 0 } } });
    run(sim, 0.05);
    run(sim, 1.2, { fireFront: true });
    run(sim, 1);
    expect(sim.score).toBeGreaterThanOrEqual(1);
    expect(sim.powerUps.length + sim.upgrades.damage).toBeGreaterThanOrEqual(1);
    run(sim, 4, { thrust: true });
    expect(sim.upgrades.damage).toBeGreaterThanOrEqual(1);
  });

  it('clearing a wave heals, grants an upgrade, clears the sea and raises the target by 2', () => {
    const sim = makeSim({ ...duck, player: { maxHealth: 100 }, spawn: { ...(duck.spawn as object), maxAlive: 3 } });
    sim.player.hp = 50;
    let cleared: Extract<ReturnType<Simulation['drainEvents']>[number], { type: 'wave_cleared' }> | undefined;
    for (let i = 0; i < 60 * 20 && !cleared; i++) {
      sim.step(sim.config.fixedStep, { ...idleControls(), fireFront: true });
      cleared = sim.drainEvents().find((e) => e.type === 'wave_cleared') as typeof cleared;
    }
    expect(cleared).toMatchObject({ wave: 1, nextTarget: 4 });
    expect(sim.wave).toBe(2);
    expect(sim.waveKills).toBe(0);
    expect(sim.score).toBe(2);
    expect(sim.enemies.filter((e) => e.alive)).toHaveLength(0);
    expect(sim.player.hp).toBeGreaterThan(50);
    expect(Object.values(sim.upgrades).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
  });

  it('upgrades raise damage and fire rate, and a new match starts from zero', () => {
    const sim = makeSim({ spawn: { initialDelay: 9999 } });
    sim.upgrades.fireRate = 2;
    sim.upgrades.spread = 1;
    run(sim, 0.02, { fireFront: true });
    expect(sim.projectiles).toHaveLength(3);
    expect(sim.player.cooldowns.front).toBeCloseTo(sim.config.player.frontCannon.cooldown / 1.2, 2);
    expect(makeSim().upgrades).toEqual({ damage: 0, fireRate: 0, spread: 0 });
  });
});
