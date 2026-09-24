import { idleControls, type ShipControls } from '../sim/types';

export type GameAction = keyof ShipControls;

export const KEY_BINDINGS: Readonly<Record<GameAction, readonly string[]>> = {
  thrust: ['KeyW', 'ArrowUp'],
  turnLeft: ['KeyA', 'ArrowLeft'],
  turnRight: ['KeyD', 'ArrowRight'],
  fireFront: ['Space', 'KeyK'],
  fireLeft: ['KeyQ', 'KeyJ'],
  fireRight: ['KeyE', 'KeyL'],
};

export const PAUSE_KEYS: readonly string[] = ['Escape', 'KeyP'];

const CODE_TO_ACTION = new Map<string, GameAction>(
  (Object.entries(KEY_BINDINGS) as [GameAction, readonly string[]][]).flatMap(([action, codes]) =>
    codes.map((code) => [code, action] as const),
  ),
);

/**
 * Collects player intent from the keyboard and from the on-screen touch
 * controls into a single `ShipControls` value that the session feeds to the
 * simulation every step.
 *
 * Keyboard listeners are only attached while gameplay is active (`enable()`),
 * so menus and forms keep normal keyboard behaviour. Every source is tracked
 * separately (key code / pointer id) so that releasing one of two keys bound to
 * the same action does not cancel the other, and `reset()` drops everything,
 * which is what pause/resume relies on.
 */
export class InputController {
  private readonly keys = new Set<string>();
  private readonly pointers = new Map<number, GameAction>();
  private readonly controls: ShipControls = idleControls();
  /** Fire presses seen since the last simulation step, so a tap shorter than a step still fires. */
  private readonly latched = new Set<GameAction>();
  private readonly merged: ShipControls = idleControls();
  private enabled = false;
  private suspended = false;
  private onPause: (() => void) | null = null;

  constructor(private readonly target: Window = window) {}

  enable(onPause: () => void): void {
    if (this.enabled) return;
    this.enabled = true;
    this.onPause = onPause;
    this.target.addEventListener('keydown', this.handleKeyDown);
    this.target.addEventListener('keyup', this.handleKeyUp);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.onPause = null;
    this.target.removeEventListener('keydown', this.handleKeyDown);
    this.target.removeEventListener('keyup', this.handleKeyUp);
    this.reset();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * While suspended (pause dialog, match over) every input is ignored and
   * released; the dialog owns the keyboard until gameplay resumes.
   */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    this.reset();
  }

  /** Releases every held key and touch; nothing carries over a pause. */
  reset(): void {
    this.keys.clear();
    this.pointers.clear();
    this.latched.clear();
    Object.assign(this.controls, idleControls());
  }

  /** Touch/mouse controls: one pointer holds one action. */
  pressPointer(pointerId: number, action: GameAction): void {
    if (!this.enabled || this.suspended) return;
    this.pointers.set(pointerId, action);
    this.latch(action);
    this.recompute();
  }

  releasePointer(pointerId: number): void {
    if (this.pointers.delete(pointerId)) this.recompute();
  }

  /** Controls for the next simulation step: held inputs plus latched taps. */
  read(): Readonly<ShipControls> {
    Object.assign(this.merged, this.controls);
    for (const action of this.latched) this.merged[action] = true;
    return this.merged;
  }

  /** Called after each simulation step: latched taps have been seen once. */
  endStep(): void {
    this.latched.clear();
  }

  private latch(action: GameAction): void {
    if (action === 'fireFront' || action === 'fireLeft' || action === 'fireRight') this.latched.add(action);
  }

  private recompute(): void {
    const next = idleControls();
    for (const code of this.keys) {
      const action = CODE_TO_ACTION.get(code);
      if (action) next[action] = true;
    }
    for (const action of this.pointers.values()) next[action] = true;
    Object.assign(this.controls, next);
  }

  private isTypingTarget(event: KeyboardEvent): boolean {
    const el = event.target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.suspended || this.isTypingTarget(event) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (PAUSE_KEYS.includes(event.code)) {
      event.preventDefault();
      if (!event.repeat) this.onPause?.();
      return;
    }
    if (!CODE_TO_ACTION.has(event.code)) return;
    event.preventDefault();
    this.keys.add(event.code);
    if (!event.repeat) this.latch(CODE_TO_ACTION.get(event.code)!);
    this.recompute();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (!this.keys.delete(event.code)) return;
    event.preventDefault();
    this.recompute();
  };
}
