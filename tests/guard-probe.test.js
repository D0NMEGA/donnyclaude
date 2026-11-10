/**
 * Destructive-command guard probe table.
 *
 * packages/hooks/cco-permission-guard.js is the only gate on Bash calls when Claude Code runs in
 * bypass-permissions mode. fixtures/guard-probe-cases.json is the 2026-11-10 probe set: rows are
 * [want, cwd, command] with want B (must block), A (must allow) or L (a recorded limit, not
 * graded). The commands reach the matcher as data and are never run.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

// The hook is CommonJS and is installed outside any package; this repo is "type": "module",
// so load a .cjs copy.
const copy = path.join(mkdtempSync(path.join(tmpdir(), 'guard-probe-')), 'guard.cjs');
copyFileSync(new URL('../packages/hooks/cco-permission-guard.js', import.meta.url), copy);
const guard = createRequire(import.meta.url)(copy);

const rows = JSON.parse(readFileSync(new URL('./fixtures/guard-probe-cases.json', import.meta.url), 'utf8'));
const home = homedir();
const cwds = { P: `${home}/Developer/proj`, H: home, D: `${home}/Developer`, R: '/', T: '/private/tmp/x' };
const fill = (raw) => raw.split('@H').join(home).split('@U').join(path.basename(home));

describe('destructive-command guard probe table', () => {
  for (const [want, verb] of [['B', 'blocks'], ['A', 'allows']]) {
    it(`${verb} every ${want} row`, () => {
      const graded = rows.filter((r) => r[0] === want);
      assert.ok(graded.length > 50, `expected the ${want} table, got ${graded.length} rows`);
      const wrong = graded
        .filter(([, cwd, raw]) => (guard.detectCatastrophe(fill(raw), cwds[cwd]) != null) !== (want === 'B'))
        .map(([, cwd, raw]) => `[${cwd}] ${raw}`);
      assert.deepEqual(wrong, []);
    });
  }

  it('returns a reason that names an unset variable', () => {
    const reason = guard.detectCatastrophe('rm -rf "$GUARD_PROBE_NOT_SET"/*', cwds.P);
    assert.match(reason, /unset variable \$GUARD_PROBE_NOT_SET/);
  });
});
