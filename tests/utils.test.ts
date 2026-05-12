import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  stripAtPrefix,
  normalizeToolPath,
  countDiffLines,
  formatAddedRemovedPlain,
  patchFromBaseline,
  splitArgs,
  formatStatus,
  buildWidgetLines,
  type TrackedFile,
  type ThemeLike,
} from '../extensions/utils.ts';

function mockTheme(): ThemeLike {
  return {
    fg(color: string, text: string): string {
      return `[${color}]${text}[/${color}]`;
    },
  };
}

function trackedFile(overrides: Partial<TrackedFile> = {}): TrackedFile {
  return {
    path: 'src/foo.ts',
    absPath: '/cwd/src/foo.ts',
    displayPath: 'src/foo.ts',
    originalContent: null,
    currentContent: 'hello world',
    added: 1,
    removed: 0,
    kind: 'new',
    updatedAt: 1000,
    ...overrides,
  };
}

function trackedMap(...files: TrackedFile[]): Map<string, TrackedFile> {
  const m = new Map<string, TrackedFile>();
  for (const f of files) m.set(f.path, f);
  return m;
}

describe('stripAtPrefix', () => {
  it('removes a single leading @', () => {
    assert.equal(stripAtPrefix('@src/foo.ts'), 'src/foo.ts');
  });

  it('leaves strings without @ unchanged', () => {
    assert.equal(stripAtPrefix('src/foo.ts'), 'src/foo.ts');
  });

  it('preserves internal @ symbols', () => {
    assert.equal(stripAtPrefix('path/@internal/file.ts'), 'path/@internal/file.ts');
  });
});

describe('normalizeToolPath', () => {
  const cwd = '/home/user/project';

  it('resolves a relative path within cwd', () => {
    const r = normalizeToolPath(cwd, 'src/index.ts');
    assert.equal(r.absPath, '/home/user/project/src/index.ts');
    assert.equal(r.relPath, 'src/index.ts');
  });

  it('strips @ prefix before resolving', () => {
    const r = normalizeToolPath(cwd, '@src/index.ts');
    assert.equal(r.absPath, '/home/user/project/src/index.ts');
    assert.equal(r.relPath, 'src/index.ts');
  });

  it('handles absolute path within cwd', () => {
    const r = normalizeToolPath(cwd, '/home/user/project/lib/util.js');
    assert.equal(r.absPath, '/home/user/project/lib/util.js');
    assert.equal(r.relPath, 'lib/util.js');
  });

  it('keeps paths outside cwd relative to cwd', () => {
    const r = normalizeToolPath(cwd, '/etc/hosts');
    assert.equal(r.absPath, '/etc/hosts');
    assert.equal(r.relPath, '../../../etc/hosts');
  });

  it("resolves cwd itself to '.'", () => {
    const r = normalizeToolPath(cwd, '.');
    assert.equal(r.absPath, cwd);
    assert.equal(r.relPath, '.');
  });
});

describe('countDiffLines', () => {
  it('returns zeros for empty diff', () => {
    assert.deepEqual(countDiffLines(''), { added: 0, removed: 0 });
  });

  it('counts mixed additions and removals while ignoring headers', () => {
    const diff = [
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,5 +1,5 @@',
      ' unchanged',
      '-removed1',
      '-removed2',
      '+added1',
      '+added2',
      '+added3',
      '',
    ].join('\n');
    assert.deepEqual(countDiffLines(diff), { added: 3, removed: 2 });
  });

  it('ignores context lines', () => {
    const diff = ' context\n-removed\n+added\n';
    assert.deepEqual(countDiffLines(diff), { added: 1, removed: 1 });
  });
});

describe('formatAddedRemovedPlain', () => {
  it('formats added and removed counts', () => {
    assert.equal(formatAddedRemovedPlain(7, 2), '(+7/-2)');
  });

  it('formats zero counts', () => {
    assert.equal(formatAddedRemovedPlain(0, 0), '(+0/-0)');
  });
});

describe('patchFromBaseline', () => {
  it('generates a diff for a new file', () => {
    const patch = patchFromBaseline('src/hello.ts', null, "console.log('hi');\n");
    assert.ok(patch.includes('+++'));
    assert.ok(patch.includes('+console.log'));
  });

  it('generates a diff with addition and removal', () => {
    const patch = patchFromBaseline('src/hello.ts', 'a\nb\n', 'a\nc\n');
    assert.ok(patch.includes('-b'));
    assert.ok(patch.includes('+c'));
  });
});

describe('splitArgs', () => {
  it('returns empty array for missing or blank args', () => {
    assert.deepEqual(splitArgs(undefined), []);
    assert.deepEqual(splitArgs('   \t  '), []);
  });

  it('splits and trims args', () => {
    assert.deepEqual(splitArgs('  clear   force\n'), ['clear', 'force']);
  });
});

describe('formatStatus', () => {
  it('returns undefined for empty map', () => {
    assert.equal(formatStatus(trackedMap()), undefined);
  });

  it('counts edited and new files', () => {
    const m = trackedMap(
      trackedFile({ path: 'a.ts', kind: 'edited' }),
      trackedFile({ path: 'b.ts', kind: 'new' }),
      trackedFile({ path: 'c.ts', kind: 'new' }),
    );
    assert.equal(formatStatus(m), 'Δ1  +2');
  });

  it('uses muted theme color when provided', () => {
    const m = trackedMap(trackedFile({ kind: 'edited' }));
    assert.equal(formatStatus(m, mockTheme()), '[muted]Δ1  +0[/muted]');
  });
});

describe('buildWidgetLines', () => {
  it('returns undefined for empty map', () => {
    assert.equal(buildWidgetLines(trackedMap()), undefined);
  });

  it('renders new and edited files without theme', () => {
    const m = trackedMap(
      trackedFile({ path: 'a.ts', displayPath: 'a.ts', kind: 'new', added: 3, updatedAt: 100 }),
      trackedFile({
        path: 'b.ts',
        displayPath: 'b.ts',
        kind: 'edited',
        removed: 2,
        updatedAt: 200,
      }),
    );
    assert.deepEqual(buildWidgetLines(m), ['+ a.ts (+3/-0)', 'Δ b.ts (+1/-2)']);
  });

  it('sorts files by displayPath ascending', () => {
    const m = trackedMap(
      trackedFile({ path: 'z.ts', displayPath: 'z.ts' }),
      trackedFile({ path: 'a.ts', displayPath: 'a.ts' }),
      trackedFile({ path: 'm.ts', displayPath: 'm.ts' }),
    );
    assert.deepEqual(
      buildWidgetLines(m)?.map((line) => line.split(' ')[1]),
      ['a.ts', 'm.ts', 'z.ts'],
    );
  });

  it('sorts lowercase a-z before uppercase A-Z', () => {
    const m = trackedMap(
      trackedFile({ path: 'B.ts', displayPath: 'B.ts' }),
      trackedFile({ path: 'a.ts', displayPath: 'a.ts' }),
      trackedFile({ path: 'A.ts', displayPath: 'A.ts' }),
      trackedFile({ path: 'b.ts', displayPath: 'b.ts' }),
    );
    assert.deepEqual(
      buildWidgetLines(m)?.map((line) => line.split(' ')[1]),
      ['a.ts', 'b.ts', 'A.ts', 'B.ts'],
    );
  });

  it('shows overflow beyond max lines', () => {
    const files = Array.from({ length: 5 }, (_, i) =>
      trackedFile({ path: `f${i}.ts`, displayPath: `f${i}.ts`, updatedAt: 1000 - i }),
    );
    assert.equal(buildWidgetLines(trackedMap(...files), undefined, 3)?.at(-1), '…and 2 more');
  });

  it('renders themed counts', () => {
    const lines = buildWidgetLines(
      trackedMap(trackedFile({ displayPath: 'mix.ts', kind: 'edited', added: 3, removed: 2 })),
      mockTheme(),
    );
    assert.ok(lines?.[0].includes('[success]+3[/success]'));
    assert.ok(lines?.[0].includes('[error]-2[/error]'));
  });

  // ---- truncation (maxWidth) without theme ----

  it('shows full line when maxWidth is enough (no theme)', () => {
    const m = trackedMap(
      trackedFile({ displayPath: 'src/foo.ts', kind: 'new', added: 2, removed: 0 }),
    );
    const lines = buildWidgetLines(m, undefined, 8, 80);
    assert.deepEqual(lines, ['+ src/foo.ts (+2/-0)']);
  });

  it('truncates path from left when maxWidth is tight (no theme)', () => {
    const m = trackedMap(
      trackedFile({
        displayPath: 'very/long/path/to/file.ts',
        kind: 'edited',
        added: 1,
        removed: 1,
      }),
    );
    // Full: "Δ very/long/path/to/file.ts (+1/-1)" = 35 chars
    const lines = buildWidgetLines(m, undefined, 8, 25);
    const line = lines?.[0] ?? '';
    assert.ok(line.startsWith('Δ ...'));
    assert.ok(line.endsWith(' (+1/-1)'));
    // Should keep the tail of the path after "..."
    assert.ok(line.includes('file.ts'));
    // Should NOT contain the full beginning
    assert.ok(!line.includes('very/long'));
  });

  it('falls back to minimal form when terminal is extremely narrow (no theme)', () => {
    const m = trackedMap(
      trackedFile({ displayPath: 'src/foo.ts', kind: 'edited', added: 2, removed: 1 }),
    );
    // Full: "Δ src/foo.ts (+2/-1)" = 21 chars, minimal: "Δ ... (+2/-1)" = 14 chars
    const lines = buildWidgetLines(m, undefined, 8, 10);
    assert.deepEqual(lines, ['Δ ... (+2/-1)']);
  });

  // ---- truncation (maxWidth) with theme ----

  it('shows full themed line when maxWidth is enough', () => {
    const m = trackedMap(
      trackedFile({ displayPath: 'src/foo.ts', kind: 'new', added: 5, removed: 0 }),
    );
    const lines = buildWidgetLines(m, mockTheme(), 8, 80);
    const line = lines?.[0] ?? '';
    // Themed: [muted]+ [/muted][muted]src/foo.ts [/muted][text]([/text][success]+5[/success][text]/[/text][text]+0[/text][text])[/text]
    assert.ok(line.includes('[muted]src/foo.ts [/muted]'));
    assert.ok(line.includes('[success]+5[/success]'));
    assert.ok(line.includes('[text]-0[/text]'));
  });

  it('truncates path from left in themed output when maxWidth is tight', () => {
    const m = trackedMap(
      trackedFile({
        displayPath: 'very/long/path/to/file.ts',
        kind: 'edited',
        added: 1,
        removed: 1,
      }),
    );
    const lines = buildWidgetLines(m, mockTheme(), 8, 30);
    const line = lines?.[0] ?? '';
    assert.ok(line.includes('...'));
    assert.ok(line.includes('file.ts'));
    assert.ok(!line.includes('very/long'));
  });

  it('truncates path with CJK characters correctly', () => {
    const m = trackedMap(
      trackedFile({
        displayPath: '工作/日报/2026-05-12.md',
        kind: 'edited',
        added: 3,
        removed: 1,
      }),
    );
    // Full visible width: "Δ "(2) + CJK path (5*2 + 2 + 2*2 + 8 = 10+2+4+8=24) + " (+3/-1)"(9) = 35
    const lines = buildWidgetLines(m, mockTheme(), 8, 28);
    const line = lines?.[0] ?? '';
    assert.ok(line.includes('...'));
    // Should keep the filename tail
    assert.ok(line.includes('2026-05-12.md'));
    // Should NOT show the full prefix
    assert.ok(!line.includes('工作/日报'));
  });

  it('falls back to minimal themed form on extremely narrow terminal', () => {
    const m = trackedMap(
      trackedFile({ displayPath: 'src/foo.ts', kind: 'edited', added: 2, removed: 1 }),
    );
    const lines = buildWidgetLines(m, mockTheme(), 8, 10);
    const line = lines?.[0] ?? '';
    // Minimal: [muted]Δ ... [/muted][text]([/text][success]+2[/success][text]/[/text][error]-1[/error][text])[/text]
    assert.ok(line.includes('[muted]'));
    assert.ok(line.includes('...'));
    assert.ok(line.includes('[success]+2[/success]'));
    assert.ok(line.includes('[error]-1[/error]'));
    // Should NOT contain any path
    assert.ok(!line.includes('src/foo.ts'));
  });
});
