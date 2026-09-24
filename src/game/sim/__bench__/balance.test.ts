import { it } from 'vitest';
import { createMatchConfig } from '../../config';
import { Simulation } from '../Simulation';
import { botControls } from './bot';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** Run with BALANCE=1 npx vitest run src/game/sim/__bench__ --reporter=verbose */
it.skipIf(!env.BALANCE)('balance report', () => {
  for (const [sessionTime, spawnInterval] of [[120, 3], [60, 3], [180, 2], [120, 1]] as const) {
    const rows: string[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      const sim = new Simulation(createMatchConfig({ sessionTime, spawnInterval }, { seed }));
      while (sim.status === 'running') sim.step(sim.config.fixedStep, botControls(sim));
      rows.push(`${sim.score}/${sim.endReason === 'time_up' ? 'T' : 'D@' + Math.round(sim.elapsed)}/w${sim.wavesCleared}/hp${Math.round(sim.player.hp)}/${JSON.stringify(sim.upgrades).replace(/["a-zA-Z{}:]/g, '')}`);
    }
    console.log(`${sessionTime}s/${spawnInterval}s: ${rows.join('  ')}`);
  }
});
