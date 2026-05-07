import { createTwoFilesPatch } from 'diff';
import { dirname, relative, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

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
  diff: string;
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

/**
 * Ensure the parent directory exists for a given file path.
 */
export async function ensureParentDir(absPath: string): Promise<void> {
  await mkdir(dirname(absPath), { recursive: true });
}

// --- Theme-dependent formatting (accept a lightweight theme interface) ---

export interface ThemeLike {
  fg(color: string, text: string): string;
}

/**
 * Style "+x/-y" descriptions in select-list rows.
 * Matched patterns get colored success/error highlighting;
 * non-matching text is rendered as muted.
 */
export function styleAddedRemovedForList(theme: ThemeLike, text: string): string {
  const m = text.match(/^\+(\d+)\/\-(\d+)$/);
  if (!m) return theme.fg('muted', text);

  const added = Number(m[1]);
  const removed = Number(m[2]);

  const plus = added === 0 ? theme.fg('text', `+${added}`) : theme.fg('success', `+${added}`);
  const minus = removed === 0 ? theme.fg('text', `-${removed}`) : theme.fg('error', `-${removed}`);

  return plus + theme.fg('text', '/') + minus;
}

/**
 * Build a short status string for the footer bar.
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
  if (!theme) {
    return `Δ ${edited}  + ${created}`;
  }
  return theme.fg('muted', `Δ ${edited}  + ${created}`);
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
  const items = [...tracked.values()].sort((a, b) => b.updatedAt - a.updatedAt);
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

// --- UI construction helpers (used by the command handler) ---

export interface SelectListItem {
  value: string;
  label: string;
  description: string;
}

/**
 * Build the label for a single tracked file in the select list.
 */
export function buildTrackedFileLabel(t: TrackedFile): string {
  return `${t.kind === 'new' ? '+' : 'Δ'} ${t.displayPath}`;
}

/**
 * Build the description for a single tracked file (added/removed counts).
 */
export function buildTrackedFileDescription(t: TrackedFile): string {
  return `+${t.added}/-${t.removed}`;
}

/**
 * Build the SelectList items for the "filechanges" command overlay.
 * Sorted by updatedAt descending.
 */
export function buildSelectItems(tracked: Map<string, TrackedFile>): SelectListItem[] {
  const items = [...tracked.values()].sort((a, b) => b.updatedAt - a.updatedAt);

  return [
    {
      value: '__accept__',
      label: 'Accept changes (clear log)',
      description: 'Keep current files',
    },
    {
      value: '__decline__',
      label: 'Undo changes (revert)',
      description: 'Restore original contents',
    },
    {
      value: '__sep__',
      label: '────────',
      description: '',
    },
    ...items.map((t) => ({
      value: t.path,
      label: buildTrackedFileLabel(t),
      description: buildTrackedFileDescription(t),
    })),
  ];
}

/**
 * Wrap a unified diff string in a markdown code block for rendering.
 */
export function formatDiffMarkdown(diff: string): string {
  const body = diff.trimEnd() || '(no diff)';
  return '```diff\n' + body + '\n```';
}
