import { createTwoFilesPatch } from 'diff';
import { relative, resolve } from 'node:path';

// --- Types ---

export type Baseline = {
  path: string; // normalized path relative to ctx.cwd where possible
  absPath: string;
  originalContent: string | null; // null => file did not exist (created)
  createdAt: number;
};

export type TrackedFile = {
  path: string;
  absPath: string;
  displayPath: string;
  originalContent: string | null;
  currentContent: string;
  added: number;
  removed: number;
  kind: 'new' | 'edited';
  updatedAt: number;
};

export type PendingSnapshot = {
  path: string;
  absPath: string;
  before: string | null;
};

// --- Pure / standalone utility functions ---

/**
 * Strip a leading "@" prefix from a path string if present.
 */
export function stripAtPrefix(p: string): string {
  return p.startsWith('@') ? p.slice(1) : p;
}

/**
 * Resolve a raw tool path (possibly "@"-prefixed) into absolute and
 * cwd-relative paths.
 */
export function normalizeToolPath(cwd: string, raw: string): { absPath: string; relPath: string } {
  const cleaned = stripAtPrefix(raw);
  const absPath = resolve(cwd, cleaned);
  const rel = relative(cwd, absPath);
  // Always use cwd-relative path for storage/UI.
  const relPath = rel || '.';
  return { absPath, relPath };
}

/**
 * Count added (+) and removed (-) lines in a unified diff, ignoring
 * the "+++", "---", and "@@" header lines.
 */
export function countDiffLines(unifiedDiff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of unifiedDiff.split('\n')) {
    if (line.startsWith('+++ ') || line.startsWith('--- ') || line.startsWith('@@')) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}

/**
 * Format added/removed counts as a plain string: "(+x/-y)".
 */
export function formatAddedRemovedPlain(added: number, removed: number): string {
  return `(+${added}/-${removed})`;
}

/**
 * Generate a unified diff patch between baseline and current content.
 * Pass null for original to indicate a new file.
 *
 * The patch is used only for computing aggregate added/removed counts;
 * the extension no longer exposes diff inspection UI.
 */
export function patchFromBaseline(
  displayPath: string,
  original: string | null,
  current: string,
): string {
  return createTwoFilesPatch(displayPath, displayPath, original ?? '', current, '', '', {
    context: 3,
  });
}

/**
 * Split command argument string into trimmed, non-empty tokens.
 */
export function splitArgs(args: string | undefined): string[] {
  if (!args) return [];
  return args
    .split(/\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- Theme-dependent formatting (accept a lightweight theme interface) ---

export interface ThemeLike {
  fg(color: string, text: string): string;
}

function compareAsciiLowercaseFirst(a: string, b: string): number {
  const rank = (char: string): number => {
    if (char >= 'a' && char <= 'z') return char.charCodeAt(0) - 97;
    if (char >= 'A' && char <= 'Z') return char.charCodeAt(0) - 65 + 26;
    return char.charCodeAt(0) + 52;
  };

  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const ar = rank(a[i]);
    const br = rank(b[i]);
    if (ar !== br) return ar - br;
  }

  return a.length - b.length;
}

/**
 * Build a short status string for the footer/status area.
 * Returns undefined when there are no tracked files.
 */
export function formatStatus(
  tracked: Map<string, TrackedFile>,
  theme?: ThemeLike,
): string | undefined {
  if (tracked.size === 0) return undefined;

  let edited = 0;
  let created = 0;
  for (const t of tracked.values()) {
    if (t.kind === 'new') created++;
    else edited++;
  }

  const status = `Δ${edited}  +${created}`;
  return theme ? theme.fg('muted', status) : status;
}

/**
 * Build a list of lines for the widget area (rendered above the editor).
 * At most `maxLines` files are shown; the rest are summarized.
 * Returns undefined when there are no tracked files.
 */
export function buildWidgetLines(
  tracked: Map<string, TrackedFile>,
  theme?: ThemeLike,
  maxLines?: number,
): string[] | undefined {
  if (tracked.size === 0) return undefined;
  const max = maxLines ?? 8;
  const items = [...tracked.values()].sort((a, b) =>
    compareAsciiLowercaseFirst(a.displayPath, b.displayPath),
  );
  const lines: string[] = [];

  for (const t of items.slice(0, max)) {
    const tag = t.kind === 'new' ? '+' : 'Δ';

    if (!theme) {
      lines.push(`${tag} ${t.displayPath} ${formatAddedRemovedPlain(t.added, t.removed)}`);
      continue;
    }

    const prefix = theme.fg('muted', `${tag} `) + theme.fg('muted', `${t.displayPath} `);
    const plus =
      t.added === 0 ? theme.fg('text', `+${t.added}`) : theme.fg('success', `+${t.added}`);
    const minus =
      t.removed === 0 ? theme.fg('text', `-${t.removed}`) : theme.fg('error', `-${t.removed}`);
    const counts =
      theme.fg('text', '(') + plus + theme.fg('text', '/') + minus + theme.fg('text', ')');

    lines.push(prefix + counts);
  }

  if (items.length > max) {
    const rest = items.length - max;
    lines.push(theme ? theme.fg('dim', `…and ${rest} more`) : `…and ${rest} more`);
  }
  return lines;
}
