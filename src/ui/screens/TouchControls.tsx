import type { PointerEvent } from 'react';
import type { GameAction } from '../../game/input/InputController';
import type { GameSession } from '../../game/session/GameSession';
import { Icon, type IconName } from '../components';

const LEFT: { action: GameAction; icon: IconName; label: string; area: string }[] = [
  { action: 'turnLeft', icon: 'turn_left', label: 'Turn left', area: 'left' },
  { action: 'thrust', icon: 'forward', label: 'Sail forward', area: 'up' },
  { action: 'turnRight', icon: 'turn_right', label: 'Turn right', area: 'right' },
];
const RIGHT: { action: GameAction; icon: IconName; label: string; area: string }[] = [
  { action: 'fireLeft', icon: 'fire_left', label: 'Fire port broadside', area: 'left' },
  { action: 'fireFront', icon: 'fire_front', label: 'Fire bow cannon', area: 'up' },
  { action: 'fireRight', icon: 'fire_right', label: 'Fire starboard broadside', area: 'right' },
];

/**
 * On-screen controls. Each button holds its action while a pointer is down on
 * it (multi-touch: steer with one thumb and fire with the other). Pointer
 * capture guarantees the release is received even if the finger slides off.
 * Buttons are hidden from the tab order: keyboard players use the key bindings.
 */
export function TouchControls({ session, disabled }: { session: GameSession; disabled: boolean }) {
  const down = (action: GameAction) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already-released pointers cannot be captured; holding still works.
    }
    session.press(e.pointerId, action);
  };
  const up = (e: PointerEvent<HTMLButtonElement>) => session.release(e.pointerId);

  const pad = (items: typeof LEFT, side: 'steer' | 'fire') => (
    <div className={`touch-pad touch-pad--${side}`} role="group" aria-label={side === 'steer' ? 'Steering' : 'Cannons'}>
      {items.map((item) => (
        <button
          key={item.action}
          type="button"
          tabIndex={-1}
          className={`round-button touch-button touch-button--${item.area}`}
          aria-label={item.label}
          disabled={disabled}
          data-testid={`touch-${item.action}`}
          onPointerDown={down(item.action)}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={up}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Icon name={item.icon} />
        </button>
      ))}
    </div>
  );

  return (
    <div className="touch-controls" data-testid="touch-controls">
      {pad(LEFT, 'steer')}
      {pad(RIGHT, 'fire')}
    </div>
  );
}
