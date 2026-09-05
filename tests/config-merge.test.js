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
