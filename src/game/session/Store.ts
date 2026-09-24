/**
 * Minimal external store for `useSyncExternalStore`. `set` only notifies when a
 * field actually changes, so the game loop can call it every frame while React
 * re-renders only on meaningful HUD changes (score, whole seconds, health).
 */
export class Store<T extends object> {
  private state: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.state = initial;
  }

  readonly getSnapshot = (): T => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(patch: Partial<T>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof T)[]) {
      if (!Object.is(this.state[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
