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
import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { configGetIdiom, HERMETIC_DONNY_HOME, ROOT, runTools, withConfigFixture } from './helpers/cli.mjs';
import { buildGlobalDefaults, buildPlanningFixture, buildRawGlobalDefaults, cleanupFixture } from './helpers/planning-fixture.mjs';

const require = createRequire(import.meta.url);
const CONFIG = require(resolve(ROOT, 'packages/donny/bin/lib/config.cjs'));
const CORE = require(resolve(ROOT, 'packages/donny/bin/lib/core.cjs'));

const readCfgRaw = (root) => fs.readFileSync(join(root, '.planning', 'config.json'), 'utf-8');
const readCfg = (root) => JSON.parse(readCfgRaw(root));

// The pre-change baseline lives in the operator's claudecodeoptimized repo.
// donnyclaude ships publicly, so the test reading it skips when it is absent,
// the same way verify-gate.test.js:27-33 guards its Phase 19 fixtures.
const CCO_ROOT = '/Users/d0nmega/Developer/claudecodeoptimized';
const CCO_BASELINE = resolve(
  CCO_ROOT,
  '.planning/phases/24-global-defaults-that-apply-at-runtime/24-BASELINE-prechange.txt',
);

// ---------------------------------------------------------------------------
// Pin the IN-PROCESS global defaults directory for the whole file (T-24-54).
//
// cli.mjs makes every SUBPROCESS hermetic, but plan 24-06 makes loadConfig read
// $DONNY_HOME/defaults.json and loadConfig is called in-process here. An
// in-process call reads process.env directly, which that default never reaches,
// so without this the suite would silently depend on the operator's real
// ~/.donny/defaults.json - the exact file plan 24-09 populates across a
// checkpoint that asks the operator to run npm test.
//
// Individual tests keep setting DONNY_HOME to their own fixture and restoring it
// in a finally; they now restore to the hermetic value rather than to whatever
// the operator's shell had.
// ---------------------------------------------------------------------------
let savedDonnyHome;
before(() => {
  savedDonnyHome = process.env.DONNY_HOME;
  process.env.DONNY_HOME = HERMETIC_DONNY_HOME;
});
after(() => {
  if (savedDonnyHome === undefined) delete process.env.DONNY_HOME;
  else process.env.DONNY_HOME = savedDonnyHome;
});

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

// ---------------------------------------------------------------------------
// The shared resolver: mergeConfigLayers and loadGlobalDefaults (plan 24-04 task 2).
//
// These are the functions plans 24-05 and 24-06 wire into the other two read
// paths, so they are pinned here rather than only through buildNewProjectConfig.
//
// Every in-process warning test takes a FRESH instance of config.cjs. The
// warn-once flags are module state, so a shared instance would make the second
// test to run silently pass for the wrong reason.
// ---------------------------------------------------------------------------

const CONFIG_CJS = resolve(ROOT, 'packages/donny/bin/lib/config.cjs');

/** A config.cjs instance whose warn-once flags have not been tripped yet. */
const freshConfig = () => {
  delete require.cache[CONFIG_CJS];
  return require(CONFIG_CJS);
};

/** Everything written to stderr while fn runs, as one string. */
const captureStderr = (fn) => {
  const chunks = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return chunks.join('');
};

const countLines = (text, needle) => text.split('\n').filter((l) => l.includes(needle)).length;

/** chmod restricts neither root nor Windows, so a permission test proves nothing there. */
const skipChmod = () => {
  if (process.platform === 'win32') return 'chmod is a no-op on Windows';
  if (process.getuid && process.getuid() === 0) return 'chmod does not restrict root';
  return false;
};

/** Run loadGlobalDefaults against a throwaway DONNY_HOME. */
const loadGlobalFrom = (home, mod) =>
  withDonnyHomeEnv(home, () => (mod || CONFIG).loadGlobalDefaults());

describe('mergeConfigLayers (CONFIG-02, D-02)', () => {
  it('exports the whole resolver surface plan 24-06 requires from core.cjs', () => {
    for (const name of [
      'RESOLVE_EXEMPT', 'GLOBAL_EXEMPT', 'isValidConfigKey', 'hardcodedProjectDefaults',
      'loadGlobalDefaults', 'mergeConfigLayers', 'buildNewProjectConfig',
    ]) {
      assert.ok(name in CONFIG, `config.cjs must export ${name}`);
    }
    assert.ok(CONFIG.RESOLVE_EXEMPT.has('mode'), 'the D-07 exemptions are the measured ones');
    assert.ok(CONFIG.RESOLVE_EXEMPT.has('granularity'));
    assert.ok(CONFIG.RESOLVE_EXEMPT.has('planning.commit_docs'));
    assert.ok(CONFIG.RESOLVE_EXEMPT.has('planning.search_gitignored'));
    assert.ok(CONFIG.GLOBAL_EXEMPT.has('workflow._auto_chain_active'));
  });

  it('mutates none of its three arguments', () => {
    // This function IS a config merge, so the immutability rule is load-bearing
    // rather than stylistic: a mutated `base` would leak across read paths.
    const base = { a: 1, workflow: { x: 1 }, manager: { flags: { plan: 'a' } } };
    const global = { a: 2, workflow: { y: 2 }, manager: { flags: { discuss: 'b' } } };
    const project = { a: 3, workflow: { z: 3 }, manager: { flags: { execute: 'c' } } };
    const snapshots = [base, global, project].map((o) => structuredClone(o));
    const merged = CONFIG.mergeConfigLayers(base, global, project);
    assert.deepEqual(base, snapshots[0], 'base must be untouched');
    assert.deepEqual(global, snapshots[1], 'global must be untouched');
    assert.deepEqual(project, snapshots[2], 'project must be untouched');
    assert.notEqual(merged, base);
    assert.notEqual(merged.workflow, base.workflow, 'the section is a new object too');
  });

  it('lets a project value win over a global value for the same key', () => {
    const merged = CONFIG.mergeConfigLayers(
      { model_profile: 'balanced' },
      { model_profile: 'economy' },
      { model_profile: 'quality' },
    );
    assert.equal(merged.model_profile, 'quality');
  });

  it('falls through to the global value when the project does not set the key', () => {
    const merged = CONFIG.mergeConfigLayers(
      { model_profile: 'balanced' },
      { model_profile: 'economy' },
      {},
    );
    assert.equal(merged.model_profile, 'economy', 'CONFIG-02: an unset project key falls through');
  });

  it('merges a section per key rather than replacing it', () => {
    // The whole point of CONFIG-02. A project that sets one workflow key must
    // not erase every other workflow key the global layer supplied.
    const merged = CONFIG.mergeConfigLayers(
      { workflow: { research: false, record_gate: true, verifier: true } },
      { workflow: { record_gate: false } },
      { workflow: { research: true } },
    );
    assert.equal(merged.workflow.record_gate, false, 'the global value survives');
    assert.equal(merged.workflow.research, true, 'the project value wins');
    assert.equal(merged.workflow.verifier, true, 'the base value survives');
  });

  it('merges git, hooks, agent_skills, planning and manager the same way', () => {
    // planning and manager are the two sections buildNewProjectConfig never
    // spread. Without them a global {"planning":{"commit_docs":false}} against a
    // project {"planning":{"sub_repos":[]}} is replaced, not merged.
    for (const section of ['git', 'hooks', 'agent_skills', 'planning', 'manager']) {
      const merged = CONFIG.mergeConfigLayers(
        { [section]: { fromBase: 'base' } },
        { [section]: { fromGlobal: 'global' } },
        { [section]: { fromProject: 'project' } },
      );
      assert.deepEqual(
        merged[section],
        { fromBase: 'base', fromGlobal: 'global', fromProject: 'project' },
        `${section} must merge per key`,
      );
    }
    const planning = CONFIG.mergeConfigLayers(
      {},
      { planning: { commit_docs: false } },
      { planning: { sub_repos: [] } },
    );
    assert.equal(planning.planning.commit_docs, false, 'the CONFIG-02 case verbatim');
    assert.deepEqual(planning.planning.sub_repos, []);
  });

  it('merges manager.flags one level deeper than any other section', () => {
    const merged = CONFIG.mergeConfigLayers(
      { manager: { flags: { discuss: 'base-d', plan: 'base-p' } } },
      { manager: { flags: { discuss: 'global-d' } } },
      { manager: { flags: { plan: 'project-p' }, other: 'kept' } },
    );
    assert.equal(merged.manager.flags.discuss, 'global-d', 'a project flag must not erase a global one');
    assert.equal(merged.manager.flags.plan, 'project-p');
    assert.equal(merged.manager.other, 'kept');
  });

  it('never invents a section, or a manager.flags, that no layer carried', () => {
    const merged = CONFIG.mergeConfigLayers({ a: 1 }, {}, { b: 2 });
    for (const section of ['git', 'workflow', 'hooks', 'agent_skills', 'planning', 'manager']) {
      assert.equal(section in merged, false, `${section} must not appear from nowhere`);
    }
    const withBareManager = CONFIG.mergeConfigLayers({}, {}, { manager: { active: 'x' } });
    assert.deepEqual(withBareManager.manager, { active: 'x' });
    assert.equal('flags' in withBareManager.manager, false, 'loadConfig manager:{} must stay {}');
  });

  it('ignores a layer whose section is a string or an array (T-24-53)', () => {
    // The global file is hand-edited by design, so config-set's validation does
    // not protect this path. Without the type guard the string's character
    // indices spread into the merged section.
    const fromString = CONFIG.mergeConfigLayers({ git: { a: 1 } }, { git: 'oops' }, { git: { b: 2 } });
    assert.deepEqual(fromString.git, { a: 1, b: 2 });
    assert.equal(JSON.stringify(fromString.git), '{"a":1,"b":2}', 'no numeric character-index keys');
    const fromArray = CONFIG.mergeConfigLayers({ git: { a: 1 } }, { git: ['x'] }, { git: { b: 2 } });
    assert.deepEqual(fromArray.git, { a: 1, b: 2 });
    const nestedFlags = CONFIG.mergeConfigLayers(
      { manager: { flags: { plan: 'p' } } },
      { manager: { flags: 'oops' } },
      {},
    );
    assert.deepEqual(nestedFlags.manager.flags, { plan: 'p' });
  });
});

describe('loadGlobalDefaults (D-04, D-19)', () => {
  it('reads a well-formed global file and returns it as an object', () => {
    const home = buildGlobalDefaults({ model_profile: 'economy', workflow: { record_gate: false } });
    try {
      assert.deepEqual(loadGlobalFrom(home), {
        model_profile: 'economy',
        workflow: { record_gate: false },
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('returns {} and stays silent when there is no file at all', () => {
    const home = buildGlobalDefaults(null);
    try {
      const stderr = captureStderr(() => {
        assert.deepEqual(loadGlobalFrom(home, freshConfig()), {});
      });
      assert.equal(stderr, '', 'an absent optional file is normal, not a warning');
    } finally {
      cleanupFixture(home);
    }
  });

  it('discards a global workflow._auto_chain_active before any merge (T-24-20)', () => {
    // A global true would make every project on the machine believe it is
    // permanently mid-auto-chain, on the unattended paths especially.
    const home = buildGlobalDefaults({
      workflow: { _auto_chain_active: true, record_gate: false },
    });
    try {
      const loaded = loadGlobalFrom(home);
      assert.equal('_auto_chain_active' in loaded.workflow, false, 'GLOBAL_EXEMPT drops it');
      assert.equal(loaded.workflow.record_gate, false, 'its section siblings survive');
      const merged = CONFIG.mergeConfigLayers(
        { workflow: { _auto_chain_active: false } },
        loaded,
        {},
      );
      assert.equal(merged.workflow._auto_chain_active, false, 'the hardcoded default still applies');
    } finally {
      cleanupFixture(home);
    }
  });

  it('warns and continues on a malformed file', () => {
    const home = buildRawGlobalDefaults('{ not json');
    try {
      let result;
      const stderr = captureStderr(() => { result = loadGlobalFrom(home, freshConfig()); });
      assert.deepEqual(result, {}, 'resolution continues on built-in defaults');
      assert.match(stderr, /warning: could not read global defaults/);
      assert.ok(stderr.includes(join(home, 'defaults.json')), 'the message names the file');
    } finally {
      cleanupFixture(home);
    }
  });

  it('warns once per process, not once per call', () => {
    const home = buildRawGlobalDefaults('{ not json');
    try {
      const mod = freshConfig();
      const stderr = captureStderr(() => {
        loadGlobalFrom(home, mod);
        loadGlobalFrom(home, mod);
        loadGlobalFrom(home, mod);
      });
      assert.equal(
        countLines(stderr, 'could not read global defaults'),
        1,
        'three resolutions, one message: warnOnce is what makes D-04 bearable',
      );
    } finally {
      cleanupFixture(home);
    }
  });

  it('rejects a JSON array and a bare null with the not-an-object message', () => {
    for (const raw of ['[1, 2, 3]', 'null', '"a string"', '42']) {
      const home = buildRawGlobalDefaults(raw);
      try {
        let result;
        const stderr = captureStderr(() => { result = loadGlobalFrom(home, freshConfig()); });
        assert.deepEqual(result, {}, `${raw} must be rejected wholesale, never merged`);
        assert.match(stderr, /is not a JSON object/, `${raw} must warn`);
      } finally {
        cleanupFixture(home);
      }
    }
  });

  it('warns and continues when the file exists but cannot be read', { skip: skipChmod() }, () => {
    const home = buildGlobalDefaults({ model_profile: 'economy' });
    const file = join(home, 'defaults.json');
    try {
      fs.chmodSync(file, 0o000);
      let result;
      const stderr = captureStderr(() => { result = loadGlobalFrom(home, freshConfig()); });
      assert.deepEqual(result, {}, 'an unreadable file is not an engine outage');
      assert.match(stderr, /warning: could not read global defaults/);
    } finally {
      try { fs.chmodSync(file, 0o644); } catch { /* already gone */ }
      cleanupFixture(home);
    }
  });

  it('warns when the depth migration cannot be written back (C-4)', { skip: skipChmod() }, () => {
    // The second swallow. A read-only global file failed to migrate forever, on
    // every invocation, with no signal at all.
    const home = buildGlobalDefaults({ depth: 'quick' });
    const file = join(home, 'defaults.json');
    try {
      fs.chmodSync(file, 0o444);
      let result;
      const stderr = captureStderr(() => { result = loadGlobalFrom(home, freshConfig()); });
      assert.equal(result.granularity, 'coarse', 'the in-memory migration still happens');
      assert.equal('depth' in result, false);
      assert.match(stderr, /warning: could not write the depth to granularity migration/);
      assert.match(stderr, /retried on the next run/);
    } finally {
      try { fs.chmodSync(file, 0o644); } catch { /* already gone */ }
      cleanupFixture(home);
    }
  });

  it('migrates depth to granularity and writes it back when it can', () => {
    const home = buildGlobalDefaults({ depth: 'comprehensive' });
    try {
      const result = loadGlobalFrom(home);
      assert.equal(result.granularity, 'fine');
      const onDisk = JSON.parse(fs.readFileSync(join(home, 'defaults.json'), 'utf-8'));
      assert.equal(onDisk.granularity, 'fine');
      assert.equal('depth' in onDisk, false);
    } finally {
      cleanupFixture(home);
    }
  });

  it('drops __proto__ so a hostile file cannot pollute Object.prototype (T-24-17)', () => {
    const home = buildRawGlobalDefaults('{"__proto__": {"polluted": true}, "model_profile": "economy"}');
    try {
      const loaded = loadGlobalFrom(home);
      CONFIG.mergeConfigLayers({}, loaded, {});
      assert.equal({}.polluted, undefined, 'Object.prototype must be clean');
      assert.equal(loaded.model_profile, 'economy', 'the rest of the file still loads');
    } finally {
      cleanupFixture(home);
    }
  });

  it('lets a malformed file through config-new-project as exit 0 with one warning', () => {
    const home = buildRawGlobalDefaults('{ not json');
    try {
      withConfigFixture(null, (root) => {
        const r = runTools(root, ['config-new-project', '{}'], { DONNY_HOME: home, ...NO_API_KEYS });
        assert.equal(r.status, 0, 'a broken optional file must never be a total engine outage');
        assert.equal(countLines(r.stderr, 'could not read global defaults'), 1);
        assert.equal(readCfg(root).workflow.record_gate, true, 'built-in defaults still applied');
      });
    } finally {
      cleanupFixture(home);
    }
  });
});

// ---------------------------------------------------------------------------
// The no-regression target for the extraction. Captured from the shipped code
// before mergeConfigLayers existed, with the three API-key env vars cleared and
// DONNY_HOME pointing at a directory whose defaults.json is {}. If the merge
// changed key order, dropped a key, or grew one, this is what says so.
// ---------------------------------------------------------------------------

const NEW_PROJECT_CHOICES = JSON.stringify({
  mode: 'yolo',
  granularity: 'coarse',
  parallelization: true,
  commit_docs: true,
  model_profile: 'quality',
  workflow: {
    research: true,
    plan_check: true,
    verifier: true,
    nyquist_validation: true,
    auto_advance: true,
  },
});

const NEW_PROJECT_EXPECTED = "{\n  \"model_profile\": \"quality\",\n  \"commit_docs\": true,\n  \"parallelization\": true,\n  \"search_gitignored\": false,\n  \"brave_search\": false,\n  \"firecrawl\": false,\n  \"exa_search\": false,\n  \"git\": {\n    \"branching_strategy\": \"none\",\n    \"phase_branch_template\": \"donny/phase-{phase}-{slug}\",\n    \"milestone_branch_template\": \"donny/{milestone}-{slug}\",\n    \"quick_branch_template\": null\n  },\n  \"workflow\": {\n    \"research\": true,\n    \"browser_research\": true,\n    \"plan_check\": true,\n    \"verifier\": true,\n    \"nyquist_validation\": true,\n    \"auto_advance\": true,\n    \"node_repair\": true,\n    \"node_repair_budget\": 2,\n    \"max_replan_iterations\": 2,\n    \"ui_phase\": true,\n    \"ui_safety_gate\": true,\n    \"ui_review\": true,\n    \"security_enforcement\": true,\n    \"security_asvs_level\": 1,\n    \"security_block_on\": \"high\",\n    \"record_gate\": true,\n    \"text_mode\": false,\n    \"research_before_questions\": false,\n    \"discuss_mode\": \"discuss\",\n    \"skip_discuss\": false\n  },\n  \"hooks\": {\n    \"context_warnings\": true\n  },\n  \"project_code\": null,\n  \"phase_naming\": \"sequential\",\n  \"agent_skills\": {},\n  \"mode\": \"yolo\",\n  \"granularity\": \"coarse\"\n}";

describe('config-new-project output is unchanged by the extraction', () => {
  it('is byte-identical to the pre-extraction capture for the same inputs', () => {
    const home = buildGlobalDefaults({});
    try {
      withConfigFixture(null, (root) => {
        const r = runTools(root, ['config-new-project', NEW_PROJECT_CHOICES], {
          DONNY_HOME: home,
          ...NO_API_KEYS,
        });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(readCfgRaw(root), NEW_PROJECT_EXPECTED);
      });
    } finally {
      cleanupFixture(home);
    }
  });
});

// ---------------------------------------------------------------------------
// configGetDefaults, the D-07 resolution-layer table (plan 24-05 task 1).
//
// hardcodedProjectDefaults() is the layer /donny-init MATERIALIZES into a new
// project's config.json. configGetDefaults() is a different layer: the one
// config-get RESOLVES through. It adds the eight keys that had no hardcoded
// default anywhere in the engine, plus the two loadConfig-only keys, so the D-05
// contract has no hole on a registered key.
//
// Every in-process assertion runs with DONNY_HOME pinned at the hermetic directory
// and the three API-key env vars cleared, because hardcodedProjectDefaults() reads
// all four (config.cjs:282-285) and BRAVE_API_KEY is set on this machine.
// ---------------------------------------------------------------------------

/** Pin DONNY_HOME at the hermetic dir and clear the API-key env vars for one call. */
const withHermeticEnv = (fn) => {
  const keys = ['BRAVE_API_KEY', 'FIRECRAWL_API_KEY', 'EXA_API_KEY'];
  const saved = keys.map((k) => [k, Object.prototype.hasOwnProperty.call(process.env, k), process.env[k]]);
  try {
    for (const k of keys) delete process.env[k];
    return withDonnyHomeEnv(HERMETIC_DONNY_HOME, fn);
  } finally {
    for (const [k, had, v] of saved) {
      if (had) process.env[k] = v;
      else delete process.env[k];
    }
  }
};

/** Resolve a dotted key path against an object; undefined when any hop is missing. */
const dotted = (obj, keyPath) => keyPath.split('.').reduce(
  (cur, k) => (cur === null || typeof cur !== 'object' ? undefined : cur[k]),
  obj,
);

describe('configGetDefaults, the D-07 table', () => {
  it('registers context_window, so a global value can take effect (D-18)', () => {
    assert.equal(
      CONFIG.VALID_CONFIG_KEYS.size,
      51,
      'Phase 24 left 47 registered keys, of which context_window was the 47th (read via ' +
        'config-get at plan-phase.md:30 and execute-phase.md:84); Phase 25 added the three ' +
        'workflow.codex_* keys. The size is a canary: a key added without a test lands here.',
    );
    assert.ok(CONFIG.VALID_CONFIG_KEYS.has('context_window'));
  });

  it('accepts config-set context_window and lands it at the top level', () => {
    withConfigFixture({}, (root) => {
      const r = runTools(root, ['config-set', 'context_window', '1000000']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        readCfg(root).context_window,
        1000000,
        'loadConfig reads context_window at the top level, never nested',
      );
    });
  });

  it('has a value for every allowlisted key except the four deliberate exemptions', () => {
    withHermeticEnv(() => {
      const defaults = CONFIG.configGetDefaults();
      const missing = [...CONFIG.VALID_CONFIG_KEYS]
        .filter((k) => !CONFIG.RESOLVE_EXEMPT.has(k))
        .filter((k) => dotted(defaults, k) === undefined);
      assert.deepEqual(
        missing,
        [],
        'D-05 exits 1 on a registered key with no default; add it to configGetDefaults or to RESOLVE_EXEMPT with a reason',
      );
    });
  });

  it('defaults git.base_branch to bare null, never to a quoted main', () => {
    withHermeticEnv(() => {
      const defaults = CONFIG.configGetDefaults();
      assert.equal(
        defaults.git.base_branch,
        null,
        'ship.md:32 and complete-milestone.md:555 read this WITHOUT --raw, so a string default emits with quote characters',
      );
      assert.notEqual(defaults.git.base_branch, 'main');
      assert.notEqual(defaults.git.base_branch, '');
    });
  });

  it('gives the three manager.flags the empty string sanitizeFlags already coerces to', () => {
    withHermeticEnv(() => {
      const flags = CONFIG.configGetDefaults().manager.flags;
      assert.deepEqual(
        flags,
        { discuss: '', plan: '', execute: '' },
        'these three flow toward a shell command line; the regex allowlist in sanitizeFlags must keep doing the work',
      );
    });
  });

  it('carries the two loadConfig-only keys buildNewProjectConfig never materializes', () => {
    withHermeticEnv(() => {
      const defaults = CONFIG.configGetDefaults();
      assert.equal(defaults.context_window, 200000, "loadConfig's value (core.cjs:242)");
      assert.equal(defaults.response_language, null, "loadConfig's value (core.cjs:364)");
      assert.equal(defaults.workflow.subagent_timeout, 300000, "loadConfig's value (core.cjs:360)");
      assert.equal(defaults.workflow.use_worktrees, true, 'the literal at all 3 read sites');
      assert.equal(defaults.workflow._auto_chain_active, false, 'the literal at all 7 read sites');
    });
  });

  it('leaves the four exemptions out of the data, not only out of a comment', () => {
    withHermeticEnv(() => {
      const defaults = CONFIG.configGetDefaults();
      assert.equal('mode' in defaults, false, 'zero read sites, no shell literal to match');
      assert.equal('granularity' in defaults, false, 'a default would make the depth migration a no-op');
      assert.equal(
        'planning' in defaults,
        false,
        "planning.commit_docs' real default is COMPUTED from isGitIgnored, not constant (D-20)",
      );
    });
  });

  it('does not change what /donny-init materializes, which is a separate table', () => {
    withHermeticEnv(() => {
      const initLayer = CONFIG.hardcodedProjectDefaults();
      assert.equal('context_window' in initLayer, false, 'D-09 leaves buildNewProjectConfig untouched');
      assert.equal('response_language' in initLayer, false);
      assert.equal('manager' in initLayer, false);
      assert.equal('base_branch' in initLayer.git, false);
      assert.equal('use_worktrees' in initLayer.workflow, false);
      assert.equal('_auto_chain_active' in initLayer.workflow, false);
      assert.equal('subagent_timeout' in initLayer.workflow, false);
    });
  });
});

// ---------------------------------------------------------------------------
// The config-get resolution ladder (plan 24-05 task 2).
//
//   hardcoded defaults <- $DONNY_HOME/defaults.json <- .planning/config.json
//
// D-05 changes the missing-key contract for ALLOWLISTED keys only. Exit 1 survives
// for a key absent from VALID_CONFIG_KEYS, for the four RESOLVE_EXEMPT keys, and for
// an unreadable project config. The unbounded agent_skills.<type> space stays on the
// exit-1 path on purpose (Pitfall 7 / T-24-23): isValidConfigKey's regex governs
// config-set, and the literal Set governs resolution.
//
// The literal-parity table below is the in-suite mirror of 24-BASELINE-prechange.txt's
// PATH B-prime-normalized column. Fifteen of the sixteen keys workflow prose reads must
// resolve to the EXACT shell literal their read sites already supply, which is what makes
// this contract change a provable no-op. git.base_branch is the one deliberate deviation
// and gets its own guard-equivalence assertion rather than a widened expected column.
// ---------------------------------------------------------------------------

/** The fifteen measured (key, literal) pairs, minus git.base_branch. */
const IDIOM_LITERALS = [
  ['context_window', '200000'],
  ['workflow._auto_chain_active', 'false'],
  ['workflow.auto_advance', 'false'],
  ['workflow.discuss_mode', 'discuss'],
  ['workflow.node_repair', 'true'],
  ['workflow.nyquist_validation', 'true'],
  ['workflow.record_gate', 'true'],
  ['workflow.security_asvs_level', '1'],
  ['workflow.security_block_on', 'high'],
  ['workflow.security_enforcement', 'true'],
  ['workflow.skip_discuss', 'false'],
  ['workflow.ui_phase', 'true'],
  ['workflow.ui_review', 'true'],
  ['workflow.ui_safety_gate', 'true'],
  ['workflow.use_worktrees', 'true'],
];

describe('config-get resolution ladder (CONFIG-01, D-05, D-07)', () => {
  it('resolves a registered key the project never set, instead of exiting 1', () => {
    withConfigFixture({ workflow: { verifier: true } }, (root) => {
      const r = runTools(root, ['config-get', 'workflow.record_gate', '--raw']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.trim(), 'true');
    });
  });

  it('still exits non-zero on a key absent from the allowlist', () => {
    withConfigFixture({ workflow: { verifier: true } }, (root) => {
      const r = runTools(root, ['config-get', 'totally.bogus.key', '--raw']);
      assert.notEqual(r.status, 0, 'D-05 narrowed the exit-1 path, it did not remove it');
    });
  });

  it('still exits non-zero on an exempt key, so the documented hole is asserted', () => {
    withConfigFixture({}, (root) => {
      const r = runTools(root, ['config-get', 'mode', '--raw']);
      assert.notEqual(r.status, 0, 'mode is in RESOLVE_EXEMPT: zero read sites, no literal to match');
      const g = runTools(root, ['config-get', 'granularity', '--raw']);
      assert.notEqual(g.status, 0, 'a granularity default would make the depth migration a no-op');
    });
  });

  it('still exits non-zero on the unbounded agent_skills key space (T-24-23)', () => {
    withConfigFixture({}, (root) => {
      const r = runTools(root, ['config-get', 'agent_skills.donny-planner', '--raw']);
      assert.notEqual(
        r.status,
        0,
        'the resolve contract gates on VALID_CONFIG_KEYS.has, never on isValidConfigKey regex',
      );
    });
  });

  it('reaches config-get with a global value in a project that never set the key (CONFIG-01)', () => {
    const home = buildGlobalDefaults({ workflow: { record_gate: false } });
    try {
      withConfigFixture({ workflow: { verifier: true } }, (root) => {
        const r = runTools(root, ['config-get', 'workflow.record_gate', '--raw'], { DONNY_HOME: home });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout.trim(), 'false', 'the global layer beats the hardcoded default');
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('leaves .planning/config.json byte-identical while resolving a global value', () => {
    const home = buildGlobalDefaults({ workflow: { record_gate: false } });
    try {
      withConfigFixture({ workflow: { verifier: true } }, (root) => {
        const before = readCfgRaw(root);
        const r = runTools(root, ['config-get', 'workflow.record_gate', '--raw'], { DONNY_HOME: home });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(
          readCfgRaw(root),
          before,
          'resolution is a READ; a global default must never be materialized into the project file',
        );
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('lets a project value beat the global one (CONFIG-02)', () => {
    const home = buildGlobalDefaults({ workflow: { record_gate: false } });
    try {
      withConfigFixture({ workflow: { record_gate: true } }, (root) => {
        const r = runTools(root, ['config-get', 'workflow.record_gate', '--raw'], { DONNY_HOME: home });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout.trim(), 'true', 'the project layer is authoritative');
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('resolves with no config.json at all, but still errors there for an unregistered key', () => {
    withConfigFixture(null, (root) => {
      const ok = runTools(root, ['config-get', 'workflow.record_gate', '--raw']);
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(ok.stdout.trim(), 'true');

      const bad = runTools(root, ['config-get', 'totally.bogus.key', '--raw']);
      assert.notEqual(bad.status, 0);
      assert.match(
        bad.stderr,
        /No config\.json found at/,
        'the file-missing error is narrowed to non-resolvable keys, not deleted',
      );
    });
  });

  it('resolves fifteen of the sixteen read keys to their exact shell literal (D-07)', () => {
    const home = buildGlobalDefaults(null);
    try {
      withConfigFixture({}, (root) => {
        for (const [key, literal] of IDIOM_LITERALS) {
          assert.equal(
            configGetIdiom(root, key, literal, { DONNY_HOME: home }),
            literal,
            `${key} must resolve to the literal its read sites already supply, or D-05 is a behavior change`,
          );
        }
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('git.base_branch preserves behavior through its read sites guard, not through string equality', () => {
    withConfigFixture({}, (root) => {
      const home = buildGlobalDefaults(null);
      try {
        const v = configGetIdiom(root, 'git.base_branch', '', { DONNY_HOME: home });
        // ship.md:33 and complete-milestone.md:556 both guard with
        //   [ -z "$BASE_BRANCH" ] || [ "$BASE_BRANCH" = "null" ]
        // so "" and null take the identical git symbolic-ref origin/HEAD branch.
        assert.ok(
          v === '' || v === 'null',
          `git.base_branch resolved to ${JSON.stringify(v)}, which neither shell guard catches`,
        );
      } finally {
        cleanupFixture(home);
      }
    });
  });

  it('keeps output()s quoting exactly as it was, at the two sites a shell compares (Pitfall 2 and 3)', () => {
    withConfigFixture({}, (root) => {
      const s = runTools(root, ['config-get', 'workflow.discuss_mode']);
      assert.equal(s.status, 0, s.stderr);
      assert.equal(s.stdout.trim(), '"discuss"', 'a string prints its JSON form without --raw, quotes included');

      const b = runTools(root, ['config-get', 'git.base_branch']);
      assert.equal(b.status, 0, b.stderr);
      assert.equal(
        b.stdout.trim(),
        'null',
        'null prints bare in BOTH modes, which is why base_branch is null and never the string main',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// loadConfig's resolution ladder, plan 24-06 task 1.
//
// The third and last consumer of the shared merge. loadConfig serves 25 call
// sites across init.cjs, commands.cjs, phase.cjs, docs.cjs, state.cjs, verify.cjs
// and core.cjs, and had never read $DONNY_HOME/defaults.json. Until this block
// passed, CONFIG-01 held on the config-get path and did nothing at all in Node.
//
// Two placements are load-bearing, and both are asserted here rather than
// inspected:
//
//   1. The merge goes into `parsed`, in CONFIG-FILE shape, because loadConfig
//      RENAMES as it flattens (workflow.plan_check -> plan_checker,
//      git.branching_strategy -> branching_strategy). Merging into the returned
//      object would need a second default table keyed by the flattened names,
//      which is the duplication D-03 refuses. Test 3 is what pins the nested
//      alias path.
//   2. The merge goes AFTER the try, and so after both write-backs loadConfig
//      performs: the depth -> granularity migration (core.cjs:250-254) and the
//      sub_repos sync (:256-289). A merge before them would materialize every
//      global value into .planning/config.json on a routine read, pinning the
//      project against the global layer forever and breaking criterion 1, which
//      is proven by that file being byte-unchanged. Tests 4 and 7 hold the
//      ordering in place (T-24-29).
// ---------------------------------------------------------------------------

describe('loadConfig resolution ladder (CONFIG-01, CONFIG-02, Pitfall 6)', () => {
  it('reaches loadConfig with a global value the project never set (CONFIG-01)', () => {
    const home = buildGlobalDefaults({ model_profile: 'budget' });
    try {
      withConfigFixture({ workflow: { verifier: true } }, (root) => {
        withDonnyHomeEnv(home, () => {
          assert.equal(
            CORE.loadConfig(root).model_profile,
            'budget',
            'the global layer must beat the hardcoded balanced',
          );
        });
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('lets the project value win over the global one (CONFIG-02)', () => {
    const home = buildGlobalDefaults({ model_profile: 'budget' });
    try {
      withConfigFixture({ model_profile: 'quality' }, (root) => {
        withDonnyHomeEnv(home, () => {
          assert.equal(CORE.loadConfig(root).model_profile, 'quality');
        });
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('merges a section per key rather than replacing it, on the nested alias path', () => {
    // The project sets workflow.verifier and nothing else. Replacing the section
    // wholesale would erase the global workflow.research, which is the direct
    // CONFIG-02 violation MERGE_SECTIONS exists to prevent.
    const home = buildGlobalDefaults({ workflow: { research: false } });
    try {
      withConfigFixture({ workflow: { verifier: false } }, (root) => {
        withDonnyHomeEnv(home, () => {
          const c = CORE.loadConfig(root);
          assert.equal(c.research, false, 'the global workflow key survives the project section');
          assert.equal(c.verifier, false, 'and the project key is still applied');
        });
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('leaves .planning/config.json byte-identical while resolving a global value', () => {
    // The load-bearing one. loadConfig WRITES this file for two migrations, so a
    // merge placed before those writes would persist the whole global layer into
    // the project on a routine read. Compare the raw text, not a parsed object.
    const home = buildGlobalDefaults({
      model_profile: 'budget',
      workflow: { research: false, auto_advance: true },
      git: { branching_strategy: 'phase' },
    });
    try {
      withConfigFixture({ workflow: { verifier: true } }, (root) => {
        const before = readCfgRaw(root);
        withDonnyHomeEnv(home, () => {
          assert.equal(CORE.loadConfig(root).model_profile, 'budget', 'the resolution did happen');
        });
        assert.equal(readCfgRaw(root), before, 'a resolution must never write the global layer into the project');
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('applies the global layer to a project with no config.json at all (Pitfall 6)', () => {
    // core.cjs:366-368 used to be a whole-body catch, so a project with no
    // config.json returned the bare hardcoded table and the global layer was lost
    // exactly where an operator would most expect it to apply.
    const home = buildGlobalDefaults({ model_profile: 'budget' });
    try {
      withConfigFixture(null, (root) => {
        withDonnyHomeEnv(home, () => {
          assert.equal(CORE.loadConfig(root).model_profile, 'budget');
        });
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('returns exactly the pre-change bare default table with no config and no global', () => {
    // Criterion 4 at its narrowest: the one path that used to be the whole-body
    // catch must still return the 24-key `defaults` literal, byte for byte. The
    // four keys named below exist only on the try path, and that asymmetry is
    // pre-existing; every consumer uses optional chaining.
    const home = buildGlobalDefaults(null);
    try {
      withConfigFixture(null, (root) => {
        withDonnyHomeEnv(home, () => {
          const c = CORE.loadConfig(root);
          assert.equal(c.model_profile, 'balanced', 'the hardcoded default, not a global one');
          for (const k of ['manager', 'agent_skills', 'model_overrides', 'response_language']) {
            assert.equal(k in c, false, `${k} is absent from the bare default table and must stay absent`);
          }
          assert.equal(Object.keys(c).length, 24, 'the defaults literal has 24 keys; the flattened return has 28');
        });
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('still migrates depth to granularity in the file, carrying no global key into it', () => {
    // Test 4's harder sibling: the write-back must still happen, and must still
    // write only the project's own contents.
    const home = buildGlobalDefaults({ model_profile: 'budget', workflow: { research: false } });
    try {
      withConfigFixture({ depth: 'comprehensive' }, (root) => {
        withDonnyHomeEnv(home, () => {
          assert.equal(CORE.loadConfig(root).model_profile, 'budget', 'the resolution did happen');
        });
        const after = readCfg(root);
        assert.equal(after.granularity, 'fine', 'the depth migration still writes');
        assert.equal('depth' in after, false, 'and still deletes the deprecated key');
        assert.deepEqual(
          Object.keys(after).sort(),
          ['granularity'],
          'the written file must carry no key that came from the global layer',
        );
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('agrees with config-get on the two keys BOTH read paths serve', () => {
    // context_window (core.cjs:357, plan-phase.md:30, execute-phase.md:84) and
    // workflow.nyquist_validation (core.cjs:348, audit-phase.md:34,
    // audit-milestone.md:152) are read through both paths. A divergence between
    // the two default tables would surface here first.
    const hardcoded = buildGlobalDefaults({});
    const populated = buildGlobalDefaults({
      context_window: 1000000,
      workflow: { nyquist_validation: false },
    });
    try {
      withConfigFixture({}, (root) => {
        for (const [label, home, cw, nyq] of [
          ['hardcoded', hardcoded, 200000, true],
          ['global', populated, 1000000, false],
        ]) {
          const viaLoad = withDonnyHomeEnv(home, () => CORE.loadConfig(root));
          assert.equal(viaLoad.context_window, cw, `${label}: loadConfig context_window`);
          assert.equal(viaLoad.nyquist_validation, nyq, `${label}: loadConfig nyquist_validation`);

          const gotCw = runTools(root, ['config-get', 'context_window', '--raw'], { DONNY_HOME: home });
          assert.equal(gotCw.status, 0, gotCw.stderr);
          assert.equal(gotCw.stdout.trim(), String(cw), `${label}: config-get context_window`);

          const gotNyq = runTools(root, ['config-get', 'workflow.nyquist_validation', '--raw'], { DONNY_HOME: home });
          assert.equal(gotNyq.status, 0, gotNyq.stderr);
          assert.equal(gotNyq.stdout.trim(), String(nyq), `${label}: config-get nyquist_validation`);
        }
      });
    } finally {
      cleanupFixture(hardcoded);
      cleanupFixture(populated);
    }
  });

  it('observes a DONNY_HOME change between calls, with no module cache reset', () => {
    // require('./config.cjs') is cached per process, but loadGlobalDefaults reads
    // the file on every call and getDonnyHome reads process.env on every call.
    // Asserted so a later "optimization" that caches either one is caught here
    // rather than by a test that mysteriously stops isolating.
    const a = buildGlobalDefaults({ model_profile: 'budget' });
    const b = buildGlobalDefaults({ model_profile: 'economy' });
    try {
      withConfigFixture({}, (root) => {
        assert.equal(withDonnyHomeEnv(a, () => CORE.loadConfig(root).model_profile), 'budget');
        assert.equal(withDonnyHomeEnv(b, () => CORE.loadConfig(root).model_profile), 'economy');
        assert.equal(withDonnyHomeEnv(a, () => CORE.loadConfig(root).model_profile), 'budget');
      });
    } finally {
      cleanupFixture(a);
      cleanupFixture(b);
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 4, plan 24-06 task 2: an absent global file and an empty one behave
// exactly as the pre-change engine did.
//
// This mirrors 24-config-snapshot.sh in-suite, so the property is re-checked on
// every npm test rather than only when someone remembers to run the shell script.
//
// Test 3 is the negative control and is not optional. Tests 1, 2 and 5 compare
// two states of the same build, so they would all still pass if the global layer
// were ignored entirely - which is the exact defect the phase exists to remove.
//
// The environment is pinned for the whole block: the three API-key vars because
// hardcodedProjectDefaults reads them (config.cjs:285-288), and DONNY_WORKSTREAM
// because planningDir re-roots .planning/ from it. loadConfig reads none of them,
// but a half-pinned environment is a worse trap than an unpinned one. This is the
// same determinism block 24-config-snapshot.sh applies.
// ---------------------------------------------------------------------------

describe('criterion 4: no global file behaves exactly as before', () => {
  const PINNED = ['BRAVE_API_KEY', 'FIRECRAWL_API_KEY', 'EXA_API_KEY', 'DONNY_WORKSTREAM'];
  const savedPinned = {};
  before(() => {
    for (const k of PINNED) {
      savedPinned[k] = process.env[k];
      delete process.env[k];
    }
  });
  after(() => {
    for (const k of PINNED) {
      if (savedPinned[k] === undefined) delete process.env[k];
      else process.env[k] = savedPinned[k];
    }
  });

  // A realistic project, not an empty one, so the comparison exercises the merge
  // rather than only the defaults.
  const FIXTURE_CONFIG = {
    model_profile: 'quality',
    commit_docs: true,
    git: { branching_strategy: 'none', phase_branch_template: 'donny/phase-{phase}-{slug}' },
    workflow: { research: true, plan_check: true, verifier: true, auto_advance: true },
  };

  /** The sixteen keys workflow prose actually reads, with the literal each site supplies. */
  const READ_KEYS = [
    ['context_window', '200000'],
    ['git.base_branch', ''],
    ['workflow._auto_chain_active', 'false'],
    ['workflow.auto_advance', 'false'],
    ['workflow.discuss_mode', 'discuss'],
    ['workflow.node_repair', 'true'],
    ['workflow.nyquist_validation', 'true'],
    ['workflow.record_gate', 'true'],
    ['workflow.security_asvs_level', '1'],
    ['workflow.security_block_on', 'high'],
    ['workflow.security_enforcement', 'true'],
    ['workflow.skip_discuss', 'false'],
    ['workflow.ui_phase', 'true'],
    ['workflow.ui_review', 'true'],
    ['workflow.ui_safety_gate', 'true'],
    ['workflow.use_worktrees', 'true'],
  ];

  /** Run fn with root, an absent-global home and an empty-global home, then clean up. */
  const withThreeStates = (fn) => {
    const root = buildPlanningFixture({ config: FIXTURE_CONFIG });
    const absent = buildGlobalDefaults(null);
    const empty = buildGlobalDefaults({});
    try {
      return fn({ root, absent, empty });
    } finally {
      cleanupFixture(root);
      cleanupFixture(absent);
      cleanupFixture(empty);
    }
  };

  it('loadConfig is deep-equal between an absent global file and an empty one', () => {
    withThreeStates(({ root, absent, empty }) => {
      const a = withDonnyHomeEnv(absent, () => CORE.loadConfig(root));
      const e = withDonnyHomeEnv(empty, () => CORE.loadConfig(root));
      assert.deepEqual(e, a, 'an empty defaults.json must be indistinguishable from no file at all');
    });
  });

  it('every one of the sixteen read keys resolves identically in both states', () => {
    // An absent-versus-empty comparison within ONE build, so the raw idiom value is
    // the right thing to compare. The normalization in 24-config-snapshot.sh only
    // matters across the pre-change and post-change builds, where git.base_branch
    // moves from "" to null; that comparison is the shell check, not this test.
    withThreeStates(({ root, absent, empty }) => {
      for (const [key, literal] of READ_KEYS) {
        assert.equal(
          configGetIdiom(root, key, literal, { DONNY_HOME: empty }),
          configGetIdiom(root, key, literal, { DONNY_HOME: absent }),
          `${key} drifted between the absent and empty global states`,
        );
      }
    });
  });

  it('a populated global DOES change both results, so the comparison is not vacuous', () => {
    // The negative control (T-24-33). Without it, the two tests above would pass
    // unchanged if the global layer were dropped on the floor entirely.
    //
    // The global carries one key for each read path, because they do not overlap:
    // workflow.record_gate is config-get-only, and workflow.browser_research is one
    // of the 28 keys loadConfig flattens. A control built on record_gate alone would
    // assert nothing about loadConfig, which is the path this plan changed.
    withThreeStates(({ root, absent }) => {
      const populated = buildGlobalDefaults({
        model_profile: 'budget',
        workflow: { record_gate: false, browser_research: false },
      });
      try {
        const base = withDonnyHomeEnv(absent, () => CORE.loadConfig(root));
        const withGlobal = withDonnyHomeEnv(populated, () => CORE.loadConfig(root));
        assert.notDeepEqual(withGlobal, base, 'the global layer must reach loadConfig');
        assert.equal(base.browser_research, true, 'the hardcoded default with no global file');
        assert.equal(withGlobal.browser_research, false, 'and the global value once there is one');
        assert.equal(base.model_profile, 'quality', 'the project value still wins over the global');
        assert.equal(withGlobal.model_profile, 'quality');

        assert.notEqual(
          configGetIdiom(root, 'workflow.record_gate', 'true', { DONNY_HOME: populated }),
          configGetIdiom(root, 'workflow.record_gate', 'true', { DONNY_HOME: absent }),
          'the global layer must reach config-get too',
        );
        assert.equal(configGetIdiom(root, 'workflow.record_gate', 'true', { DONNY_HOME: populated }), 'false');
        assert.equal(configGetIdiom(root, 'workflow.record_gate', 'true', { DONNY_HOME: absent }), 'true');
      } finally {
        cleanupFixture(populated);
      }
    });
  });

  it('an empty defaults.json produces no stderr at all', () => {
    // {} is this machine's actual live state, so a warning there would be noise on
    // every single engine invocation.
    withThreeStates(({ root, empty }) => {
      const r = runTools(root, ['config-get', 'workflow.record_gate', '--raw'], { DONNY_HOME: empty });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stderr, '', 'the operator normal state must be silent');
    });
  });

  it('matches the PATH A section recorded in 24-BASELINE-prechange.txt', {
    skip: fs.existsSync(CCO_BASELINE) ? false : 'baseline artifact not present',
  }, () => {
    const text = fs.readFileSync(CCO_BASELINE, 'utf-8');
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l.startsWith('### PATH A'));
    assert.notEqual(start, -1, 'the baseline must carry a PATH A section');
    let end = start + 1;
    while (end < lines.length && !lines[end].startsWith('### ')) end += 1;
    const recorded = JSON.parse(lines.slice(start + 1, end).join('\n').trim());

    const cfgPath = join(CCO_ROOT, '.planning', 'config.json');
    const md5Before = createHash('md5').update(fs.readFileSync(cfgPath)).digest('hex');

    const empty = buildGlobalDefaults({});
    try {
      const fresh = withDonnyHomeEnv(empty, () => CORE.loadConfig(CCO_ROOT));
      const drifted = [...new Set([...Object.keys(recorded), ...Object.keys(fresh)])].filter(
        (k) => JSON.stringify(recorded[k]) !== JSON.stringify(fresh[k]),
      );
      assert.deepEqual(drifted, [], 'criterion 4 failure: fix loadConfig, never the baseline');
      assert.deepEqual(fresh, recorded);
    } finally {
      cleanupFixture(empty);
    }

    assert.equal(
      createHash('md5').update(fs.readFileSync(cfgPath)).digest('hex'),
      md5Before,
      'resolving against a real project must not write to its config.json (T-24-29)',
    );
  });
});

// ---------------------------------------------------------------------------
// D-10 and D-17: /donny-health --repair must not pin a key the ladder resolves.
//
// Two write-in repairs materialise keys into .planning/config.json, and a key
// written there shadows every global default for that key forever. Before this
// plan, addNyquistKey wrote workflow.nyquist_validation on a warning that fired
// merely because the key was absent, and createConfig / resetConfig wrote a
// thirteen-leaf default table. One routine repair pinned eleven or more keys.
//
// The argv is `validate health [--repair]`, NOT `verify health`. donny-tools.cjs
// dispatches cmdValidateHealth from case 'validate' (:708-720); case 'verify'
// (:513) has no `health` subcommand and errors out. The plan's guess was wrong
// and it said to use the real form.
// ---------------------------------------------------------------------------

/** Every leaf path in a nested object, e.g. { a: { b: 1 } } -> ['a.b']. */
const leaves = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === 'object' && !Array.isArray(v) ? leaves(v, prefix + k + '.') : [prefix + k]);

/**
 * A throwaway project that cmdValidateHealth reports as healthy except for the
 * one finding under test.
 *
 * withConfigFixture is not enough here: a root carrying only .planning/config.json
 * reports status 'broken' on E002/E003/E004, which would drown the W008 signal.
 * The three PROJECT.md sections are the ones Check 2 requires (W001).
 *
 * Pass null for config to get a project with .planning/ and NO config.json, which
 * is the W003 / createConfig case.
 */
const withHealthFixture = (config, fn) => {
  const root = join(
    tmpdir(),
    'donny-health-' + Date.now() + '-' + Math.random().toString(36).slice(2),
  );
  fs.mkdirSync(join(root, '.planning', 'phases'), { recursive: true });
  fs.writeFileSync(
    join(root, '.planning', 'PROJECT.md'),
    '# Fixture\n\n## What This Is\n\nx\n\n## Core Value\n\nx\n\n## Requirements\n\nx\n',
    'utf-8',
  );
  fs.writeFileSync(join(root, '.planning', 'ROADMAP.md'), '# Roadmap\n', 'utf-8');
  fs.writeFileSync(
    join(root, '.planning', 'STATE.md'),
    '---\ncurrent_phase: 1\n---\n\n# State\n\nCurrent Phase: 1\n',
    'utf-8',
  );
  if (config !== null) {
    fs.writeFileSync(
      join(root, '.planning', 'config.json'),
      JSON.stringify(config, null, 2) + '\n',
      'utf-8',
    );
  }
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

/** The state that trips W008: a workflow block present, nyquist_validation absent. */
const W008_CONFIG = { workflow: { verifier: true } };

describe('health repairs must not defeat the global layer (D-10, D-17)', () => {
  it('reports an absent nyquist_validation as information, not a repairable warning', () => {
    withHealthFixture(W008_CONFIG, (root) => {
      const r = runTools(root, ['validate', 'health']);
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);

      const asInfo = out.info.filter((i) => i.code === 'W008');
      assert.equal(asInfo.length, 1, 'W008 must still be REPORTED, just in info');
      assert.equal(asInfo[0].repairable, false, 'absence is correct, so there is nothing to repair');
      assert.deepEqual(
        out.warnings.filter((w) => w.code === 'W008'),
        [],
        'and it must no longer be a warning',
      );
    });
  });

  it('does not degrade the health status when W008 is the only finding', () => {
    withHealthFixture(W008_CONFIG, (root) => {
      const out = JSON.parse(runTools(root, ['validate', 'health']).stdout);
      assert.deepEqual(out.errors, [], 'the fixture must be otherwise clean for this to mean anything');
      assert.deepEqual(out.warnings, []);
      assert.equal(out.status, 'healthy', 'previously reported degraded on this exact project');
      assert.equal(out.repairable_count, 0);
    });
  });

  it('leaves the project config byte-identical under --repair', () => {
    withHealthFixture(W008_CONFIG, (root) => {
      const before = readCfgRaw(root);
      const r = runTools(root, ['validate', 'health', '--repair']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        readCfgRaw(root),
        before,
        'no repair may write nyquist_validation into a project that has not chosen it',
      );
    });
  });

  it('runs no addNyquistKey action and counts W008 as nothing to repair', () => {
    withHealthFixture(W008_CONFIG, (root) => {
      const out = JSON.parse(runTools(root, ['validate', 'health', '--repair']).stdout);
      const actions = (out.repairs_performed || []).map((a) => a.action);
      assert.ok(
        !actions.includes('addNyquistKey'),
        `addNyquistKey must not exist as a repair, got ${JSON.stringify(actions)}`,
      );
      assert.equal(out.repairable_count, 0);
    });
  });

  it('creates a config carrying exactly the seven /donny-init user-choice leaves', () => {
    withHealthFixture(null, (root) => {
      const r = runTools(root, ['validate', 'health', '--repair']);
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.ok(
        (out.repairs_performed || []).some((a) => a.action === 'createConfig' && a.success),
        'the missing-config repair must still run: a project needs some config file',
      );
      // Computed from the written file, so widening the table fails here (T-24-35).
      assert.deepEqual(leaves(readCfg(root)).sort(), [
        'commit_docs',
        'model_profile',
        'parallelization',
        'workflow.nyquist_validation',
        'workflow.plan_check',
        'workflow.research',
        'workflow.verifier',
      ].sort());
    });
  });

  it('writes none of the six engine-default keys the old table pinned', () => {
    withHealthFixture(null, (root) => {
      runTools(root, ['validate', 'health', '--repair']);
      const written = readCfg(root);
      const text = readCfgRaw(root);
      for (const k of [
        'search_gitignored',
        'branching_strategy',
        'phase_branch_template',
        'milestone_branch_template',
        'quick_branch_template',
        'brave_search',
      ]) {
        assert.equal(written[k], undefined, `${k} must not be pinned into the project`);
        assert.ok(!text.includes(k), `${k} must not appear anywhere in the created file`);
      }
    });
  });

  it('leaves the dropped keys resolvable from the global layer after a repair', () => {
    withHealthFixture(null, (root) => {
      runTools(root, ['validate', 'health', '--repair']);
      const populated = buildGlobalDefaults({
        git: { branching_strategy: 'phase' },
        search_gitignored: true,
        brave_search: true,
      });
      try {
        const get = (key) =>
          runTools(root, ['config-get', key, '--raw'], { DONNY_HOME: populated }).stdout.trim();

        // The plan's named assertion. Note it does NOT discriminate on its own:
        // the old table wrote a FLAT branching_strategy, which is not even in
        // VALID_CONFIG_KEYS (config.cjs:29 registers only git.branching_strategy),
        // so the nested global always resolved. Kept because the plan names it.
        assert.equal(get('git.branching_strategy'), 'phase');

        // These two DO discriminate. Both are registered flat keys that the old
        // thirteen-leaf table wrote as false, shadowing the global true.
        assert.equal(get('search_gitignored'), 'true', 'the old repair pinned this to false');
        assert.equal(get('brave_search'), 'true', 'the old repair pinned this to false');
      } finally {
        cleanupFixture(populated);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Plan 24-08: config-get --source, the opt-in provenance flag (D-08, D-11).
//
// The flag names the layer that supplied a value: hardcoded, global or project.
// Its entire safety story is that it is OPT-IN. Without it stdout must stay
// byte-identical for the 43 shell $(...) capture sites 24-07 measured, which is
// what the byte-equality block at the end of this describe asserts and why this
// plan runs last among the code plans (D-21, T-24-40).
//
// The raw form is two tab-separated fields, value then layer, so a shell caller
// can cut -f1 and cut -f2 without a JSON parser. A tab rather than a space
// because git.quick_branch_template and manager.flags.* can hold spaces (T-24-44).
// ---------------------------------------------------------------------------
describe('config-get --source (D-08, D-11)', () => {
  const GLOBAL_FALSE = { workflow: { record_gate: false } };

  // Behavior 1
  it('names the hardcoded layer when neither the global nor the project set the key', () => {
    withConfigFixture({}, (root) => {
      const r = runTools(root, ['config-get', 'workflow.record_gate', '--raw', '--source']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, 'true\thardcoded');
    });
  });

  // Behavior 2
  it('names the global layer when only the global set the key (CONFIG-01)', () => {
    const home = buildGlobalDefaults(GLOBAL_FALSE);
    try {
      withConfigFixture({}, (root) => {
        const r = runTools(root, ['config-get', 'workflow.record_gate', '--raw', '--source'], { DONNY_HOME: home });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout, 'false\tglobal');
      });
    } finally {
      cleanupFixture(home);
    }
  });

  // Behavior 3
  it('names the project layer when the project overrides the global (CONFIG-02)', () => {
    const home = buildGlobalDefaults(GLOBAL_FALSE);
    try {
      withConfigFixture({ workflow: { record_gate: true } }, (root) => {
        const r = runTools(root, ['config-get', 'workflow.record_gate', '--raw', '--source'], { DONNY_HOME: home });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout, 'true\tproject');
      });
    } finally {
      cleanupFixture(home);
    }
  });

  // Behavior 4, the D-11 half: the merged value alone cannot tell these two apart.
  it('flags a project value that merely repeats the global one (D-11)', () => {
    const home = buildGlobalDefaults(GLOBAL_FALSE);
    try {
      withConfigFixture({ workflow: { record_gate: false } }, (root) => {
        const r = runTools(root, ['config-get', 'workflow.record_gate', '--source'], { DONNY_HOME: home });
        assert.equal(r.status, 0, r.stderr);
        const payload = JSON.parse(r.stdout);
        assert.equal(payload.key, 'workflow.record_gate');
        assert.equal(payload.value, false);
        assert.equal(payload.source, 'project');
        assert.equal(payload.redundant_with_global, true, 'removing this project key would change nothing');
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('does not flag a project value that differs from the global one (D-11)', () => {
    const home = buildGlobalDefaults(GLOBAL_FALSE);
    try {
      withConfigFixture({ workflow: { record_gate: true } }, (root) => {
        const r = runTools(root, ['config-get', 'workflow.record_gate', '--source'], { DONNY_HOME: home });
        assert.equal(r.status, 0, r.stderr);
        const payload = JSON.parse(r.stdout);
        assert.equal(payload.source, 'project');
        assert.equal(payload.redundant_with_global, false, 'the project value is doing real work here');
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('never reports redundant_with_global when no global layer exists at all', () => {
    withConfigFixture({ workflow: { record_gate: false } }, (root) => {
      const r = runTools(root, ['config-get', 'workflow.record_gate', '--source']);
      assert.equal(r.status, 0, r.stderr);
      const payload = JSON.parse(r.stdout);
      assert.equal(payload.source, 'project');
      assert.equal(payload.redundant_with_global, false, 'redundancy is against the GLOBAL, not the hardcoded default');
    });
  });

  // Behavior 6: the splice. args[1] must stay the key wherever the flag appeared.
  it('works with the flag placed before the key, proving the argv splice', () => {
    const home = buildGlobalDefaults(GLOBAL_FALSE);
    try {
      withConfigFixture({}, (root) => {
        const after = runTools(root, ['config-get', 'workflow.record_gate', '--source', '--raw'], { DONNY_HOME: home });
        const before = runTools(root, ['config-get', '--source', 'workflow.record_gate', '--raw'], { DONNY_HOME: home });
        assert.equal(after.status, 0, after.stderr);
        assert.equal(before.status, 0, before.stderr);
        assert.equal(before.stdout, 'false\tglobal');
        assert.equal(before.stdout, after.stdout, 'flag position must not change the output');
      });
    } finally {
      cleanupFixture(home);
    }
  });

  // Behavior 7: closes assumption A4 of 24-RESEARCH.md rather than leaving it assumed.
  it('composes with --pick, which parses the JSON form (A4, T-24-42)', () => {
    const home = buildGlobalDefaults(GLOBAL_FALSE);
    try {
      withConfigFixture({}, (root) => {
        const r = runTools(root, ['config-get', 'workflow.record_gate', '--source', '--pick', 'source'], { DONNY_HOME: home });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout, 'global');
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('echoes the tab-separated capture when --source --raw is picked, since it is not JSON (A4)', () => {
    const home = buildGlobalDefaults(GLOBAL_FALSE);
    try {
      withConfigFixture({}, (root) => {
        const r = runTools(root, ['config-get', 'workflow.record_gate', '--source', '--raw', '--pick', 'source'], { DONNY_HOME: home });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout, 'false\tglobal', 'no shipped caller combines them; the fall-through is pinned, not endorsed');
      });
    } finally {
      cleanupFixture(home);
    }
  });

  // Behavior 8: provenance must not widen the resolve contract.
  it('still exits non-zero on a key absent from the allowlist (T-24-41)', () => {
    withConfigFixture({}, (root) => {
      const r = runTools(root, ['config-get', 'totally.bogus.key', '--source', '--raw']);
      assert.notEqual(r.status, 0, '--source is applied after the traversal and after both Key not found errors');
    });
  });

  it('still exits non-zero on an exempt key the project never set (T-24-41)', () => {
    withConfigFixture({}, (root) => {
      const r = runTools(root, ['config-get', 'mode', '--source', '--raw']);
      assert.notEqual(r.status, 0, 'RESOLVE_EXEMPT keys stay on the exit-1 path with the flag on');
    });
  });

  // Behavior 9
  it('reports project for a non-resolvable key the project did set, the only layer that could supply it', () => {
    withConfigFixture({ mode: 'auto' }, (root) => {
      const r = runTools(root, ['config-get', 'mode', '--raw', '--source']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, 'auto\tproject');
    });
  });

  // Behavior 5, the safety test. Byte equality on r.stdout, never on a trimmed
  // value, so a stray newline or tab would fail. output() writes with
  // fs.writeSync(1, ...) and appends nothing (core.cjs:196).
  describe('the default path is byte-identical without the flag (T-24-40)', () => {
    const rows = [
      { key: 'workflow.record_gate', project: {}, raw: true, expected: 'true' },
      { key: 'workflow.record_gate', project: {}, raw: false, expected: 'true' },
      { key: 'workflow.discuss_mode', project: {}, raw: false, expected: '"discuss"' },
      { key: 'git.base_branch', project: {}, raw: false, expected: 'null' },
      { key: 'workflow.record_gate', project: { workflow: { record_gate: false } }, raw: true, expected: 'false' },
    ];

    for (const row of rows) {
      const label = `${row.key}${row.raw ? ' --raw' : ''}${Object.keys(row.project).length ? ' (project set)' : ''}`;
      it(`${label} prints exactly ${JSON.stringify(row.expected)}`, () => {
        withConfigFixture(row.project, (root) => {
          const argv = ['config-get', row.key];
          if (row.raw) argv.push('--raw');
          const r = runTools(root, argv);
          assert.equal(r.status, 0, r.stderr);
          assert.equal(r.stdout, row.expected);
        });
      });
    }

    it('is byte-identical with a populated global layer too, which is the case 43 sites see', () => {
      const home = buildGlobalDefaults(GLOBAL_FALSE);
      try {
        withConfigFixture({}, (root) => {
          assert.equal(runTools(root, ['config-get', 'workflow.record_gate', '--raw'], { DONNY_HOME: home }).stdout, 'false');
          assert.equal(runTools(root, ['config-get', 'workflow.record_gate'], { DONNY_HOME: home }).stdout, 'false');
        });
      } finally {
        cleanupFixture(home);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 25 appends here rather than starting a second config test file: these
// three keys are ordinary members of Phase 24's ladder and the interesting
// assertion (the per-key merge) is the same property CONFIG-02 already pins.
// ---------------------------------------------------------------------------
describe('Phase 25 codex config keys (CONFIG-03, D-05, D-08, D-25)', () => {
  it('workflow.codex_timeout resolves to the hardcoded 300000', () => {
    withConfigFixture({}, (root) => {
      const r = runTools(root, ['config-get', 'workflow.codex_timeout', '--raw']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.trim(), '300000', 'milliseconds, matching workflow.subagent_timeout');
    });
  });

  it('workflow.codex_model resolves to the hardcoded gpt-6-astra', () => {
    withConfigFixture({}, (root) => {
      const r = runTools(root, ['config-get', 'workflow.codex_model', '--raw']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.trim(), 'gpt-6-astra');
    });
  });

  it('workflow.codex_reasoning_effort resolves to the hardcoded high', () => {
    // Not cosmetic. Proof B measured the wire: with the operator's config.toml loaded the
    // request carries reasoning.effort "high", and under --ignore-user-config (D-10,
    // unconditional) it carries "low". So this default is what keeps the reviewer at the
    // effort the operator runs at; an unpinned effort silently drops to the CLI built-in.
    withConfigFixture({}, (root) => {
      const r = runTools(root, ['config-get', 'workflow.codex_reasoning_effort', '--raw']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.trim(), 'high');
    });
  });

  it('a global workflow.codex_timeout beats the hardcoded default and reports its layer', () => {
    const home = buildGlobalDefaults({ workflow: { codex_timeout: 45000 } });
    try {
      withConfigFixture({}, (root) => {
        const r = runTools(root, ['config-get', 'workflow.codex_timeout', '--raw'], { DONNY_HOME: home });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout.trim(), '45000');
        // Tab-separated in raw mode (config.cjs:688), so cut -f2 is the layer.
        const s = runTools(root, ['config-get', 'workflow.codex_timeout', '--source', '--raw'], { DONNY_HOME: home });
        assert.equal(s.status, 0, s.stderr);
        assert.equal(s.stdout.trim(), '45000\tglobal');
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('a project workflow.codex_timeout beats the global one, and an unset sibling falls through', () => {
    // The fall-through half is not decoration. A project value for an UNREGISTERED key
    // still resolves, because cmdConfigGet consults the project layer alone when the key
    // is not resolvable - so the first two assertions pass whether or not the key is
    // registered, and only codex_model reaching the global layer proves the ladder ran.
    const home = buildGlobalDefaults({ workflow: { codex_timeout: 45000, codex_model: 'gpt-6-astra-mini' } });
    try {
      withConfigFixture({ workflow: { codex_timeout: 90000 } }, (root) => {
        const r = runTools(root, ['config-get', 'workflow.codex_timeout', '--raw'], { DONNY_HOME: home });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout.trim(), '90000', 'the project layer is authoritative');
        const s = runTools(root, ['config-get', 'workflow.codex_timeout', '--source', '--raw'], { DONNY_HOME: home });
        assert.equal(s.stdout.trim(), '90000\tproject');
        const m = runTools(root, ['config-get', 'workflow.codex_model', '--source', '--raw'], { DONNY_HOME: home });
        assert.equal(m.status, 0, m.stderr);
        assert.equal(m.stdout.trim(), 'gpt-6-astra-mini\tglobal', 'a key the project never set falls through');
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('the workflow section merges per key, so a global codex_model survives a project workflow key', () => {
    // The load-bearing one. This is why the three keys live under workflow.* and not in a
    // new top-level codex section: MERGE_SECTIONS (config.cjs:215) spreads only the six
    // named sections per key, so a codex.* section would be REPLACED wholesale by the
    // highest layer that defines it - the CONFIG-02 violation the comment at :213 names.
    // If anyone ever moves these keys, this assertion is what fails.
    const home = buildGlobalDefaults({ workflow: { codex_model: 'gpt-6-astra-mini' } });
    try {
      withConfigFixture({ workflow: { record_gate: false } }, (root) => {
        const model = runTools(root, ['config-get', 'workflow.codex_model', '--raw'], { DONNY_HOME: home });
        assert.equal(model.status, 0, model.stderr);
        assert.equal(model.stdout.trim(), 'gpt-6-astra-mini', 'the global workflow key must survive');
        const gate = runTools(root, ['config-get', 'workflow.record_gate', '--raw'], { DONNY_HOME: home });
        assert.equal(gate.status, 0, gate.stderr);
        assert.equal(gate.stdout.trim(), 'false', 'and the project workflow key must survive too');
      });
    } finally {
      cleanupFixture(home);
    }
  });

  it('rejects a transposed codex_timout, naming the registered keys', () => {
    withConfigFixture({}, (root) => {
      const r = runTools(root, ['config-set', 'workflow.codex_timout', '1000']);
      assert.notEqual(r.status, 0, 'a typo must be an error, never a silent no-op');
      assert.match(r.stderr, /Unknown config key: "workflow\.codex_timout"/);
      assert.match(r.stderr, /workflow\.codex_timeout/, 'the valid set names the key the operator meant');
    });
  });

  it('accepts the registered key and round-trips the value', () => {
    withConfigFixture({}, (root) => {
      const set = runTools(root, ['config-set', 'workflow.codex_timeout', '45000']);
      assert.equal(set.status, 0, set.stderr);
      assert.equal(readCfg(root).workflow.codex_timeout, 45000, 'config-set coerces a numeric string');
      const get = runTools(root, ['config-get', 'workflow.codex_timeout', '--raw']);
      assert.equal(get.stdout.trim(), '45000');
    });
  });

  it('prints codex_model with quotes without --raw, bare with it', () => {
    // output() prints JSON.stringify(value, null, 2) without --raw, so a string default
    // emits WITH quotes and a number emits bare. Pinned because a caller reading this key
    // with $(...) has to know which form it gets.
    withConfigFixture({}, (root) => {
      const json = runTools(root, ['config-get', 'workflow.codex_model']);
      assert.equal(json.status, 0, json.stderr);
      assert.equal(json.stdout.trim(), '"gpt-6-astra"');
      const num = runTools(root, ['config-get', 'workflow.codex_timeout']);
      assert.equal(num.stdout.trim(), '300000', 'a number emits bare in both modes');
    });
  });

  it('the three keys are registered, resolvable and not exempt', () => {
    for (const key of ['workflow.codex_timeout', 'workflow.codex_model', 'workflow.codex_reasoning_effort']) {
      assert.ok(CONFIG.VALID_CONFIG_KEYS.has(key), `${key} must be registered`);
      assert.equal(CONFIG.RESOLVE_EXEMPT.has(key), false, `${key} must resolve through the ladder`);
      assert.equal(CONFIG.GLOBAL_EXEMPT.has(key), false, `${key} must be settable machine-wide`);
    }
  });

  it('does not add the codex keys to what /donny-init materializes', () => {
    // D-09 of Phase 24 leaves hardcodedProjectDefaults untouched: a resolvable default
    // belongs only in configGetDefaults, or every new project's config.json grows a key
    // it never chose.
    const hard = CONFIG.hardcodedProjectDefaults();
    assert.deepEqual(
      Object.keys(hard.workflow || {}).filter((k) => k.startsWith('codex')),
      [],
      'hardcodedProjectDefaults must carry no codex_* key',
    );
    const defaults = CONFIG.configGetDefaults();
    assert.equal(defaults.workflow.codex_timeout, 300000);
    assert.equal(defaults.workflow.codex_model, 'gpt-6-astra');
    assert.equal(defaults.workflow.codex_reasoning_effort, 'high');
  });
});
