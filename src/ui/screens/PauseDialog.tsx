import { useState } from 'react';
import type { PauseReason } from '../../game/session/GameSession';
import { Dialog, MenuButton } from '../components';
import { ControlsHelp } from './ControlsHelp';
import { OptionsScreen } from './OptionsScreen';

interface Props {
  open: boolean;
  reason: PauseReason | null;
  onResume: () => void;
  onRestart: () => void;
  onExit: () => void;
}

export function PauseDialog({ open, reason, onResume, onRestart, onExit }: Props) {
  const [view, setView] = useState<'main' | 'options'>('main');
  const close = () => {
    setView('main');
    onResume();
  };
  return (
    <Dialog
      open={open}
      labelledBy="pause-title"
      describedBy="pause-text"
      onCancel={view === 'options' ? () => setView('main') : close}
      testId="pause-dialog"
    >
      {view === 'options' ? (
        <OptionsScreen embedded onBack={() => setView('main')} />
      ) : (
        <div
          className="pause-menu"
          onKeyDown={(e) => {
            if (e.code === 'KeyP' && !e.repeat) {
              e.preventDefault();
              // Keep the key from also reaching the in-game pause toggle on window.
              e.stopPropagation();
              close();
            }
          }}
        >
          <h2 id="pause-title" className="panel-title">
            Paused
          </h2>
          <p id="pause-text" className="pause-reason">
            {reason === 'manual' ? 'Ready when you are.' : 'The game paused because the window lost focus. Ready when you are.'}
          </p>
          <div className="menu-actions">
            <MenuButton onClick={close} autoFocus data-testid="resume-button">
              Resume
            </MenuButton>
            <MenuButton onClick={() => setView('options')} data-testid="pause-options">
              Options
            </MenuButton>
            <MenuButton onClick={onRestart} data-testid="restart-button">
              Restart
            </MenuButton>
            <MenuButton onClick={onExit} data-testid="exit-button">
              Main Menu
            </MenuButton>
          </div>
          <p className="pause-note">Leaving or restarting abandons this battle: it will not be recorded.</p>
          <details className="pause-controls">
            <summary>Controls</summary>
            <ControlsHelp compact />
          </details>
        </div>
      )}
    </Dialog>
  );
}
