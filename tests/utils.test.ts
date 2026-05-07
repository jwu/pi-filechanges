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
});
