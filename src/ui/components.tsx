import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { audio } from '../game/audio/AudioManager';

export function Panel({ children, wide = false, className = '', labelledBy }: { children: ReactNode; wide?: boolean; className?: string; labelledBy?: string }) {
  return (
    <section className={`panel ${wide ? 'panel--wide' : ''} ${className}`} aria-labelledby={labelledBy}>
      <div className="panel__content">{children}</div>
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary'; size?: 'lg' | 'sm' };

/** Wooden menu button from the UI atlas. Plays the click sound on activation. */
export function MenuButton({ variant = 'primary', size = 'lg', className = '', onClick, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`menu-button menu-button--${variant} menu-button--${size} ${className}`}
      onClick={(e) => {
        audio.play('ui_click', { volume: 0.5 });
        onClick?.(e);
      }}
      {...rest}
    >
      <span className="menu-button__label">{children}</span>
    </button>
  );
}

export type IconName =
  | 'close'
  | 'fire_front'
  | 'fire_left'
  | 'fire_right'
  | 'forward'
  | 'home'
  | 'minus'
  | 'pause'
  | 'play'
  | 'plus'
  | 'restart'
  | 'settings'
  | 'turn_left'
  | 'turn_right';

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <span aria-hidden="true" className={`icon icon--${name} ${className}`} />;
}

/** Round brass button with an icon; `label` is required for accessibility. */
export function RoundButton({ icon, label, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button type="button" className={`round-button ${className}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

/**
 * Modal dialog built on the native <dialog> element: `showModal()` makes the
 * rest of the page inert and keeps focus inside; Escape is routed to `onCancel`
 * and the previously focused element regains focus on close.
 */
export function Dialog({
  open,
  labelledBy,
  describedBy,
  onCancel,
  children,
  className = '',
  testId,
}: {
  open: boolean;
  labelledBy: string;
  describedBy?: string;
  onCancel?: () => void;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const previous = document.activeElement as HTMLElement | null;
      dialog.showModal();
      // React's autoFocus runs before showModal(); move focus in explicitly so
      // keyboard users land on the first control on every platform.
      dialog.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select, a[href]')?.focus();
      audio.play('ui_open', { volume: 0.4 });
      return () => {
        if (dialog.open) dialog.close();
        if (previous?.isConnected) previous.focus();
      };
    }
    return undefined;
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel?.();
      }}
    >
      {open ? <div className="panel dialog__panel"><div className="panel__content">{children}</div></div> : null}
    </dialog>
  );
}

export function Pagination({
  page,
  totalPages,
  onChange,
  label,
  disabled = false,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <nav className="pagination" aria-label={label}>
      <RoundButton icon="turn_left" label="Previous page" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)} />
      <span className="pagination__status" aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <RoundButton icon="turn_right" label="Next page" disabled={disabled || page >= totalPages} onClick={() => onChange(page + 1)} />
    </nav>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner__wheel" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
