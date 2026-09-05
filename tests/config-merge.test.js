/**
 * Phase 24 - global defaults that apply at runtime.
 *
 * CONFIG-01  a value in ~/.donny/defaults.json takes effect in an EXISTING project
 * CONFIG-02  a project value overrides the global; an unset project key falls through
 * CONFIG-03  every config key is registered, and config-set rejects a typo
 *
 * The engine is driven as a subprocess through tests/helpers/cli.mjs, because
 * error() calls process.exit(1) and output() writes with fs.writeSync(1, ...).
 * The global layer is redirected with DONNY_HOME (D-15), never by moving HOME.
 *
 * Every later plan in this phase appends a describe block here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { HERMETIC_DONNY_HOME, ROOT, runTools, withConfigFixture } from './helpers/cli.mjs';
import { buildGlobalDefaults, buildRawGlobalDefaults, cleanupFixture } from './helpers/planning-fixture.mjs';

const require = createRequire(import.meta.url);
const CONFIG = require(resolve(ROOT, 'packages/donny/bin/lib/config.cjs'));
const CORE = require(resolve(ROOT, 'packages/donny/bin/lib/core.cjs'));

const readCfgRaw = (root) => fs.readFileSync(join(root, '.planning', 'config.json'), 'utf-8');
const readCfg = (root) => JSON.parse(readCfgRaw(root));

// ---------------------------------------------------------------------------
// CONFIG-03 is already satisfied by shipped code: both rejection paths were
// measured working on 2026-09-04, one naming the exact alternative from
// CONFIG_KEY_SUGGESTIONS (config.cjs:50-63), the other listing all 46 valid
// keys (config.cjs:336-338). This block is the regression guard, so a later
// refactor of cmdConfigSet cannot quietly drop either branch (T-24-13). The
// assertions quote the measured message text, not a paraphrase of it.
// ---------------------------------------------------------------------------

describe('config-set key registration (CONFIG-03)', () => {
  it('rejects a typo naming the suggested key', () => {
    withConfigFixture({}, (root) => {
      const r = runTools(root, ['config-set', 'workflow.nyquist_validation_enabled', 'true']);
      assert.notEqual(r.status, 0, 'a typo must be an error, never a silent no-op');
      assert.match(r.stderr, /Unknown config key/);
      assert.match(
        r.stderr,
        /Did you mean workflow\.nyquist_validation\?/,
        'the suggestion branch must name the key the operator meant',
      );
    });
  });

  it('rejects an unregistered key listing the valid set', () => {
    withConfigFixture({}, (root) => {
      const r = runTools(root, ['config-set', 'totally.bogus.key', 'true']);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /Unknown config key: "totally\.bogus\.key"/);
      assert.match(
        r.stderr,
        /agent_skills\.<agent-type>/,
        'the general branch lists the whole valid set, wildcard included',
      );
      assert.match(r.stderr, /workflow\.record_gate/, 'and the registered keys themselves');
    });
  });

  it('never writes a rejected key', () => {
    withConfigFixture({}, (root) => {
      const before = readCfgRaw(root);
      runTools(root, ['config-set', 'workflow.nyquist_validation_enabled', 'true']);
      runTools(root, ['config-set', 'totally.bogus.key', 'true']);
      // Byte comparison, not a parsed-object comparison: the point is that the
      // file was not rewritten at all, not merely that it parses the same.
      assert.equal(readCfgRaw(root), before, 'a rejected key leaves config.json untouched');
    });
  });

  it('still accepts a registered key, so the guard is not a rubber stamp', () => {
    withConfigFixture({}, (root) => {
      const r = runTools(root, ['config-set', 'workflow.record_gate', 'false']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readCfg(root).workflow.record_gate, false);
    });
  });

  it('accepts the agent_skills wildcard through isValidConfigKey but not through the literal set', () => {
    // config.cjs exports VALID_CONFIG_KEYS but not isValidConfigKey, so the
    // wildcard half is asserted through the shipped path that calls it
    // (cmdConfigSet -> isValidConfigKey, config.cjs:336) rather than by
    // reaching for a function that is not on the module's surface.
    //
    // The asymmetry is load-bearing for plan 24-05: the D-05 resolve contract
    // uses the literal Set, while config-set keeps isValidConfigKey, because
    // agent_skills.<anything> is an unbounded key space with no possible
    // hardcoded default.
    assert.equal(
      CONFIG.VALID_CONFIG_KEYS.has('agent_skills.donny-planner'),
      false,
      'the literal set cannot enumerate an unbounded key space',
    );
    withConfigFixture({}, (root) => {
      const r = runTools(root, ['config-set', 'agent_skills.donny-planner', 'some-skill']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readCfg(root).agent_skills['donny-planner'], 'some-skill');
    });
  });
});

// ---------------------------------------------------------------------------
// The scaffold itself. These are cheap, and they are what keeps the rest of the
// phase honest: every DONNY_HOME test from plan 24-04 onward is only as good as
// the fixture builders and the hermetic default underneath it.
// ---------------------------------------------------------------------------

describe('Phase 24 test scaffold', () => {
  it('buildGlobalDefaults produces a directory with no defaults.json when passed null', () => {
    const home = buildGlobalDefaults(null);
    try {
      assert.ok(fs.existsSync(home), 'the directory exists even with no file in it');
      assert.equal(fs.existsSync(join(home, 'defaults.json')), false);
    } finally {
      cleanupFixture(home);
    }
  });

  it('buildGlobalDefaults writes an object and buildRawGlobalDefaults writes raw bytes', () => {
    const empty = buildGlobalDefaults({});
    const populated = buildGlobalDefaults({ workflow: { record_gate: false } });
    const malformed = buildRawGlobalDefaults('{ not json');
    try {
      assert.deepEqual(JSON.parse(fs.readFileSync(join(empty, 'defaults.json'), 'utf-8')), {});
      assert.equal(
        JSON.parse(fs.readFileSync(join(populated, 'defaults.json'), 'utf-8')).workflow.record_gate,
        false,
      );
      assert.throws(
        () => JSON.parse(fs.readFileSync(join(malformed, 'defaults.json'), 'utf-8')),
        'the D-04 malformed case must actually fail to parse',
      );
    } finally {
      cleanupFixture(empty);
      cleanupFixture(populated);
      cleanupFixture(malformed);
    }
  });

  it('defaults every child process to a hermetic DONNY_HOME, not the operator real one', () => {
    // T-24-54. Once plan 24-06 makes loadConfig resolve the global layer, a
    // suite that let children read ~/.donny/defaults.json would depend on
    // unmanaged machine state, and plan 24-09 populates that exact file across
    // a checkpoint that asks the operator to run npm test.
    assert.ok(HERMETIC_DONNY_HOME.startsWith(tmpdir()), 'it lives in the OS temp dir');
    assert.ok(fs.existsSync(HERMETIC_DONNY_HOME), 'created at module load');
    assert.equal(
      fs.existsSync(join(HERMETIC_DONNY_HOME, 'defaults.json')),
      false,
      'and it is empty, so a child reading it sees no global layer',
    );
  });
});

// ---------------------------------------------------------------------------
// The DONNY_HOME override (D-15), plan 24-04 task 1.
//
// The override governs the WHOLE ~/.donny directory, not only defaults.json:
// brave_api_key, firecrawl_api_key and exa_api_key resolve through it too. A
// test that redirected only defaults.json would still leave config.cjs and
// init.cjs reading the operator's real key files, so config-new-project would
// stay environment-dependent. Tests 4 and 5 are what pin that decision.
//
// getDonnyHome reads process.env on every call, so no module-cache reset is
// needed; each test restores the previous value in a finally.
//
// verify-gate.test.js:2188-2202 sets HOME and never DONNY_HOME, so it exercises
// the homedir() fallback. It is deliberately not modified; the full-suite run is
// what proves it still passes.
// ---------------------------------------------------------------------------

/** Set DONNY_HOME (undefined deletes it), run fn, restore the previous state. */
const withDonnyHomeEnv = (value, fn) => {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'DONNY_HOME');
  const previous = process.env.DONNY_HOME;
  try {
    if (value === undefined) delete process.env.DONNY_HOME;
    else process.env.DONNY_HOME = value;
    return fn();
  } finally {
    if (had) process.env.DONNY_HOME = previous;
    else delete process.env.DONNY_HOME;
  }
};

/** Clear the three API-key env vars in a child, so only $DONNY_HOME decides. */
const NO_API_KEYS = {
  BRAVE_API_KEY: undefined,
  FIRECRAWL_API_KEY: undefined,
  EXA_API_KEY: undefined,
};

describe('DONNY_HOME override (D-15)', () => {
  it('returns the override path verbatim', () => {
    const home = buildGlobalDefaults(null);
    try {
      withDonnyHomeEnv(home, () => {
        assert.equal(CORE.getDonnyHome(), home);
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('falls back to ~/.donny when DONNY_HOME is unset', () => {
    withDonnyHomeEnv(undefined, () => {
      assert.equal(CORE.getDonnyHome(), join(homedir(), '.donny'));
    });
  });

  it('ignores an empty or whitespace-only override (T-24-14)', () => {
    // path.join('', 'defaults.json') resolves relative to the CURRENT WORKING
    // DIRECTORY, so honouring an empty override would let a defaults.json
    // committed into a project act as the machine-wide global layer.
    for (const bad of ['', '   ', '\t']) {
      withDonnyHomeEnv(bad, () => {
        assert.equal(
          CORE.getDonnyHome(),
          join(homedir(), '.donny'),
          `DONNY_HOME=${JSON.stringify(bad)} must fall back, never resolve relative to cwd`,
        );
      });
    }
  });

  it('moves API-key detection with the override, not only defaults.json', () => {
    const home = buildGlobalDefaults(null);
    fs.writeFileSync(join(home, 'brave_api_key'), 'x', 'utf-8');
    try {
      withConfigFixture(null, (root) => {
        const r = runTools(root, ['config-new-project', '{}'], { DONNY_HOME: home, ...NO_API_KEYS });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(
          readCfg(root).brave_search,
          true,
          'a key file under $DONNY_HOME must be the one config-new-project reads',
        );
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('sees no API key at all when the override directory is empty', () => {
    const home = buildGlobalDefaults(null);
    try {
      withConfigFixture(null, (root) => {
        const r = runTools(root, ['config-new-project', '{}'], { DONNY_HOME: home, ...NO_API_KEYS });
        assert.equal(r.status, 0, r.stderr);
        const cfg = readCfg(root);
        assert.equal(cfg.brave_search, false, 'nothing may leak from the operator real ~/.donny');
        assert.equal(cfg.firecrawl, false);
        assert.equal(cfg.exa_search, false);
      });
    } finally {
      cleanupFixture(home);
    }
  });
});
