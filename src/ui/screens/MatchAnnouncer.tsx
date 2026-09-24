import { useEffect, useRef, useState } from 'react';
import type { HudState } from '../../game/session/GameSession';

const TIME_MILESTONES = new Set([60, 30, 10]);

/**
 * Polite live region for screen readers. It speaks only notable changes
 * (start, score after a short quiet period, time milestones, low health,
 * pause/resume, end) instead of mirroring the HUD every second.
 */
export function MatchAnnouncer({ hud }: { hud: HudState }) {
  const [message, setMessage] = useState('');
  const prev = useRef<HudState | null>(null);
  const scoreTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const before = prev.current;
    prev.current = hud;
    if (!before) return;
    const say = (text: string) => setMessage(text);

    if (before.status !== hud.status) {
      if (hud.status === 'running' && before.status === 'loading') say(`Battle started. ${hud.remaining} seconds on the clock.`);
      else if (hud.status === 'paused') say(hud.pauseReason === 'manual' ? 'Game paused.' : 'Game paused because the window lost focus.');
      else if (hud.status === 'running' && before.status === 'paused') say('Game resumed.');
      else if (hud.status === 'ending') say(hud.endReason === 'defeated' ? `Your ship was sunk. Final score ${hud.score}.` : `Time is up. Final score ${hud.score}.`);
      else if (hud.status === 'error') say('The game assets failed to load.');
    }
    if (hud.notice && hud.notice.id !== before.notice?.id) say(`${hud.notice.title} ${hud.notice.detail}.`);
    if (hud.status !== 'running') return;
    if (hud.remaining !== before.remaining && TIME_MILESTONES.has(hud.remaining)) say(`${hud.remaining} seconds left.`);
    if (hud.hp < before.hp && hud.hp / hud.maxHp <= 0.3 && before.hp / before.maxHp > 0.3) say(`Hull critical: ${hud.hp} health left.`);
    if (hud.score !== before.score) {
      window.clearTimeout(scoreTimer.current);
      const score = hud.score;
      scoreTimer.current = window.setTimeout(() => setMessage(`Score ${score}.`), 1500);
    }
  }, [hud]);

  useEffect(() => () => window.clearTimeout(scoreTimer.current), []);

  return (
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-testid="match-announcer">
      {message}
    </div>
  );
}
