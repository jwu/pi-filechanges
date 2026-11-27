import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * User-owned config for pi-filechanges:
 *
 *   <agent dir>/extensions/pi-filechanges.json
 *   e.g. ~/.pi/agent/extensions/pi-filechanges.json
 *
 * A missing or malformed file falls back to the defaults below.
 */

/** Key spec for the file list expansion shortcut, e.g. "alt+f" or "ctrl+shift+t". */
export type ToggleKeySpec = string;

/** Default toggle key when `toggleKey` is missing/empty/blank/invalid. */
export const DEFAULT_TOGGLE_KEY: ToggleKeySpec = 'alt+f';

/** Sentinel value for `toggleKey` that registers no shortcut at all. */
export const TOGGLE_KEY_OFF: ToggleKeySpec = 'off';

const DEFAULT_MAX_FILES = 8;

export interface FileChangesConfig {
  /** List expansion shortcut in Pi keybinding form. Use "off" to disable it. */
  toggleKey?: string;
  /** Maximum file rows in the compact widget, from 0 to 10. */
  maxfiles?: number;
}

/** Absolute path of the config file inside the given pi agent directory. */
export function getConfigPath(agentDir: string): string {
  return join(agentDir, 'extensions', 'pi-filechanges.json');
}

/** Read the config file. Any failure (missing file, bad JSON, non-object body)
 *  resolves to an empty config so callers keep their defaults. */
export function loadConfig(agentDir: string): FileChangesConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(getConfigPath(agentDir), 'utf-8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as FileChangesConfig) : {};
  } catch {
    return {};
  }
}

// Named keys accepted by pi-tui's `matchesKey` (its keys switch on the parsed
// base key, lowercased). Mirrors pi-tui's SpecialKey union.
const SPECIAL_KEYS = new Set([
  'escape',
  'esc',
  'enter',
  'return',
  'tab',
  'space',
  'backspace',
  'delete',
  'insert',
  'clear',
  'home',
  'end',
  'pageup',
  'pagedown',
  'up',
  'down',
  'left',
  'right',
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);

const MODIFIERS = new Set(['ctrl', 'shift', 'alt', 'super']);

// Single-character base keys pi-tui accepts (letters, digits, symbols).
const SINGLE_CHAR_BASE = /^[a-z0-9_\-!@#$%^&*()|~`'":;,./<>?[\]{}=\\]$/;

/**
 * Validate a toggle-key spec against pi-tui's KeyId grammar: zero or more
 * distinct modifiers, then a base key that is one printable character or a
 * named special key.
 *
 * A loose check is not enough — pi-tui's parser takes the LAST `+`-part as the
 * key and ignores unknown parts, so a typo like `ctr+]` would silently bind
 * every bare `]` press.
 */
export function isValidToggleKeySpec(spec: string): boolean {
  if (!spec) return false;
  if (spec.startsWith('+') || spec.endsWith('+') || spec.includes('++')) return false;
  const parts = spec.split('+');
  const base = parts[parts.length - 1] ?? '';
  const modifiers = parts.slice(0, -1);
  if (modifiers.length !== new Set(modifiers).size) return false;
  if (!modifiers.every((m) => MODIFIERS.has(m))) return false;
  return base.length === 1 ? SINGLE_CHAR_BASE.test(base) : SPECIAL_KEYS.has(base);
}

/**
 * Normalize a raw `toggleKey` value: lowercased validated spec, the "off"
 * sentinel, or DEFAULT_TOGGLE_KEY for anything missing/empty/blank/invalid.
 */
export function normalizeToggleKey(raw: unknown): ToggleKeySpec {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : undefined;
  if (value === undefined || value === '') return DEFAULT_TOGGLE_KEY;
  if (value === TOGGLE_KEY_OFF) return TOGGLE_KEY_OFF;
  return isValidToggleKeySpec(value) ? value : DEFAULT_TOGGLE_KEY;
}

export function resolveConfig(agentDir: string): Required<FileChangesConfig> {
  const { toggleKey, maxfiles } = loadConfig(agentDir);
  return {
    toggleKey: normalizeToggleKey(toggleKey),
    maxfiles:
      typeof maxfiles === 'number' && Number.isInteger(maxfiles) && maxfiles >= 0 && maxfiles <= 10
        ? maxfiles
        : DEFAULT_MAX_FILES,
  };
}
