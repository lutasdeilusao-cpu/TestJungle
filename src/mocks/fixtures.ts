import { configKey, type MatchRecord, type MatchSettings } from '../api/contracts';
import { Rng } from '../game/core/rng';

/** Rival captains represented by fixtures. */
export const RIVALS = [
  { id: 'rival-flint', name: 'Captain Flint' },
  { id: 'rival-sparrow', name: 'Red Sparrow' },
  { id: 'rival-storm', name: 'Storm Rider' },
  { id: 'rival-wolf', name: 'Sea Wolf' },
  { id: 'rival-anne', name: 'Anne Bonny' },
  { id: 'rival-kidd', name: 'William Kidd' },
  { id: 'rival-grace', name: "Grace O'Malley" },
  { id: 'rival-drake', name: 'Iron Drake' },
  { id: 'rival-mako', name: 'Mako Reef' },
  { id: 'rival-coral', name: 'Coral Queen' },
  { id: 'rival-gull', name: 'Salty Gull' },
  { id: 'rival-kraken', name: 'Kraken Tamer' },
] as const;

const SETTINGS_POOL: MatchSettings[] = [
  { sessionTime: 120, spawnInterval: 3 },
  { sessionTime: 120, spawnInterval: 3 },
  { sessionTime: 120, spawnInterval: 3 },
  { sessionTime: 60, spawnInterval: 3 },
  { sessionTime: 180, spawnInterval: 2 },
];

/** Fixed reference date so fixtures (and screenshots) never depend on "now". */
const BASE_TIME = Date.parse('2026-09-08T21:42:00.000Z');

function makeRecord(
  rng: Rng,
  index: number,
  player: { id: string; name: string },
  settings: MatchSettings,
): MatchRecord {
  const defeated = rng.next() < 0.35;
  const durationMs = defeated ? Math.round(settings.sessionTime * 1000 * rng.range(0.35, 0.95)) : settings.sessionTime * 1000;
  const rate = rng.range(0.08, 0.3); // kills per second
  const score = Math.max(0, Math.round((durationMs / 1000) * rate * (3 / settings.spawnInterval)));
  const playedAt = new Date(BASE_TIME - index * 37 * 60_000 - rng.int(20) * 60_000).toISOString();
  return {
    matchId: `fixture-${String(index).padStart(4, '0')}`,
    playerId: player.id,
    playerName: player.name,
    playedAt,
    recordedAt: playedAt,
    score,
    durationMs,
    endReason: defeated ? 'defeated' : 'time_up',
    settings,
    // Waves need 2, 4, 6... kills: n waves take n(n + 1) kills.
    wavesCleared: Math.floor((Math.sqrt(1 + 4 * score) - 1) / 2),
    configKey: configKey(settings),
  };
}

/** Default dataset: rivals only, spread over a few configurations (3 ranking pages for 120s/3s). */
export function rivalFixtures(): MatchRecord[] {
  const rng = new Rng(2026);
  return Array.from({ length: 24 }, (_, i) => makeRecord(rng, i, RIVALS[i % RIVALS.length]!, SETTINGS_POOL[i % SETTINGS_POOL.length]!));
}

/** "Many pages" dataset: lots of rival matches plus a long history for the current player. */
export function manyPagesFixtures(player: { id: string; name: string }): MatchRecord[] {
  const rng = new Rng(77);
  const rivals = Array.from({ length: 80 }, (_, i) =>
    makeRecord(rng, i, RIVALS[i % RIVALS.length]!, SETTINGS_POOL[i % SETTINGS_POOL.length]!),
  );
  const own = Array.from({ length: 23 }, (_, i) => ({
    ...makeRecord(rng, 200 + i, player, SETTINGS_POOL[i % SETTINGS_POOL.length]!),
    matchId: `fixture-own-${String(i).padStart(3, '0')}`,
  }));
  return [...rivals, ...own];
}
