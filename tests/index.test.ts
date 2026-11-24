import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import filechanges from '../extensions/index.ts';
import type { ThemeLike } from '../extensions/utils.ts';

function customEntry(customType: string, data: { path: string; originalContent?: string | null }) {
  return { type: 'custom', customType, data };
}

it('keeps the first baseline for aliased paths until the file is untracked', async (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'filechanges-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const alias = join(root, 'alias');
  mkdirSync(project);
  symlinkSync(project, alias, 'dir');
  writeFileSync(join(project, 'a.txt'), 'old\nnew\n');

  const branch = [
    customEntry('filechanges:baseline', {
      path: relative(project, join(alias, 'a.txt')),
      originalContent: 'old\n',
    }),
    customEntry('filechanges:baseline', { path: 'a.txt', originalContent: 'different\n' }),
  ];
  const theme: ThemeLike = { fg: (_, text) => text };
  type WidgetFactory = (tui: { getWidth(): number }, theme: ThemeLike) => { render(): string[] };
  let widgetFactory: WidgetFactory | undefined;
  const ctx = {
    cwd: project,
    hasUI: true,
    sessionManager: { getBranch: () => branch },
    ui: {
      theme,
      setStatus() {},
      setWidget(_name: string, factory: WidgetFactory | undefined) {
        widgetFactory = factory;
      },
    },
  };
  type SessionEvent = 'session_start' | 'session_tree';
  type SessionHandler = (event: { type: SessionEvent }, context: typeof ctx) => Promise<void>;
  const handlers = new Map<SessionEvent, SessionHandler>();
  const pi = {
    registerCommand() {},
    registerShortcut() {},
    on(event: SessionEvent, handler: SessionHandler) {
      handlers.set(event, handler);
    },
  };
  filechanges(pi as unknown as ExtensionAPI);

  async function emit(event: SessionEvent) {
    const handler = handlers.get(event);
    assert.ok(handler);
    await handler({ type: event }, ctx);
  }

  function renderWidget() {
    assert.ok(widgetFactory);
    return widgetFactory({ getWidth: () => 80 }, theme).render();
  }

  await emit('session_start');
  assert.deepEqual(renderWidget(), ['Δ a.txt (+1/-0)']);

  branch.push(customEntry('filechanges:untrack', { path: 'a.txt' }));
  await emit('session_tree');
  assert.deepEqual(renderWidget(), []);

  branch.push(customEntry('filechanges:baseline', { path: 'a.txt', originalContent: null }));
  await emit('session_tree');
  assert.deepEqual(renderWidget(), ['+ a.txt (+2/-0)']);
});
