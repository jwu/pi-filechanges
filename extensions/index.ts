import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
  getAgentDir,
  isEditToolResult,
  isToolCallEventType,
  isWriteToolResult,
} from '@earendil-works/pi-coding-agent';
import { readFile } from 'node:fs/promises';

import { TOGGLE_KEY_OFF, resolveConfig } from './config.js';
import {
  normalizeToolPath,
  countDiffLines,
  patchFromBaseline,
  splitArgs,
  formatStatus,
  buildWidgetLines,
  type Baseline,
  type TrackedFile,
  type PendingSnapshot,
} from './utils.js';

// Custom session entry types
const ENTRY_BASELINE = 'filechanges:baseline';
const ENTRY_CLEAR = 'filechanges:clear';
const ENTRY_UNTRACK = 'filechanges:untrack';

async function readTextOrNull(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, 'utf-8');
  } catch {
    return null;
  }
}

export default function (pi: ExtensionAPI) {
  // In-memory state (reconstructed on session_start from custom entries)
  const baselines = new Map<string, Baseline>(); // key: relPath
  const tracked = new Map<string, TrackedFile>(); // key: relPath

  // Per-tool-call snapshot, only committed on successful tool_result
  const pendingByToolCallId = new Map<string, PendingSnapshot>();

  // Widget is shown by default; `/filechanges` toggles it.
  let showWidget = true;
  let expanded = false;

  // Read the widget settings once per extension load.
  const { toggleKey, maxfiles } = resolveConfig(getAgentDir());

  function updateUi(ctx?: any) {
    if (!ctx?.hasUI) return;
    if (!showWidget) {
      // Keep a one-line hint in place of the widget so the collapse is
      // discoverable — but only when there is something to expand into.
      if (tracked.size === 0) {
        ctx.ui.setWidget('filechanges', undefined);
        return;
      }
      ctx.ui.setWidget('filechanges', (_tui: any, theme: any) => ({
        render: () => {
          const line = theme.fg('dim', 'filechanges hidden · /filechanges to show');
          const termWidth = _tui?.getWidth?.() ?? process.stdout.columns ?? 80;
          return [
            typeof _tui?.truncateToWidth === 'function'
              ? _tui.truncateToWidth(line, termWidth)
              : line,
          ];
        },
        invalidate: () => {},
      }));
      return;
    }
    ctx.ui.setWidget('filechanges', (_tui: any, theme: any) => ({
      render: () => {
        const maxLines = expanded ? tracked.size : maxfiles;
        const termWidth = _tui?.getWidth?.() ?? process.stdout.columns ?? 80;
        const lines = buildWidgetLines(tracked, theme, maxLines, termWidth) ?? [];
        if (tracked.size > maxLines) {
          const rest = tracked.size - maxLines;
          const summary = formatStatus(tracked, theme);
          const label = rest === 1 ? 'file' : 'files';
          const hint = toggleKey === TOGGLE_KEY_OFF ? '' : `, ${toggleKey} to expand`;
          const more = theme.fg('dim', `... (${rest} more ${label}${hint})`);
          lines[lines.length - 1] = `${summary} ${more}`;
        }
        // Safety net: brute-force truncate any line that still exceeds terminal width
        for (let i = 0; i < lines.length; i++) {
          if (typeof _tui?.truncateToWidth === 'function') {
            lines[i] = _tui.truncateToWidth(lines[i], termWidth);
          }
        }
        return lines;
      },
      invalidate: () => {},
    }));
  }

  function toggleWidget(ctx?: any) {
    showWidget = !showWidget;
    updateUi(ctx);

    const message = showWidget ? 'file changes shown' : 'file changes hidden';
    if (ctx?.hasUI) ctx.ui.notify(message, 'info');
    else console.log(message);
  }

  async function recomputeTrackedFile(relPath: string) {
    const baseline = baselines.get(relPath);
    if (!baseline) return;

    const current = await readTextOrNull(baseline.absPath);
    if (baseline.originalContent === null) {
      // file was created
      if (current === null) {
        tracked.delete(relPath);
        return;
      }
      const displayPath = baseline.path;
      const diff = patchFromBaseline(displayPath, null, current);
      const { added, removed } = countDiffLines(diff);
      tracked.set(relPath, {
        path: baseline.path,
        absPath: baseline.absPath,
        displayPath,
        originalContent: null,
        currentContent: current,
        added,
        removed,
        kind: 'new',
        updatedAt: Date.now(),
      });
      return;
    }

    // file existed before
    if (current === null) {
      // Deleted outside of tracked tools (or manually). Still track as edited; diff will show removal.
      const displayPath = baseline.path;
      const diff = patchFromBaseline(displayPath, baseline.originalContent, '');
      const { added, removed } = countDiffLines(diff);
      tracked.set(relPath, {
        path: baseline.path,
        absPath: baseline.absPath,
        displayPath,
        originalContent: baseline.originalContent,
        currentContent: '',
        added,
        removed,
        kind: 'edited',
        updatedAt: Date.now(),
      });
      return;
    }

    if (current === baseline.originalContent) {
      // back to original; untrack
      tracked.delete(relPath);
      return;
    }

    const displayPath = baseline.path;
    const diff = patchFromBaseline(displayPath, baseline.originalContent, current);
    const { added, removed } = countDiffLines(diff);
    tracked.set(relPath, {
      path: baseline.path,
      absPath: baseline.absPath,
      displayPath,
      originalContent: baseline.originalContent,
      currentContent: current,
      added,
      removed,
      kind: 'edited',
      updatedAt: Date.now(),
    });
  }

  async function clearLog(ctx?: ExtensionCommandContext) {
    baselines.clear();
    tracked.clear();
    pendingByToolCallId.clear();
    pi.appendEntry(ENTRY_CLEAR, { timestamp: Date.now(), reason: 'clear' });
    updateUi(ctx);
  }

  pi.registerCommand('filechanges', {
    description: 'Toggle the tracked file changes widget. Usage: /filechanges [clear]',
    getArgumentCompletions: (prefix) => {
      const trimmed = prefix.trimStart();
      if (trimmed.includes(' ')) return null;
      if (!'clear'.startsWith(trimmed)) return null;
      return [{ value: 'clear', label: 'clear', description: 'Clear the tracked changes log' }];
    },
    handler: async (args, ctx) => {
      const tokens = splitArgs(args);
      if (tokens.length === 0) {
        toggleWidget(ctx);
        return;
      }

      if (tokens[0] === 'clear') {
        const count = tracked.size;
        await clearLog(ctx);

        const message = `filechanges: cleared ${count} tracked file(s).`;
        if (ctx.hasUI) ctx.ui.notify(message, 'info');
        else console.log(message);
        return;
      }

      const message = 'filechanges: usage: /filechanges [clear]';
      if (ctx.hasUI) ctx.ui.notify(message, 'info');
      else console.log(message);
    },
  });

  if (toggleKey !== TOGGLE_KEY_OFF) {
    pi.registerShortcut(toggleKey as Parameters<ExtensionAPI['registerShortcut']>[0], {
      description: 'Expand or collapse the file changes list',
      handler: (ctx) => {
        if (!showWidget) return;
        expanded = !expanded;
        updateUi(ctx);
      },
    });
  }

  async function rebuildFromSession(ctx: any): Promise<void> {
    baselines.clear();
    tracked.clear();
    pendingByToolCallId.clear();

    // Replay custom entries on current branch
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== 'custom') continue;

      if (entry.customType === ENTRY_CLEAR) {
        baselines.clear();
        tracked.clear();
        continue;
      }

      if (entry.customType === ENTRY_BASELINE) {
        const data = entry.data as any;
        if (!data?.path) continue;
        const { absPath, relPath } = normalizeToolPath(ctx.cwd, data.path);
        // Older sessions could record the same file under both its real path and a symlink.
        if (baselines.has(relPath)) continue;
        baselines.set(relPath, {
          path: relPath,
          absPath,
          originalContent: typeof data.originalContent === 'string' ? data.originalContent : null,
          createdAt: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
        });
        continue;
      }

      if (entry.customType === ENTRY_UNTRACK) {
        const data = entry.data as any;
        if (!data?.path) continue;
        const { relPath } = normalizeToolPath(ctx.cwd, data.path);
        baselines.delete(relPath);
        tracked.delete(relPath);
        continue;
      }
    }

    // Compute current change counts
    for (const relPath of baselines.keys()) {
      await recomputeTrackedFile(relPath);
    }

    updateUi(ctx);
  }

  // Rebuild state on any session/branch navigation events
  pi.on('session_start', async (_event, ctx) => {
    await rebuildFromSession(ctx);
  });

  pi.on('session_tree', async (_event, ctx) => {
    await rebuildFromSession(ctx);
  });

  pi.on('session_before_fork', async (_event, ctx) => {
    await rebuildFromSession(ctx);
  });

  // Capture before snapshots for edit/write
  pi.on('tool_call', async (event, ctx) => {
    if (isToolCallEventType('edit', event) || isToolCallEventType('write', event)) {
      const { absPath, relPath } = normalizeToolPath(ctx.cwd, event.input.path);
      const before = await readTextOrNull(absPath);
      pendingByToolCallId.set(event.toolCallId, { path: relPath, absPath, before });
    }
  });

  // Commit on successful results
  pi.on('tool_result', async (event, ctx) => {
    if (event.isError) {
      pendingByToolCallId.delete(event.toolCallId);
      return;
    }

    if (!isEditToolResult(event) && !isWriteToolResult(event)) return;

    const pending = pendingByToolCallId.get(event.toolCallId);
    pendingByToolCallId.delete(event.toolCallId);
    if (!pending) return;

    // If no baseline exists yet for this file, create one now from the successful call's snapshot.
    if (!baselines.has(pending.path)) {
      baselines.set(pending.path, {
        path: pending.path,
        absPath: pending.absPath,
        originalContent: pending.before,
        createdAt: Date.now(),
      });
      pi.appendEntry(ENTRY_BASELINE, {
        path: pending.path,
        originalContent: pending.before,
        timestamp: Date.now(),
      });
    }

    // Recompute cumulative change counts against baseline
    await recomputeTrackedFile(pending.path);

    // If file is back to baseline, untrack + persist
    const baseline = baselines.get(pending.path);
    const current = await readTextOrNull(pending.absPath);
    if (baseline) {
      const backToOriginal =
        (baseline.originalContent !== null && current === baseline.originalContent) ||
        (baseline.originalContent === null && current === null);

      if (backToOriginal) {
        baselines.delete(pending.path);
        tracked.delete(pending.path);
        pi.appendEntry(ENTRY_UNTRACK, { path: pending.path, timestamp: Date.now() });
      }
    }

    updateUi(ctx);
  });
}
