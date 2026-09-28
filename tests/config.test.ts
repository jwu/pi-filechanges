import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_TOGGLE_KEY,
  TOGGLE_KEY_OFF,
  getConfigPath,
  isValidToggleKeySpec,
  loadConfig,
  normalizeToggleKey,
  resolveToggleKey,
} from '../extensions/config.ts';

describe('isValidToggleKeySpec', () => {
  it('accepts single-character and named keys with modifiers', () => {
    for (const spec of [
      'a',
      ']',
      'alt+f',
      'ctrl+shift+t',
      'ctrl+alt+shift+super+a',
      'f5',
      'escape',
      'space',
      'pageup',
      'pagedown',
    ]) {
      assert.equal(isValidToggleKeySpec(spec), true, spec);
    }
  });

  it('rejects empty, malformed, and unknown specs', () => {
    for (const spec of [
      '',
      '+',
      'alt+',
      'alt++f',
      'ctr+]',
      'meta+f',
      'alt+alt+f',
      'foo',
      'f13',
      'pageUp',
      'ab',
    ]) {
      assert.equal(isValidToggleKeySpec(spec), false, spec);
    }
  });
});

describe('normalizeToggleKey', () => {
  it('falls back to the default for missing/empty/non-string values', () => {
    for (const raw of [undefined, null, 42, {}, '', '   ']) {
      assert.equal(normalizeToggleKey(raw), DEFAULT_TOGGLE_KEY);
    }
  });

  it('lowercases and trims valid specs', () => {
    assert.equal(normalizeToggleKey(' Alt+F '), 'alt+f');
    assert.equal(normalizeToggleKey('CTRL+SHIFT+T'), 'ctrl+shift+t');
  });

  it('preserves the "off" sentinel case-insensitively', () => {
    assert.equal(normalizeToggleKey('off'), TOGGLE_KEY_OFF);
    assert.equal(normalizeToggleKey('OFF'), TOGGLE_KEY_OFF);
  });

  it('falls back to the default for invalid specs', () => {
    assert.equal(normalizeToggleKey('ctr+]'), DEFAULT_TOGGLE_KEY);
  });
});

describe('config file resolution', () => {
  function withTempAgentDir(fn: (agentDir: string) => void): void {
    const agentDir = mkdtempSync(join(tmpdir(), 'pi-filechanges-'));
    try {
      fn(agentDir);
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  }

  it('resolves the config under the agent extensions directory', () => {
    assert.equal(
      getConfigPath('/home/me/.pi/agent'),
      '/home/me/.pi/agent/extensions/pi-filechanges.json',
    );
  });

  it('returns an empty config when the file is absent or malformed', () => {
    withTempAgentDir((agentDir) => {
      assert.deepEqual(loadConfig(agentDir), {});

      mkdirSync(join(agentDir, 'extensions'), { recursive: true });
      writeFileSync(getConfigPath(agentDir), 'not json');
      assert.deepEqual(loadConfig(agentDir), {});
    });
  });

  it('resolves toggleKey from a valid config file', () => {
    withTempAgentDir((agentDir) => {
      mkdirSync(join(agentDir, 'extensions'), { recursive: true });
      writeFileSync(getConfigPath(agentDir), JSON.stringify({ toggleKey: 'ctrl+shift+t' }));
      assert.equal(resolveToggleKey(agentDir), 'ctrl+shift+t');
    });
  });

  it('falls back to the default when toggleKey is absent', () => {
    withTempAgentDir((agentDir) => {
      assert.equal(resolveToggleKey(agentDir), DEFAULT_TOGGLE_KEY);
    });
  });
});
