import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { getConfigPath } from '../extensions/config.ts';
import filechanges from '../extensions/index.ts';
import type { ThemeLike } from '../extensions/utils.ts';

function customEntry(customType: string, data: { path: string; originalContent?: string | null }) {
  return { type: 'custom', customType, data };
}

function mountWidget(project: string, branch: ReturnType<typeof customEntry>[]) {
  const theme: ThemeLike = { fg: (_, text) => text };
  let toolsExpanded = false;
  let toggle: (() => Promise<void>) | undefined;
  const shortcuts = new Map<string, () => void | Promise<void>>();
  type WidgetFactory = (tui: { getWidth(): number }, theme: ThemeLike) => { render(): string[] };
  let widgetFactory: WidgetFactory | undefined;
  const ctx = {
    cwd: project,
    hasUI: true,
    sessionManager: { getBranch: () => branch },
    ui: {
      theme,
      getToolsExpanded: () => toolsExpanded,
      notify() {},
      setWidget(_name: string, factory: WidgetFactory | undefined) {
        widgetFactory = factory;
      },
    },
  };
  type SessionEvent = 'session_start' | 'session_tree';
  type SessionHandler = (event: { type: SessionEvent }, context: typeof ctx) => Promise<void>;
  const handlers = new Map<SessionEvent, SessionHandler>();
  const pi = {
    registerCommand(
      _name: string,
      command: { handler: (args: string, context: typeof ctx) => Promise<void> },
    ) {
      toggle = () => command.handler('', ctx);
    },
    registerShortcut(key: string, shortcut: { handler: (context: typeof ctx) => void }) {
      shortcuts.set(key, () => shortcut.handler(ctx));
    },
    on(event: SessionEvent, handler: SessionHandler) {
      handlers.set(event, handler);
    },
  };
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = project;
  try {
    filechanges(pi as unknown as ExtensionAPI);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }

  async function emit(event: SessionEvent) {
    const handler = handlers.get(event);
    assert.ok(handler);
    await handler({ type: event }, ctx);
  }

  function renderWidget() {
    assert.ok(widgetFactory);
    return widgetFactory({ getWidth: () => 80 }, theme).render();
  }

  return {
    emit,
    renderWidget,
    shortcuts,
    toggleTools() {
      toolsExpanded = !toolsExpanded;
    },
    async toggleWidget() {
      assert.ok(toggle);
      await toggle();
    },
  };
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
  const { emit, renderWidget } = mountWidget(project, branch);

  await emit('session_start');
  assert.deepEqual(renderWidget(), ['Δ a.txt (+1/-0)']);

  branch.push(customEntry('filechanges:untrack', { path: 'a.txt' }));
  await emit('session_tree');
  assert.deepEqual(renderWidget(), []);

  branch.push(customEntry('filechanges:baseline', { path: 'a.txt', originalContent: null }));
  await emit('session_tree');
  assert.deepEqual(renderWidget(), ['+ a.txt (+2/-0)']);
});

it('expands the file list independently from tool output', async (t) => {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'filechanges-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const entries = Array.from({ length: 11 }, (_, i) => {
    const path = `file-${i}.txt`;
    writeFileSync(join(project, path), 'new\n');
    return customEntry('filechanges:baseline', { path, originalContent: i < 3 ? 'old\n' : null });
  });
  const branch = entries.slice(0, 8);
  const widget = mountWidget(project, branch);
  await widget.emit('session_start');
  const fullCompactList = widget.renderWidget();
  assert.equal(fullCompactList.length, 8);
  assert.equal(fullCompactList.at(-1), '+ file-7.txt (+1/-0)');

  branch.push(...entries.slice(8));
  await widget.emit('session_tree');

  const compact = widget.renderWidget();
  assert.equal(compact.length, 9);
  assert.equal(compact.at(-1), 'Δ3 +8 ... (3 more files, alt+f to expand)');

  widget.toggleTools();
  assert.deepEqual(widget.renderWidget(), compact);

  const toggleFiles = widget.shortcuts.get('alt+f');
  assert.ok(toggleFiles);
  await toggleFiles();
  const expanded = widget.renderWidget();
  assert.equal(expanded.length, 11);
  assert.equal(expanded.at(-1), '+ file-9.txt (+1/-0)');

  widget.toggleTools();
  assert.deepEqual(widget.renderWidget(), expanded);
  await toggleFiles();
  assert.deepEqual(widget.renderWidget(), compact);

  await widget.toggleWidget();
  const hidden = ['filechanges hidden · /filechanges to show'];
  assert.deepEqual(widget.renderWidget(), hidden);
  await toggleFiles();
  assert.deepEqual(widget.renderWidget(), hidden);
  await widget.toggleWidget();
  assert.deepEqual(widget.renderWidget(), compact);

  mkdirSync(join(project, 'extensions'));
  for (const [maxfiles, more] of [
    [0, '11 more files'],
    [10, '1 more file'],
  ] as const) {
    writeFileSync(getConfigPath(project), JSON.stringify({ maxfiles, toggleKey: 'ctrl+shift+t' }));
    const configured = mountWidget(project, entries);
    await configured.emit('session_start');

    const lines = configured.renderWidget();
    assert.equal(lines.length, maxfiles + 1, `maxfiles=${maxfiles}`);
    assert.equal(lines.at(-1), `Δ3 +8 ... (${more}, ctrl+shift+t to expand)`);

    const toggleConfigured = configured.shortcuts.get('ctrl+shift+t');
    assert.ok(toggleConfigured);
    await toggleConfigured();
    assert.equal(configured.renderWidget().length, 11);
  }

  writeFileSync(getConfigPath(project), JSON.stringify({ maxfiles: 0, toggleKey: 'off' }));
  const disabled = mountWidget(project, entries);
  await disabled.emit('session_start');
  assert.equal(disabled.shortcuts.size, 0);
  assert.deepEqual(disabled.renderWidget(), ['Δ3 +8 ... (11 more files)']);
});
