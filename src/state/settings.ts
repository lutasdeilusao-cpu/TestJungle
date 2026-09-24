import { OPTION_LIMITS, type PlayerSettings } from '../game/config';
import { Store } from '../game/session/Store';
import { isRecord, readJson, writeJson } from './storage';

const SETTINGS_KEY = 'pb.settings.v1';
const PROFILE_KEY = 'pb.profile.v1';

export interface StoredSettings extends PlayerSettings {
  muted: boolean;
}

export interface PlayerProfile {
  id: string;
  name: string;
}

export type FieldErrors = Partial<Record<'sessionTime' | 'spawnInterval' | 'name', string>>;

export const NAME_LIMITS = { min: 2, max: 20 } as const;

export const DEFAULT_SETTINGS: StoredSettings = {
  sessionTime: OPTION_LIMITS.sessionTime.default,
  spawnInterval: OPTION_LIMITS.spawnInterval.default,
  muted: false,
};

/** Validates the Options form; returns an error message per invalid field. */
export function validateOptions(values: { sessionTime: number; spawnInterval: number; name: string }): FieldErrors {
  const errors: FieldErrors = {};
  const st = OPTION_LIMITS.sessionTime;
  const si = OPTION_LIMITS.spawnInterval;
  if (!Number.isFinite(values.sessionTime) || !Number.isInteger(values.sessionTime)) {
    errors.sessionTime = 'Enter a whole number of seconds.';
  } else if (values.sessionTime < st.min || values.sessionTime > st.max) {
    errors.sessionTime = `Must be between ${st.min} and ${st.max} seconds.`;
  }
  if (!Number.isFinite(values.spawnInterval) || values.spawnInterval <= 0) {
    errors.spawnInterval = 'Enter a positive number of seconds.';
  } else if (values.spawnInterval < si.min || values.spawnInterval > si.max) {
    errors.spawnInterval = `Must be between ${si.min} and ${si.max} seconds.`;
  } else if (Math.round(values.spawnInterval / si.step) * si.step !== values.spawnInterval) {
    errors.spawnInterval = `Use steps of ${si.step} seconds.`;
  }
  const name = values.name.trim();
  if (name.length < NAME_LIMITS.min || name.length > NAME_LIMITS.max) {
    errors.name = `Use ${NAME_LIMITS.min} to ${NAME_LIMITS.max} characters.`;
  }
  return errors;
}

function isSettings(v: unknown): v is StoredSettings {
  if (!isRecord(v)) return false;
  const errors = validateOptions({
    sessionTime: Number(v.sessionTime),
    spawnInterval: Number(v.spawnInterval),
    name: 'ok',
  });
  return Object.keys(errors).length === 0 && typeof v.muted === 'boolean';
}

function isProfile(v: unknown): v is PlayerProfile {
  return isRecord(v) && typeof v.id === 'string' && v.id.length > 0 && typeof v.name === 'string';
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadProfile(): PlayerProfile {
  const stored = readJson(PROFILE_KEY, isProfile);
  if (stored) return stored;
  const profile = { id: newId(), name: `Captain ${100 + Math.floor(Math.random() * 900)}` };
  writeJson(PROFILE_KEY, profile);
  return profile;
}

export const settingsStore = new Store<StoredSettings>(readJson(SETTINGS_KEY, isSettings) ?? DEFAULT_SETTINGS);
export const profileStore = new Store<PlayerProfile>(loadProfile());

export function saveSettings(next: StoredSettings): void {
  settingsStore.set(next);
  writeJson(SETTINGS_KEY, next);
}

export function saveProfileName(name: string): void {
  const profile = { ...profileStore.getSnapshot(), name: name.trim() };
  profileStore.set(profile);
  writeJson(PROFILE_KEY, profile);
}

export { newId };
