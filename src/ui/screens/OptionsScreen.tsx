import { useId, useState, useSyncExternalStore, type FormEvent } from 'react';
import { OPTION_LIMITS } from '../../game/config';
import { NAME_LIMITS, profileStore, saveProfileName, saveSettings, settingsStore, validateOptions, type FieldErrors } from '../../state/settings';
import { MenuButton, Panel, RoundButton } from '../components';

interface NumberFieldProps {
  id: string;
  label: string;
  hint: string;
  value: string;
  error?: string;
  step: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: string) => void;
}

function NumberField({ id, label, hint, value, error, step, min, max, unit, onChange }: NumberFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const bump = (delta: number) => {
    const current = Number(value);
    const base = Number.isFinite(current) ? current : min;
    const next = Math.min(max, Math.max(min, Math.round((base + delta) / step) * step));
    onChange(String(+next.toFixed(2)));
  };
  return (
    <div className={`field ${error ? 'field--invalid' : ''}`}>
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <div className="stepper">
        <RoundButton icon="minus" label={`Decrease ${label.toLowerCase()}`} onClick={() => bump(-step)} disabled={Number(value) <= min} />
        <span className="stepper__value">
          <input
            id={id}
            name={id}
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`}
            data-testid={`${id}-input`}
          />
          <span aria-hidden="true">{unit}</span>
        </span>
        <RoundButton icon="plus" label={`Increase ${label.toLowerCase()}`} onClick={() => bump(step)} disabled={Number(value) >= max} />
      </div>
      <p id={hintId} className="field__hint">
        {hint}
      </p>
      {error && (
        <p id={errorId} className="field__error" role="alert" data-testid={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function OptionsScreen({ onBack, embedded = false }: { onBack: () => void; embedded?: boolean }) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const profile = useSyncExternalStore(profileStore.subscribe, profileStore.getSnapshot);
  const [sessionTime, setSessionTime] = useState(String(settings.sessionTime));
  const [spawnInterval, setSpawnInterval] = useState(String(settings.spawnInterval));
  const [name, setName] = useState(profile.name);
  const [muted, setMuted] = useState(settings.muted);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState<string | null>(null);
  const titleId = useId();
  const st = OPTION_LIMITS.sessionTime;
  const si = OPTION_LIMITS.spawnInterval;

  const values = { sessionTime: Number(sessionTime.replace(',', '.')), spawnInterval: Number(spawnInterval.replace(',', '.')), name };
  const dirty =
    values.sessionTime !== settings.sessionTime ||
    values.spawnInterval !== settings.spawnInterval ||
    name.trim() !== profile.name ||
    muted !== settings.muted;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validateOptions(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setSaved(null);
      const first = Object.keys(found)[0];
      document.getElementById(first === 'name' ? 'captain-name' : first === 'sessionTime' ? 'session-time' : 'spawn-interval')?.focus();
      return;
    }
    saveSettings({ sessionTime: values.sessionTime, spawnInterval: values.spawnInterval, muted });
    saveProfileName(name);
    setSaved(embedded ? 'Saved. New settings apply to your next battle.' : 'Options saved.');
  };

  const onField = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setSaved(null);
    setErrors({});
  };

  const content = (
    <form className="options-form" onSubmit={submit} noValidate data-testid="options-form">
      <h2 id={titleId} className="panel-title">
        Options
      </h2>
      <NumberField
        id="session-time"
        label="Game session time"
        hint={`${st.min}–${st.max} seconds, whole seconds.`}
        value={sessionTime}
        error={errors.sessionTime}
        step={st.step}
        min={st.min}
        max={st.max}
        unit="s"
        onChange={onField(setSessionTime)}
      />
      <NumberField
        id="spawn-interval"
        label="Enemy spawn time"
        hint={`${si.min}–${si.max} seconds between enemies, in steps of ${si.step} s.`}
        value={spawnInterval}
        error={errors.spawnInterval}
        step={si.step}
        min={si.min}
        max={si.max}
        unit="s"
        onChange={onField(setSpawnInterval)}
      />
      <div className={`field ${errors.name ? 'field--invalid' : ''}`}>
        <label htmlFor="captain-name" className="field__label">
          Captain name
        </label>
        <input
          id="captain-name"
          className="text-input"
          value={name}
          maxLength={NAME_LIMITS.max + 5}
          onChange={(e) => onField(setName)(e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'captain-name-error' : undefined}
          autoComplete="nickname"
          data-testid="captain-name-input"
        />
        {errors.name && (
          <p id="captain-name-error" className="field__error" role="alert">
            {errors.name}
          </p>
        )}
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={!muted} onChange={(e) => (setMuted(!e.target.checked), setSaved(null))} data-testid="sound-toggle" />
        <span>Sound effects</span>
      </label>
      <p className="form-status" role="status" data-testid="options-status">
        {saved ?? (dirty ? 'You have unsaved changes.' : '')}
      </p>
      <div className="form-actions">
        <MenuButton type="submit" size="sm" data-testid="options-save">
          Save
        </MenuButton>
        <MenuButton size="sm" variant="secondary" onClick={onBack} data-testid="options-back">
          {embedded ? 'Back' : 'Main Menu'}
        </MenuButton>
      </div>
    </form>
  );

  if (embedded) return content;
  return (
    <Panel labelledBy={titleId} className="options-panel">
      {content}
    </Panel>
  );
}
