import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'menu' }
  | { name: 'options' }
  | { name: 'play' }
  | { name: 'result' }
  | { name: 'log'; tab: 'ranking' | 'history' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  switch (path) {
    case 'options':
      return { name: 'options' };
    case 'play':
      return { name: 'play' };
    case 'result':
      return { name: 'result' };
    case 'ranking':
      return { name: 'log', tab: 'ranking' };
    case 'history':
      return { name: 'log', tab: 'history' };
    default:
      return { name: 'menu' };
  }
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'menu':
      return '#/';
    case 'log':
      return `#/${route.tab}`;
    default:
      return `#/${route.name}`;
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const getHash = () => window.location.hash;

/** Tiny hash router: screens are addressable (and refresh-safe) without a routing library. */
export function useRoute(): Route {
  return parseHash(useSyncExternalStore(subscribe, getHash));
}

export function navigate(route: Route, { replace = false } = {}): void {
  const hash = routeToHash(route);
  if (replace) {
    window.history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}
