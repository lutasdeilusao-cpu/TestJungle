import { useSyncExternalStore } from 'react';
import { lastResultStore, pendingStore } from '../../state/matchRecords';
import { profileStore, settingsStore } from '../../state/settings';
import { MenuButton, Panel } from '../components';
import { formatClock, formatEndReason } from '../format';
import { navigate } from '../router';
import { ControlsHelp } from './ControlsHelp';
import { PendingBanner } from './PendingBanner';

export function MainMenu({ onPlay, onOpenLab }: { onPlay: () => void; onOpenLab: () => void }) {
  const profile = useSyncExternalStore(profileStore.subscribe, profileStore.getSnapshot);
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const { result } = useSyncExternalStore(lastResultStore.subscribe, lastResultStore.getSnapshot);
  const { entries } = useSyncExternalStore(pendingStore.subscribe, pendingStore.getSnapshot);

  return (
    <div className="menu-layout" data-testid="main-menu">
      <Panel labelledBy="menu-title" className="menu-panel">
        <h1 id="menu-title" className="title-art">
          <img src={`${import.meta.env.BASE_URL}assets/ui/2x/menu/title_pirate_battle.png`} alt="Pirate Battle" width={384} height={128} />
        </h1>
        <p className="tagline">Set sail. Take command.</p>
        <div className="menu-actions">
          <MenuButton onClick={onPlay} autoFocus data-testid="play-button">
            Play
          </MenuButton>
          <MenuButton onClick={() => navigate({ name: 'options' })} data-testid="options-button">
            Options
          </MenuButton>
        </div>
        <p className="menu-meta">
          <span>
            {profile.name} · {settings.sessionTime} s battle · {settings.spawnInterval} s spawns
          </span>
          {result && (
            <span data-testid="last-result-summary">
              Last battle: {result.submission.score} pts · {formatClock(result.submission.durationMs / 1000)} · {formatEndReason(result.submission.endReason)}
            </span>
          )}
        </p>
        <nav className="menu-tabs" aria-label="Captain's log">
          <MenuButton variant="secondary" size="sm" onClick={() => navigate({ name: 'log', tab: 'ranking' })} data-testid="ranking-button">
            Ranking
          </MenuButton>
          <MenuButton variant="secondary" size="sm" onClick={() => navigate({ name: 'log', tab: 'history' })} data-testid="history-button">
            Match History
          </MenuButton>
        </nav>
        {entries.length > 0 && <PendingBanner />}
      </Panel>
      <Panel labelledBy="controls-title" className="controls-panel">
        <h2 id="controls-title" className="panel-title panel-title--sm">
          How to sail
        </h2>
        <ControlsHelp />
        <button type="button" className="link-button" onClick={onOpenLab} data-testid="network-lab-button">
          Network Lab (mock API scenarios)
        </button>
      </Panel>
    </div>
  );
}
