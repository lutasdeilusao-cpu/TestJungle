import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { flushPending } from '../api/queries';
import { audio } from '../game/audio/AudioManager';
import { lastResultStore } from '../state/matchRecords';
import { settingsStore } from '../state/settings';
import { CaptainsLog } from './screens/CaptainsLog';
import { MainMenu } from './screens/MainMenu';
import { OptionsScreen } from './screens/OptionsScreen';
import { ResultScreen } from './screens/ResultScreen';
import { navigate, parseHash, useRoute } from './router';
import { NetworkLab } from './screens/NetworkLab';

// PixiJS and the game code are only downloaded when a match starts.
const GameScreen = lazy(() => import('./screens/GameScreen').then((m) => ({ default: m.GameScreen })));

function ScreenFallback() {
  return (
    <div className="overlay" role="status">
      <div className="loading-card">Preparing the fleet…</div>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const queryClient = useQueryClient();
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const { result } = useSyncExternalStore(lastResultStore.subscribe, lastResultStore.getSnapshot);
  /** The running match; null whenever the combat screen is not active. */
  const [match, setMatch] = useState<{ key: number } | null>(null);
  const [labOpen, setLabOpen] = useState(false);

  useEffect(() => audio.setMuted(settings.muted), [settings.muted]);

  // Leaving the combat route by any means (back button, links) abandons the match.
  useEffect(() => {
    const onHashChange = () => {
      if (parseHash(window.location.hash).name !== 'play') setMatch(null);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Pending registrations: retry on start and whenever the connection comes back.
  useEffect(() => {
    flushPending(queryClient);
    const onOnline = () => flushPending(queryClient);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [queryClient]);

  // A refresh on #/play (no running match) or #/result (no result) lands on the menu.
  const invalidPlay = route.name === 'play' && match === null;
  const invalidResult = route.name === 'result' && result === null;
  useEffect(() => {
    if (invalidPlay || invalidResult) navigate({ name: 'menu' }, { replace: true });
  }, [invalidPlay, invalidResult]);

  const startMatch = useCallback(() => {
    audio.unlock();
    navigate({ name: 'play' });
    setMatch({ key: Date.now() });
  }, []);

  const toMenu = useCallback(() => {
    setMatch(null);
    navigate({ name: 'menu' });
  }, []);

  const finishMatch = useCallback(() => {
    setMatch(null);
    navigate({ name: 'result' }, { replace: true });
  }, []);

  let screen: React.ReactNode;
  if (route.name === 'play' && match) {
    screen = (
      <Suspense fallback={<ScreenFallback />}>
        <GameScreen key={match.key} onExit={toMenu} onRestart={startMatch} onFinished={finishMatch} />
      </Suspense>
    );
  } else if (route.name === 'options') {
    screen = <OptionsScreen onBack={toMenu} />;
  } else if (route.name === 'log') {
    screen = <CaptainsLog tab={route.tab} onBack={toMenu} />;
  } else if (route.name === 'result' && result) {
    screen = <ResultScreen result={result} onPlayAgain={startMatch} onMenu={toMenu} />;
  } else {
    screen = <MainMenu onPlay={startMatch} onOpenLab={() => setLabOpen(true)} />;
  }

  const inCombat = route.name === 'play' && match !== null;
  return (
    <div className={`app ${inCombat ? 'app--combat' : 'app--menus'}`}>
      {!inCombat && <div className="scene-backdrop" aria-hidden="true" />}
      <main className="app__main">{screen}</main>
      {!inCombat && <img className="brand-logo" src={`${import.meta.env.BASE_URL}assets/ui/logo_jungle_gaming.svg`} alt="" aria-hidden="true" />}
      <NetworkLab open={labOpen} onClose={() => setLabOpen(false)} />
      <div className="rotate-notice" role="alert">
        <div className="rotate-notice__icon" aria-hidden="true" />
        <p>Please rotate your device to landscape to play Pirate Battle.</p>
      </div>
    </div>
  );
}
