import { Icon, type IconName } from '../components';

const ROWS: { icon: IconName; action: string; keys: string[] }[] = [
  { icon: 'forward', action: 'Sail forward', keys: ['W', '↑'] },
  { icon: 'turn_left', action: 'Turn left', keys: ['A', '←'] },
  { icon: 'turn_right', action: 'Turn right', keys: ['D', '→'] },
  { icon: 'fire_front', action: 'Bow cannon', keys: ['Space', 'K'] },
  { icon: 'fire_left', action: 'Port broadside', keys: ['Q', 'J'] },
  { icon: 'fire_right', action: 'Starboard broadside', keys: ['E', 'L'] },
  { icon: 'pause', action: 'Pause', keys: ['Esc', 'P'] },
];

/** Keyboard and touch instructions, shown in the menu and in the pause dialog. */
export function ControlsHelp({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`controls-help ${compact ? 'controls-help--compact' : ''}`}>
      <table className="controls-table">
        <caption className="visually-hidden">Keyboard controls</caption>
        <thead className="visually-hidden">
          <tr>
            <th scope="col">Action</th>
            <th scope="col">Keys</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.action}>
              <th scope="row">
                <Icon name={row.icon} className="controls-table__icon" />
                {row.action}
              </th>
              <td>
                {row.keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && <span className="controls-table__or"> / </span>}
                    <kbd>{k}</kbd>
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!compact && (
        <p className="controls-note">
          On touch screens use the on-screen buttons: steering on the left, cannons on the right. You can steer and fire at the same time.
          Sink enemies for 1 point each; black-sailed Chasers ram you, red-sailed Shooters open fire in range.
        </p>
      )}
    </div>
  );
}
