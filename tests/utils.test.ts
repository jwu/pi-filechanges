import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  stripAtPrefix,
  normalizeToolPath,
  countDiffLines,
  formatAddedRemovedPlain,
  patchFromBaseline,
  splitArgs,
  styleAddedRemovedForList,
  formatStatus,
  buildWidgetLines,
  buildSelectItems,
  buildTrackedFileLabel,
  buildTrackedFileDescription,
  formatDiffMarkdown,
  type TrackedFile,
  type ThemeLike,
} from '../extensions/utils.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a ThemeLike mock that wraps text in [color]...[/color] tags. */
function mockTheme(): ThemeLike {
  return {
    fg(color: string, text: string): string {
      return `[${color}]${text}[/${color}]`;
    },
  };
}

/** Helper to build a TrackedFile entry with minimal required fields. */
function trackedFile(overrides: Partial<TrackedFile> = {}): TrackedFile {
  return {
    path: 'src/foo.ts',
    absPath: '/cwd/src/foo.ts',
    displayPath: 'src/foo.ts',
    originalContent: null,
    currentContent: 'hello world',
    diff: '',
    added: 1,
    removed: 0,
    kind: 'new',
    updatedAt: 1000,
    ...overrides,
  };
}

/** Build a Map from a list of TrackedFile entries, keyed by path. */
function trackedMap(...files: TrackedFile[]): Map<string, TrackedFile> {
  const m = new Map<string, TrackedFile>();
  for (const f of files) m.set(f.path, f);
  return m;
}

// ---------------------------------------------------------------------------
// stripAtPrefix
// ---------------------------------------------------------------------------

describe('stripAtPrefix', () => {
  it('removes a single leading @', () => {
    assert.equal(stripAtPrefix('@src/foo.ts'), 'src/foo.ts');
  });

  it('leaves strings without @ unchanged', () => {
    assert.equal(stripAtPrefix('src/foo.ts'), 'src/foo.ts');
  });

  it('handles empty string', () => {
    assert.equal(stripAtPrefix(''), '');
  });

  it('only strips the first character when it is @', () => {
    assert.equal(stripAtPrefix('@'), '');
  });

  it('preserves internal @ symbols', () => {
    assert.equal(stripAtPrefix('path/@internal/file.ts'), 'path/@internal/file.ts');
  });
});

// ---------------------------------------------------------------------------
// normalizeToolPath
// ---------------------------------------------------------------------------

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

  it('escapes cwd — keeps original cleaned input', () => {
    const r = normalizeToolPath(cwd, '../../etc/passwd');
    assert.equal(r.absPath, '/home/etc/passwd');
    assert.equal(r.relPath, '../../etc/passwd');
  });

  it("resolves cwd itself to keep '.'", () => {
    const r = normalizeToolPath(cwd, '.');
    assert.equal(r.absPath, cwd);
    assert.equal(r.relPath, '.');
  });

  it('resolves nested relative path with @ prefix', () => {
    const r = normalizeToolPath(cwd, '@./src/lib/utils.ts');
    assert.equal(r.absPath, '/home/user/project/src/lib/utils.ts');
    assert.equal(r.relPath, 'src/lib/utils.ts');
  });
});

// ---------------------------------------------------------------------------
// countDiffLines
// ---------------------------------------------------------------------------

describe('countDiffLines', () => {
  it('returns zeros for empty diff', () => {
    const r = countDiffLines('');
    assert.equal(r.added, 0);
    assert.equal(r.removed, 0);
  });

  it('counts only added lines', () => {
    const diff = '@@ -1,0 +1,3 @@\n+line 1\n+line 2\n+line 3\n';
    const r = countDiffLines(diff);
    assert.equal(r.added, 3);
    assert.equal(r.removed, 0);
  });

  it('counts only removed lines', () => {
    const diff = '@@ -1,3 +1,0 @@\n-line 1\n-line 2\n-line 3\n';
    const r = countDiffLines(diff);
    assert.equal(r.added, 0);
    assert.equal(r.removed, 3);
  });

  it('counts mixed additions and removals', () => {
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
    const r = countDiffLines(diff);
    assert.equal(r.added, 3);
    assert.equal(r.removed, 2);
  });

  it('ignores +++ / --- / @@ header lines', () => {
    const diff = ['--- a/file.txt', '+++ b/file.txt', '@@ -1,1 +1,1 @@', '+real', ''].join('\n');
    const r = countDiffLines(diff);
    assert.equal(r.added, 1);
    assert.equal(r.removed, 0);
  });

  it('ignores empty trailing line', () => {
    const diff = '+one\n+two\n';
    const r = countDiffLines(diff);
    assert.equal(r.added, 2);
    assert.equal(r.removed, 0);
  });

  it('ignores context lines (no prefix)', () => {
    const diff = [
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -2,3 +2,4 @@',
      ' context-before',
      '-removed',
      '+added',
      ' context-after',
      '',
    ].join('\n');
    const r = countDiffLines(diff);
    assert.equal(r.added, 1);
    assert.equal(r.removed, 1);
  });
});

// ---------------------------------------------------------------------------
// formatAddedRemovedPlain
// ---------------------------------------------------------------------------

describe('formatAddedRemovedPlain', () => {
  it('formats both zero', () => {
    assert.equal(formatAddedRemovedPlain(0, 0), '(+0/-0)');
  });

  it('formats only additions', () => {
    assert.equal(formatAddedRemovedPlain(5, 0), '(+5/-0)');
  });

  it('formats only removals', () => {
    assert.equal(formatAddedRemovedPlain(0, 3), '(+0/-3)');
  });

  it('formats both non-zero', () => {
    assert.equal(formatAddedRemovedPlain(7, 2), '(+7/-2)');
  });

  it('handles large numbers', () => {
    assert.equal(formatAddedRemovedPlain(12345, 678), '(+12345/-678)');
  });
});

// ---------------------------------------------------------------------------
// patchFromBaseline
// ---------------------------------------------------------------------------

describe('patchFromBaseline', () => {
  const filePath = 'src/hello.ts';

  it('generates a diff for a new file (original=null)', () => {
    const patch = patchFromBaseline(filePath, null, "console.log('hi');\n");
    assert.ok(patch.includes('+++'));
    assert.ok(patch.includes('+console.log'));
  });

  it('generates a diff with addition', () => {
    const patch = patchFromBaseline(filePath, 'a\n', 'a\nb\n');
    const lines = patch.split('\n');
    const adds = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    assert.equal(adds.length, 1);
  });

  it('generates a diff with removal', () => {
    const patch = patchFromBaseline(filePath, 'a\nb\n', 'a\n');
    const lines = patch.split('\n');
    const removals = lines.filter((l) => l.startsWith('-') && !l.startsWith('---'));
    assert.equal(removals.length, 1);
  });

  it('generates a no-change diff when contents are equal', () => {
    const patch = patchFromBaseline(filePath, 'same\n', 'same\n');
    // With context=3 and equal files the diff is essentially empty
    assert.ok(!patch.includes('+') || patch.includes('+++'));
    assert.ok(!patch.includes('-') || patch.includes('---'));
  });

  it('generates a diff with context lines', () => {
    const patch = patchFromBaseline(
      filePath,
      'line1\nline2\nline3\nline4\nline5\n',
      'line1\nline2\nCHANGED\nline4\nline5\n',
    );
    // Should contain the hunk header
    assert.ok(patch.includes('@@'));
    // Should contain the changed line
    assert.ok(patch.includes('+CHANGED'));
    assert.ok(patch.includes('-line3'));
  });
});

// ---------------------------------------------------------------------------
// splitArgs
// ---------------------------------------------------------------------------

describe('splitArgs', () => {
  it('returns empty array for undefined', () => {
    assert.deepEqual(splitArgs(undefined), []);
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(splitArgs(''), []);
  });

  it('returns empty array for whitespace-only', () => {
    assert.deepEqual(splitArgs('   \t  '), []);
  });

  it('splits single argument', () => {
    assert.deepEqual(splitArgs('force'), ['force']);
  });

  it('splits multiple arguments', () => {
    assert.deepEqual(splitArgs('force verbose'), ['force', 'verbose']);
  });

  it('trims and collapses whitespace', () => {
    assert.deepEqual(splitArgs('  force   verbose  '), ['force', 'verbose']);
  });

  it('preserves special characters', () => {
    assert.deepEqual(splitArgs('--flag value'), ['--flag', 'value']);
  });

  it('splits on newlines', () => {
    assert.deepEqual(splitArgs('force\nverbose'), ['force', 'verbose']);
  });

  it('splits on tabs', () => {
    assert.deepEqual(splitArgs('force\tverbose'), ['force', 'verbose']);
  });
});

// ---------------------------------------------------------------------------
// styleAddedRemovedForList
// ---------------------------------------------------------------------------

describe('styleAddedRemovedForList', () => {
  const t = mockTheme();

  it('renders non-matching text as muted', () => {
    const result = styleAddedRemovedForList(t, 'Keep current files');
    assert.equal(result, '[muted]Keep current files[/muted]');
  });

  it('renders +5/-0 with success color for added and text for removed', () => {
    const result = styleAddedRemovedForList(t, '+5/-0');
    assert.equal(result, '[success]+5[/success][text]/[/text][text]-0[/text]');
  });

  it('renders +0/-3 with text for added and error for removed', () => {
    const result = styleAddedRemovedForList(t, '+0/-3');
    assert.equal(result, '[text]+0[/text][text]/[/text][error]-3[/error]');
  });

  it('renders +0/-0 with all text style', () => {
    const result = styleAddedRemovedForList(t, '+0/-0');
    assert.equal(result, '[text]+0[/text][text]/[/text][text]-0[/text]');
  });

  it('renders +10/-7 with both success and error', () => {
    const result = styleAddedRemovedForList(t, '+10/-7');
    assert.equal(result, '[success]+10[/success][text]/[/text][error]-7[/error]');
  });

  it('renders large numbers correctly', () => {
    const result = styleAddedRemovedForList(t, '+999/-888');
    assert.ok(result.includes('[success]+999[/success]'));
    assert.ok(result.includes('[error]-888[/error]'));
  });

  it('falls back to muted for text containing slashes but not matching pattern', () => {
    const result = styleAddedRemovedForList(t, 'note: edit/write changes');
    assert.equal(result, '[muted]note: edit/write changes[/muted]');
  });

  it('falls back to muted for pattern missing leading +', () => {
    const result = styleAddedRemovedForList(t, '5/-3');
    assert.equal(result, '[muted]5/-3[/muted]');
  });
});

// ---------------------------------------------------------------------------
// formatStatus
// ---------------------------------------------------------------------------

describe('formatStatus', () => {
  it('returns undefined for empty map', () => {
    assert.equal(formatStatus(trackedMap()), undefined);
  });

  it('shows only edited count (no theme)', () => {
    const m = trackedMap(
      trackedFile({ path: 'a.ts', kind: 'edited' }),
      trackedFile({ path: 'b.ts', kind: 'edited' }),
    );
    assert.equal(formatStatus(m), 'Δ 2  + 0');
  });

  it('shows only created count (no theme)', () => {
    const m = trackedMap(trackedFile({ path: 'a.ts', kind: 'new' }));
    assert.equal(formatStatus(m), 'Δ 0  + 1');
  });

  it('shows mixed counts (no theme)', () => {
    const m = trackedMap(
      trackedFile({ path: 'a.ts', kind: 'edited' }),
      trackedFile({ path: 'b.ts', kind: 'new' }),
      trackedFile({ path: 'c.ts', kind: 'new' }),
    );
    assert.equal(formatStatus(m), 'Δ 1  + 2');
  });

  it('wraps in muted color when theme is provided', () => {
    const t = mockTheme();
    const m = trackedMap(trackedFile({ path: 'a.ts', kind: 'edited' }));
    assert.equal(formatStatus(m, t), '[muted]Δ 1  + 0[/muted]');
  });

  it('shows all created (no theme)', () => {
    const m = trackedMap(
      trackedFile({ path: 'a.ts', kind: 'new' }),
      trackedFile({ path: 'b.ts', kind: 'new' }),
      trackedFile({ path: 'c.ts', kind: 'new' }),
    );
    assert.equal(formatStatus(m), 'Δ 0  + 3');
  });
});

// ---------------------------------------------------------------------------
// buildWidgetLines
// ---------------------------------------------------------------------------

describe('buildWidgetLines', () => {
  it('returns undefined for empty map', () => {
    assert.equal(buildWidgetLines(trackedMap()), undefined);
  });

  describe('without theme', () => {
    it('renders a single new file', () => {
      const m = trackedMap(
        trackedFile({
          path: 'a.ts',
          displayPath: 'a.ts',
          kind: 'new',
          added: 3,
          removed: 0,
          updatedAt: 100,
        }),
      );
      const lines = buildWidgetLines(m)!;
      assert.equal(lines.length, 1);
      assert.equal(lines[0], '+ a.ts (+3/-0)');
    });

    it('renders a single edited file with removals', () => {
      const m = trackedMap(
        trackedFile({
          path: 'a.ts',
          displayPath: 'a.ts',
          kind: 'edited',
          added: 1,
          removed: 2,
          updatedAt: 200,
        }),
      );
      const lines = buildWidgetLines(m)!;
      assert.equal(lines.length, 1);
      assert.equal(lines[0], 'Δ a.ts (+1/-2)');
    });

    it('sorts by updatedAt descending', () => {
      const m = trackedMap(
        trackedFile({
          path: 'old.ts',
          displayPath: 'old.ts',
          kind: 'edited',
          added: 1,
          removed: 0,
          updatedAt: 50,
        }),
        trackedFile({
          path: 'mid.ts',
          displayPath: 'mid.ts',
          kind: 'edited',
          added: 2,
          removed: 0,
          updatedAt: 100,
        }),
        trackedFile({
          path: 'new.ts',
          displayPath: 'new.ts',
          kind: 'new',
          added: 5,
          removed: 0,
          updatedAt: 200,
        }),
      );
      const lines = buildWidgetLines(m)!;
      assert.equal(lines[0], '+ new.ts (+5/-0)');
      assert.equal(lines[1], 'Δ mid.ts (+2/-0)');
      assert.equal(lines[2], 'Δ old.ts (+1/-0)');
    });

    it('shows overflow message beyond default max of 8', () => {
      const files = Array.from({ length: 10 }, (_, i) =>
        trackedFile({ path: `f${i}.ts`, displayPath: `f${i}.ts`, updatedAt: 1000 - i }),
      );
      const m = trackedMap(...files);
      const lines = buildWidgetLines(m)!;
      assert.equal(lines.length, 9); // 8 files + overflow
      assert.equal(lines[8], '…and 2 more');
    });

    it('respects custom maxLines', () => {
      const files = Array.from({ length: 5 }, (_, i) =>
        trackedFile({ path: `f${i}.ts`, displayPath: `f${i}.ts`, updatedAt: 1000 - i }),
      );
      const m = trackedMap(...files);
      const lines = buildWidgetLines(m, undefined, 3)!;
      assert.equal(lines.length, 4); // 3 files + overflow
      assert.equal(lines[3], '…and 2 more');
    });

    it('omits overflow when exactly at max', () => {
      const files = Array.from({ length: 8 }, (_, i) =>
        trackedFile({ path: `f${i}.ts`, displayPath: `f${i}.ts`, updatedAt: 1000 - i }),
      );
      const m = trackedMap(...files);
      const lines = buildWidgetLines(m)!;
      assert.equal(lines.length, 8);
      assert(!lines.some((l) => l.startsWith('…')));
    });

    it('omits overflow when below max', () => {
      const m = trackedMap(trackedFile({ path: 'a.ts', displayPath: 'a.ts', updatedAt: 100 }));
      const lines = buildWidgetLines(m)!;
      assert.equal(lines.length, 1);
      assert(!lines.some((l) => l.startsWith('…')));
    });

    it('renders edited file with only removals', () => {
      const m = trackedMap(
        trackedFile({
          path: 'del.ts',
          displayPath: 'del.ts',
          kind: 'edited',
          added: 0,
          removed: 10,
          updatedAt: 100,
        }),
      );
      const lines = buildWidgetLines(m)!;
      assert.equal(lines[0], 'Δ del.ts (+0/-10)');
    });
  });

  describe('with theme', () => {
    const t = mockTheme();

    it('renders new file with muted tag and colored counts', () => {
      const m = trackedMap(
        trackedFile({
          path: 'a.ts',
          displayPath: 'a.ts',
          kind: 'new',
          added: 5,
          removed: 0,
          updatedAt: 100,
        }),
      );
      const lines = buildWidgetLines(m, t)!;
      assert.equal(
        lines[0],
        '[muted]+ [/muted][muted]a.ts [/muted][text]([/text][success]+5[/success][text]/[/text][text]-0[/text][text])[/text]',
      );
    });

    it('renders edited file with Δ tag', () => {
      const m = trackedMap(
        trackedFile({
          path: 'b.ts',
          displayPath: 'b.ts',
          kind: 'edited',
          added: 0,
          removed: 3,
          updatedAt: 200,
        }),
      );
      const lines = buildWidgetLines(m, t)!;
      assert.ok(lines[0].includes('[muted]Δ [/muted]'));
      assert.ok(lines[0].includes('[error]-3[/error]'));
    });

    it('renders overflow with dim color', () => {
      const files = Array.from({ length: 12 }, (_, i) =>
        trackedFile({ path: `f${i}.ts`, displayPath: `f${i}.ts`, updatedAt: 1000 - i }),
      );
      const m = trackedMap(...files);
      const lines = buildWidgetLines(m, t)!;
      assert.equal(lines[8], '[dim]…and 4 more[/dim]');
    });

    it('renders mixed added/removed with both colors', () => {
      const m = trackedMap(
        trackedFile({
          path: 'mix.ts',
          displayPath: 'mix.ts',
          kind: 'edited',
          added: 3,
          removed: 2,
          updatedAt: 100,
        }),
      );
      const lines = buildWidgetLines(m, t)!;
      assert.ok(lines[0].includes('[success]+3[/success]'));
      assert.ok(lines[0].includes('[error]-2[/error]'));
    });

    it('renders zero added/removed with text color only', () => {
      const m = trackedMap(
        trackedFile({
          path: 'z.ts',
          displayPath: 'z.ts',
          kind: 'edited',
          added: 0,
          removed: 0,
          updatedAt: 100,
        }),
      );
      const lines = buildWidgetLines(m, t)!;
      assert.ok(lines[0].includes('[text]+0[/text]'));
      assert.ok(lines[0].includes('[text]-0[/text]'));
    });
  });
});

// ---------------------------------------------------------------------------
// buildTrackedFileLabel
// ---------------------------------------------------------------------------

describe('buildTrackedFileLabel', () => {
  it('uses + prefix for new files', () => {
    assert.equal(
      buildTrackedFileLabel(trackedFile({ kind: 'new', displayPath: 'src/foo.ts' })),
      '+ src/foo.ts',
    );
  });

  it('uses Δ prefix for edited files', () => {
    assert.equal(
      buildTrackedFileLabel(trackedFile({ kind: 'edited', displayPath: 'src/bar.ts' })),
      'Δ src/bar.ts',
    );
  });

  it('renders long paths correctly', () => {
    assert.equal(
      buildTrackedFileLabel(
        trackedFile({
          kind: 'edited',
          displayPath: 'very/deeply/nested/directory/structure/file.ts',
        }),
      ),
      'Δ very/deeply/nested/directory/structure/file.ts',
    );
  });
});

// ---------------------------------------------------------------------------
// buildTrackedFileDescription
// ---------------------------------------------------------------------------

describe('buildTrackedFileDescription', () => {
  it('formats added and removed', () => {
    assert.equal(buildTrackedFileDescription(trackedFile({ added: 5, removed: 3 })), '+5/-3');
  });

  it('formats zero changes', () => {
    assert.equal(buildTrackedFileDescription(trackedFile({ added: 0, removed: 0 })), '+0/-0');
  });

  it('formats only additions', () => {
    assert.equal(buildTrackedFileDescription(trackedFile({ added: 10, removed: 0 })), '+10/-0');
  });

  it('formats only removals', () => {
    assert.equal(buildTrackedFileDescription(trackedFile({ added: 0, removed: 7 })), '+0/-7');
  });
});

// ---------------------------------------------------------------------------
// buildSelectItems
// ---------------------------------------------------------------------------

describe('buildSelectItems', () => {
  it('includes accept, decline, and separator items even when no files are tracked', () => {
    const items = buildSelectItems(trackedMap());
    assert.equal(items.length, 3);
    assert.equal(items[0].value, '__accept__');
    assert.equal(items[1].value, '__decline__');
    assert.equal(items[2].value, '__sep__');
  });

  it('appends tracked files after the separator in updatedAt descending order', () => {
    const m = trackedMap(
      trackedFile({
        path: 'old.ts',
        displayPath: 'old.ts',
        kind: 'edited',
        added: 1,
        removed: 2,
        updatedAt: 50,
      }),
      trackedFile({
        path: 'new.ts',
        displayPath: 'new.ts',
        kind: 'new',
        added: 10,
        removed: 0,
        updatedAt: 200,
      }),
    );

    const items = buildSelectItems(m);
    assert.equal(items.length, 5); // accept + decline + sep + 2 files

    // First 3 are action items
    assert.equal(items[0].value, '__accept__');
    assert.equal(items[0].label, 'Accept changes (clear log)');
    assert.equal(items[0].description, 'Keep current files');

    assert.equal(items[1].value, '__decline__');
    assert.equal(items[1].label, 'Undo changes (revert)');
    assert.equal(items[1].description, 'Restore original contents');

    assert.equal(items[2].value, '__sep__');
    assert.equal(items[2].label, '────────');
    assert.equal(items[2].description, '');

    // Files sorted by updatedAt descending
    assert.equal(items[3].value, 'new.ts');
    assert.equal(items[3].label, '+ new.ts');
    assert.equal(items[3].description, '+10/-0');

    assert.equal(items[4].value, 'old.ts');
    assert.equal(items[4].label, 'Δ old.ts');
    assert.equal(items[4].description, '+1/-2');
  });

  it('uses file path as the select value', () => {
    const m = trackedMap(trackedFile({ path: 'very/deep/file.ts' }));
    const items = buildSelectItems(m);
    assert.equal(items[3].value, 'very/deep/file.ts');
  });

  it('handles many tracked files', () => {
    const files = Array.from({ length: 50 }, (_, i) =>
      trackedFile({ path: `f${i}.ts`, displayPath: `f${i}.ts`, updatedAt: 1000 - i }),
    );
    const m = trackedMap(...files);
    const items = buildSelectItems(m);
    assert.equal(items.length, 53); // 3 action items + 50 files
    // Verify descending order
    assert.equal(items[3].value, 'f0.ts');
    assert.equal(items[52].value, 'f49.ts');
  });
});

// ---------------------------------------------------------------------------
// formatDiffMarkdown
// ---------------------------------------------------------------------------

describe('formatDiffMarkdown', () => {
  it('wraps a normal diff in a markdown code block', () => {
    const diff = '@@ -1,3 +1,3 @@\n-old\n+new\n';
    const result = formatDiffMarkdown(diff);
    assert.equal(result, '```diff\n@@ -1,3 +1,3 @@\n-old\n+new\n```');
  });

  it('replaces empty or whitespace-only diff with placeholder', () => {
    assert.equal(formatDiffMarkdown(''), '```diff\n(no diff)\n```');
    assert.equal(formatDiffMarkdown('   \n  '), '```diff\n(no diff)\n```');
  });

  it('trims trailing whitespace from diff content', () => {
    const result = formatDiffMarkdown('+line\n  \n');
    assert.equal(result, '```diff\n+line\n```');
  });

  it('handles very long diffs', () => {
    const long = '+' + 'x'.repeat(500) + '\n-' + 'y'.repeat(500) + '\n';
    const result = formatDiffMarkdown(long);
    assert.ok(result.startsWith('```diff\n'));
    assert.ok(result.endsWith('\n```'));
    assert.ok(result.includes('x'.repeat(500)));
  });

  it('preserves existing markdown fence characters', () => {
    const diff = '-removed ```markdown``` inline\n';
    const result = formatDiffMarkdown(diff);
    assert.equal(result, '```diff\n-removed ```markdown``` inline\n```');
  });
});
