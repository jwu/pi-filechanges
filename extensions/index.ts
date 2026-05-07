import type { ExtensionAPI, ExtensionCommandContext } from '@mariozechner/pi-coding-agent';
import {
  DynamicBorder,
  getMarkdownTheme,
  isEditToolResult,
  isToolCallEventType,
  isWriteToolResult,
} from '@mariozechner/pi-coding-agent';
import { Container, Key, Markdown, SelectList, Text, matchesKey } from '@mariozechner/pi-tui';
import { readFile, writeFile, rm } from 'node:fs/promises';

import {
  normalizeToolPath,
  countDiffLines,
  patchFromBaseline,
  splitArgs,
  ensureParentDir,
  styleAddedRemovedForList,
  // DISABLE: formatStatus,
  buildWidgetLines,
  buildSelectItems,
  formatDiffMarkdown,
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

  function updateUi(_ctx?: any) {
    if (!_ctx?.hasUI) return;

    // DISABLE: _ctx.ui.setStatus('filechanges', formatStatus(tracked, _ctx.ui.theme));
    _ctx.ui.setWidget('filechanges', buildWidgetLines(tracked, _ctx.ui.theme));
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
        diff,
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
        diff,
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
      diff,
      added,
      removed,
      kind: 'edited',
      updatedAt: Date.now(),
    });
  }

  async function clearLog(reason: 'accept' | 'decline') {
    baselines.clear();
    tracked.clear();
    pendingByToolCallId.clear();
    pi.appendEntry(ENTRY_CLEAR, { timestamp: Date.now(), reason });
    updateUi();
  }

  async function declineAll(ctx: ExtensionCommandContext, args: string[] = []) {
    await ctx.waitForIdle();

    if (tracked.size === 0) {
      if (ctx.hasUI) ctx.ui.notify('filechanges: nothing to decline.', 'info');
      return;
    }

    const force = args.includes('force');
    if (ctx.hasUI && !force) {
      const ok = await ctx.ui.confirm(
        'Decline pi changes?',
        'This will revert ALL currently logged pi changes (overwrite files / delete created files).',
      );
      if (!ok) return;
    } else if (!ctx.hasUI && !force) {
      throw new Error('Decline requires confirmation. Run: /filechanges-decline force');
    }

    const items = [...tracked.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    let reverted = 0;
    const errors: string[] = [];

    for (const item of items) {
      try {
        if (item.originalContent === null) {
          // created file
          await rm(item.absPath, { force: true });
        } else {
          await ensureParentDir(item.absPath);
          await writeFile(item.absPath, item.originalContent, 'utf-8');
        }
        reverted++;
      } catch (e: any) {
        errors.push(`${item.displayPath}: ${e?.message ?? String(e)}`);
      }
    }

    await clearLog('decline');

    if (ctx.hasUI) {
      if (errors.length === 0) {
        ctx.ui.notify(`filechanges: declined changes for ${reverted} file(s).`, 'info');
      } else {
        ctx.ui.notify(
          `filechanges: declined with ${errors.length} error(s). Run /filechanges to inspect; see console for details.`,
          'warning',
        );
        console.warn('[filechanges] decline errors:\n' + errors.join('\n'));
      }
    }
  }

  async function acceptAll(ctx: ExtensionCommandContext, args: string[] = []) {
    await ctx.waitForIdle();

    if (tracked.size === 0) {
      if (ctx.hasUI) ctx.ui.notify('filechanges: nothing to accept.', 'info');
      return;
    }

    const force = args.includes('force');
    if (ctx.hasUI && !force) {
      const ok = await ctx.ui.confirm(
        'Accept pi changes?',
        'This will keep current files as-is and clear the modification log.',
      );
      if (!ok) return;
    } else if (!ctx.hasUI && !force) {
      throw new Error('Accept requires confirmation. Run: /filechanges-accept force');
    }

    const count = tracked.size;
    await clearLog('accept');
    if (ctx.hasUI) ctx.ui.notify(`filechanges: accepted changes for ${count} file(s).`, 'info');
  }

  // Commands
  pi.registerCommand('filechanges', {
    description: 'Show files changed by pi and inspect diffs',
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      updateUi(ctx);

      if (!ctx.hasUI) {
        const items = [...tracked.values()].sort((a, b) => b.updatedAt - a.updatedAt);
        if (items.length === 0) {
          console.log('filechanges: no pi-made modifications recorded.');
          return;
        }
        // Non-interactive: just print a summary to stdout
        const lines = buildWidgetLines(tracked) ?? [];
        console.log(lines.join('\n'));
        return;
      }

      // Interactive loop: ESC in diff view returns to the modification log.
      while (true) {
        await ctx.waitForIdle();
        updateUi(ctx);

        const items = [...tracked.values()].sort((a, b) => b.updatedAt - a.updatedAt);
        if (items.length === 0) {
          ctx.ui.notify('filechanges: no pi-made modifications recorded.', 'info');
          return;
        }

        const selectItems = buildSelectItems(tracked);

        const picked = await ctx.ui.custom<string | null>(
          (tui, theme, _kb, done) => {
            const container = new Container();
            container.addChild(new DynamicBorder((s: string) => theme.fg('accent', s)));
            container.addChild(new Text(theme.fg('accent', theme.bold('File changes')), 1, 0));

            const list = new SelectList(selectItems, Math.min(14, selectItems.length), {
              selectedPrefix: (t) => theme.fg('accent', t),
              selectedText: (t) => theme.fg('accent', t),
              description: (t) => styleAddedRemovedForList(theme, t),
              scrollInfo: (t) => theme.fg('dim', t),
              noMatch: (t) => theme.fg('warning', t),
            });

            list.onSelect = (item) => {
              if (item.value === '__sep__') return;
              done(item.value);
            };
            list.onCancel = () => done(null);
            container.addChild(list);

            container.addChild(
              new Text(theme.fg('dim', '↑↓ navigate • enter select • esc close'), 1, 0),
            );
            container.addChild(new DynamicBorder((s: string) => theme.fg('accent', s)));

            return {
              render: (w) => container.render(w),
              invalidate: () => container.invalidate(),
              handleInput: (data) => {
                list.handleInput(data);
                tui.requestRender();
              },
            };
          },
          { overlay: true },
        );

        if (!picked) return;
        if (picked === '__accept__') {
          await acceptAll(ctx, []);
          return;
        }
        if (picked === '__decline__') {
          await declineAll(ctx, []);
          return;
        }

        const t = tracked.get(picked);
        if (!t) {
          ctx.ui.notify('filechanges: entry not found (maybe log was cleared).', 'warning');
          continue;
        }

        const md = formatDiffMarkdown(t.diff);
        await ctx.ui.custom<void>(
          (tui, theme, _kb, done) => {
            const container = new Container();
            container.addChild(new DynamicBorder((s: string) => theme.fg('accent', s)));
            container.addChild(new Text(theme.fg('accent', theme.bold(t.displayPath)), 1, 0));
            container.addChild(new Markdown(md, 1, 0, getMarkdownTheme()));
            container.addChild(new Text(theme.fg('dim', 'esc to go back'), 1, 0));
            container.addChild(new DynamicBorder((s: string) => theme.fg('accent', s)));

            return {
              render: (w) => container.render(w),
              invalidate: () => container.invalidate(),
              handleInput: (data) => {
                if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) done();
                else tui.requestRender();
              },
            };
          },
          { overlay: true },
        );

        // After closing diff, loop back to the modification log.
      }
    },
  });

  pi.registerCommand('filechanges-accept', {
    description: 'Accept pi-made changes (keeps files, clears log)',
    handler: async (args, ctx) => {
      await acceptAll(ctx, splitArgs(args));
    },
  });

  pi.registerCommand('filechanges-decline', {
    description: 'Decline pi-made changes (reverts files, clears log)',
    handler: async (args, ctx) => {
      await declineAll(ctx, splitArgs(args));
    },
  });

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

    // Compute current diffs
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

    // Recompute cumulative diff against baseline
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
