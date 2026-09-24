import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { submitMatch } from '../../api/queries';
import type { MatchSubmission } from '../../api/contracts';
import { createMatchConfig } from '../../game/config';
import { GameSession, type HudState } from '../../game/session/GameSession';
import { recordCompletedMatch } from '../../state/matchRecords';
import { newId, profileStore, settingsStore } from '../../state/settings';
import { debugColliders, registerSession, testClock, testOverrides } from '../../testing/testHooks';
import { MenuButton } from '../components';
import { Hud } from './Hud';
import { MatchAnnouncer } from './MatchAnnouncer';
import { PauseDialog } from './PauseDialog';
import { TouchControls } from './TouchControls';

interface Props {
  onExit: () => void;
  onRestart: () => void;
  onFinished: () => void;
}

const IDLE_STATE: HudState = {
  status: 'loading',
  loadProgress: 0,
  error: null,
  score: 0,
  remaining: 0,
  hp: 0,
  maxHp: 1,
  pauseReason: null,
  endReason: null,
  wave: 1,
  waveKills: 0,
  waveTarget: 0,
  upDamage: 0,
  upFireRate: 0,
  upSpread: 0,
  notice: null,
};
const idleSubscribe = () => () => undefined;
const idleSnapshot = () => IDLE_STATE;

/**
 * Hosts one match. The session (simulation + Pixi scene + input) is created in
 * an effect and disposed in its cleanup, so React Strict Mode's mount ->
 * unmount -> mount cycle simply creates and throws away one extra session.
 * Each match uses a frozen snapshot of the settings taken here.
 */
export function GameScreen({ onExit, onRestart, onFinished }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [session, setSession] = useState<GameSession | null>(null);
  const callbacks = useRef({ onFinished });
  useEffect(() => {
    callbacks.current = { onFinished };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const settings = settingsStore.getSnapshot();
    const profile = profileStore.getSnapshot();
    const config = createMatchConfig(settings, testOverrides());
    const next = new GameSession(host, {
      config,
      clock: testClock(),
      debugColliders: debugColliders(),
      onFinished: (outcome) => {
        const submission: MatchSubmission = {
          matchId: newId(),
          playerId: profile.id,
          playerName: profile.name,
          playedAt: outcome.endedAt,
          score: outcome.score,
          durationMs: outcome.durationMs,
          endReason: outcome.endReason,
          wavesCleared: outcome.wavesCleared,
          settings: { sessionTime: config.sessionTime, spawnInterval: config.spawn.interval },
        };
        // Persist first, then send: a refresh or a failure never loses the record.
        recordCompletedMatch(submission);
        submitMatch(queryClient, submission);
        callbacks.current.onFinished();
      },
    });
    registerSession(next);
    setSession(next);
    void next.start();
    return () => {
      next.dispose();
      registerSession(null);
    };
  }, [queryClient]);

  const hud = useSyncExternalStore(session?.store.subscribe ?? idleSubscribe, session?.store.getSnapshot ?? idleSnapshot);
  const loading = hud.status === 'loading';
  const failed = hud.status === 'error';

  return (
    <div className="game-screen" data-testid="game-screen" data-status={hud.status}>
      <div className="game-host" ref={hostRef} role="img" aria-label="Battle arena" />
      {session && !loading && !failed && (
        <>
          <Hud hud={hud} onPause={() => session.pause('manual')} />
          <TouchControls session={session} disabled={hud.status !== 'running'} />
        </>
      )}
      <MatchAnnouncer hud={hud} />
      {loading && (
        <div className="overlay" data-testid="loading-overlay">
          <div className="loading-card" role="status" aria-live="polite">
            <p>Loading the fleet…</p>
            <div
              className="progress"
              role="progressbar"
              aria-label="Loading assets"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(hud.loadProgress * 100)}
            >
              <div className="progress__bar" style={{ width: `${Math.round(hud.loadProgress * 100)}%` }} />
            </div>
          </div>
        </div>
      )}
      {failed && (
        <div className="overlay" data-testid="load-error">
          <div className="panel error-panel" role="alertdialog" aria-labelledby="load-error-title" aria-describedby="load-error-text">
            <div className="panel__content">
              <h2 id="load-error-title" className="panel-title">
                The fleet could not be loaded
              </h2>
              <p id="load-error-text">Some game assets failed to download. Check your connection and try again.</p>
              <details className="error-details">
                <summary>Technical details</summary>
                <code>{hud.error}</code>
              </details>
              <div className="form-actions">
                <MenuButton size="sm" onClick={() => void session?.start()} autoFocus data-testid="load-retry">
                  Retry
                </MenuButton>
                <MenuButton size="sm" variant="secondary" onClick={onExit}>
                  Main Menu
                </MenuButton>
              </div>
            </div>
          </div>
        </div>
      )}
      {session && (
        <PauseDialog
          open={hud.status === 'paused'}
          reason={hud.pauseReason}
          onResume={() => session.resume()}
          onRestart={onRestart}
          onExit={onExit}
        />
      )}
    </div>
  );
}
