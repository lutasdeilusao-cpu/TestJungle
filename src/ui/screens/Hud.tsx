import type { HudNotice, HudState } from '../../game/session/GameSession';
import { RoundButton } from '../components';
import { formatClock } from '../format';

const UPGRADE_CHIPS = [
  { key: 'upDamage', kind: 'damage', label: 'Heavy shot' },
  { key: 'upFireRate', kind: 'fireRate', label: 'Quick reload' },
  { key: 'upSpread', kind: 'spread', label: 'Fan shot' },
] as const;

/**
 * DOM HUD over the canvas. It re-renders only when the session store changes
 * (score, whole seconds, health, wave progress, upgrades, status), never per
 * frame. Values are real text, so they are readable by assistive technology
 * and by tests.
 */
export function Hud({ hud, onPause }: { hud: HudState; onPause: () => void }) {
  const ratio = hud.maxHp > 0 ? hud.hp / hud.maxHp : 0;
  const tone = ratio > 0.6 ? 'green' : ratio > 0.3 ? 'amber' : 'red';
  const lowTime = hud.remaining <= 10;
  const upgrades = UPGRADE_CHIPS.filter((c) => hud[c.key] > 0);
  return (
    <section className="hud" aria-label="Match status" data-testid="hud">
      <div className="hud__left">
        <div className="hud__health">
          <span className="hud__heart" aria-hidden="true" />
          <div
            className="health-bar"
            role="meter"
            aria-label="Ship health"
            aria-valuemin={0}
            aria-valuemax={hud.maxHp}
            aria-valuenow={Math.ceil(hud.hp)}
            aria-valuetext={`${Math.ceil(hud.hp)} of ${hud.maxHp}`}
          >
            <div className={`health-bar__fill health-bar__fill--${tone}`} style={{ '--ratio': ratio } as React.CSSProperties} />
            <span className="health-bar__text" data-testid="hud-health">
              {Math.ceil(hud.hp)} / {hud.maxHp}
            </span>
          </div>
        </div>
        <div className="hud__progress">
          <span className="wave-chip" data-testid="hud-wave">
            Wave {hud.wave} · {hud.waveKills}/{hud.waveTarget}
          </span>
          {upgrades.length > 0 && (
            <ul className="upgrade-chips" aria-label="Upgrades" data-testid="hud-upgrades">
              {upgrades.map((c) => (
                <li key={c.key} className={`upgrade-chip upgrade-chip--${c.kind}`} title={c.label} data-testid={`hud-upgrade-${c.kind}`}>
                  <span className={`upgrade-chip__icon upgrade-chip__icon--${c.kind}`} aria-hidden="true" />
                  <span className="visually-hidden">{c.label} </span>×{hud[c.key]}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {hud.notice && <NoticeBanner key={hud.notice.id} notice={hud.notice} />}
      <div className="hud__right">
        <div className="counter" data-testid="hud-score-counter">
          <span className="counter__icon counter__icon--score" aria-hidden="true" />
          <span className="visually-hidden">Score</span>
          <span className="counter__value" data-testid="hud-score">
            {hud.score}
          </span>
        </div>
        <div className={`counter ${lowTime ? 'counter--warning' : ''}`}>
          <span className="counter__icon counter__icon--time" aria-hidden="true" />
          <span className="visually-hidden">Time left</span>
          <span className="counter__value" data-testid="hud-time">
            <time dateTime={`PT${hud.remaining}S`}>{formatClock(hud.remaining)}</time>
          </span>
        </div>
        <RoundButton icon="pause" label="Pause (Esc)" onClick={onPause} disabled={hud.status !== 'running'} data-testid="pause-button" />
      </div>
    </section>
  );
}

/** Short-lived banner (CSS animation; remounted per notice id, no timers in React). */
function NoticeBanner({ notice }: { notice: HudNotice }) {
  return (
    <div className={`notice notice--${notice.kind}`} data-testid="hud-notice" aria-hidden="true">
      <strong>{notice.title}</strong>
      <span>{notice.detail}</span>
    </div>
  );
}
