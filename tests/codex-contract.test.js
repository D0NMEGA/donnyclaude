/**
 * The Codex invocation contract (Phase 25).
 *
 * Every assertion here runs against tests/fixtures/codex/fake-codex.mjs via DONNY_CODEX_BIN.
 * No network, no Codex quota, no dependency on the operator being logged in. The live half of
 * this phase is recorded in claudecodeoptimized .planning/phases/25-*\/25-PROBES.md and is
 * deliberately NOT automated (D-19, D-14).
 *
 * This file was written BEFORE bin/lib/codex.cjs existed. That is the point: three things in
 * this phase are decided by a literal string that the live CLI accepts without complaint (an
 * unrecognised -c key and an invalid effort value are both accepted silently, measured Grade A),
 * so the argv is frozen in a golden file the implementation did not get to choose.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SURFACE THIS FILE FREEZES
 *
 *   donny-tools codex run    [--cd <dir>] --prompt-file <p> [--schema <p>] [--verdict-out <p>]
 *                            [--dry-run]
 *   donny-tools codex resume <thread_id> --prompt-file <p> [--schema <p>] [--verdict-out <p>]
 *                            [--dry-run]
 *
 * stdout is ONE JSON object and nothing else; every human-readable line goes to stderr (D-02).
 * Note that core.cjs output() diverts a payload over 50000 bytes to a temp file and prints
 * '@file:<path>' instead, so a caller handling real Codex prose must handle that prefix.
 *
 *   status            one of ok / auth / quota / timeout / empty / nonzero. Six values, locked.
 *   verdict           the -o file contents on ok, else null. NEVER an agent_message event.
 *   session_id        thread_id from the first thread.started line
 *   codex_version     the observed `codex --version` output (D-16); null on a dry run
 *   terminal_message  the LAST turn.failed / turn.completed message, never the first error
 *   schema_valid      true / false / null when no --schema was passed
 *   schema_errors     the offending key names when schema_valid is false
 *   argv              the exact argv, binary excluded
 *   dry_run           boolean
 *   spawn_stdin       'ignore'
 *   spawn_timeout_ms  the resolved wall-clock bound, from workflow.codex_timeout
 *   spawn_max_buffer  the resolved maxBuffer in bytes (pitfall 1)
 *   resolved          { cd, model, effort, schema, out, prompt, thread_id }
 *
 * --verdict-out is the CALLER's destination and is not the same path as the argv's -o. The
 * contract spawns with a fresh per-call -o (a stale file from a previous run would otherwise be
 * read as this run's verdict), unlinks --verdict-out before the spawn, and writes it only when
 * status is ok. So the presence of --verdict-out is itself the ok signal.
 *
 * The -c token carries LITERAL double quotes: model_reasoning_effort="high". That is not shell
 * quoting and not a typo. Codex parses a -c value as TOML, so a string value has to arrive
 * quoted; the shell form -c model_reasoning_effort='"high"' was verified to parse against the
 * live binary, and in an argv array with shell:false the equivalent single token is exactly
 * model_reasoning_effort="high". Removing the inner quotes changes what Codex is asked for.
 * ---------------------------------------------------------------------------------------------
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runTools, withConfigFixture, ROOT } from './helpers/cli.mjs';

// Derived from this module's own location rather than from ROOT, so moving the suite cannot
// silently point the fake-binary indirection at a directory that does not exist.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'codex');
const FAKE = path.join(FIXTURES, 'fake-codex.mjs');
const SCHEMA = path.join(FIXTURES, 'probe.schema.json');
const GOLDEN_CREATE = path.join(FIXTURES, 'golden-argv-create.json');
const GOLDEN_RESUME = path.join(FIXTURES, 'golden-argv-resume.json');
const REVIEW_MD = path.join(ROOT, 'packages', 'donny', 'workflows', 'review.md');

// A scratch directory for prompt files and verdict destinations. Left on disk for the same
// reason cli.mjs leaves HERMETIC_DONNY_HOME: reaping it at exit races the subprocesses.
const TMP = fs.mkdtempSync(path.join(tmpdir(), 'donny-codex-contract-'));

const THREAD_ID = '01a073d9-21a2-7422-a75f-34cc609270f1';
const PROMPT_MARKER = 'REVIEW-THIS-ARTIFACT-MARKER';

let seq = 0;
const scratch = (name) => path.join(TMP, `${++seq}-${name}`);
const promptFile = (text = PROMPT_MARKER) => {
  const p = scratch('prompt.md');
  fs.writeFileSync(p, text);
  return p;
};

// Run `donny-tools codex ...` with the fake binary bound, returning the parsed JSON envelope.
// stdout must be pure JSON: any human-readable line the contract emits belongs on stderr (D-02).
const runCodex = (root, argv, env = {}) => {
  const r = runTools(root, ['codex', ...argv], { DONNY_CODEX_BIN: FAKE, ...env });
  return { ...r, json: r.stdout.trim() ? JSON.parse(r.stdout) : null };
};

// Fail with the child's own output rather than a bare TypeError on null.
const envelope = (res, what = 'the codex verb') => {
  assert.ok(
    res.json && typeof res.json === 'object',
    `${what} must emit a JSON envelope on stdout. status=${res.status} ` +
      `stdout=${JSON.stringify(res.stdout.slice(0, 200))} ` +
      `stderr=${JSON.stringify(res.stderr.slice(-400))}`,
  );
  return res.json;
};

const readGolden = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const fillGolden = (golden, map) =>
  golden.map((tok) => (Object.prototype.hasOwnProperty.call(map, tok) ? map[tok] : tok));

// The nine widening flags, spelled out so they are greppable in this file rather than imported
// from the code under test - a denylist the implementation owns could be edited to match a bug.
const WIDENING_FLAGS = [
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-bypass-hook-trust',
  '--approve-for-me',
  '--add-dir',
  '--enable',
  '--disable',
  '--ignore-rules',
  '--full-auto',
  '-p',
  '--profile',
];

// -c keys that select a permission syntax or widen the sandbox. Accepted on exec, exec resume
// and exec fork alike, which is why the resume path needs the same assertion as the create path.
const WIDENING_CONFIG_KEYS = [
  'sandbox_mode=',
  'default_permissions=',
  'permission_profile=',
  'approval_policy=',
  'features.',
];

const cValues = (argv) => argv.filter((_, i) => i > 0 && argv[i - 1] === '-c');

// -----------------------------------------------------------------------------------------
// 1. argv construction (D-20, SEAM-03, RECORD-01)
// -----------------------------------------------------------------------------------------
describe('argv construction (D-20, SEAM-03, RECORD-01)', () => {
  // model set and null, effort set and null, schema present and absent, cd default and
  // explicit. Sixteen rows. A property that holds on one config is a coincidence; "structurally
  // unable to emit a widening flag" is a claim about every row.
  const PERMUTATIONS = [];
  for (const model of [null, 'gpt-6-astra-mini'])
    for (const effort of [null, 'low'])
      for (const withSchema of [false, true])
        for (const withCd of [false, true]) PERMUTATIONS.push({ model, effort, withSchema, withCd });

  // Key names are 25-03's to finalise; only the shape (set versus unset) is load-bearing here,
  // and an unregistered key in a fixture config is inert on the read path.
  const matrix = [];
  before(() => {
    for (const row of PERMUTATIONS) {
      const workflow = {};
      if (row.model) workflow.codex_model = row.model;
      if (row.effort) workflow.codex_effort = row.effort;
      withConfigFixture({ workflow }, (root) => {
        const prompt = promptFile();
        const common = ['--prompt-file', prompt, '--dry-run'];
        if (row.withSchema) common.push('--schema', SCHEMA);
        if (row.withCd) common.push('--cd', root);
        matrix.push({
          row,
          create: runCodex(root, ['run', ...common]),
          resume: runCodex(root, ['resume', THREAD_ID, ...common]),
        });
      });
    }
  });

  const eachArgv = (fn) => {
    assert.equal(matrix.length, 16, 'the permutation table must cover all sixteen rows');
    for (const entry of matrix) {
      const label = JSON.stringify(entry.row);
      fn(envelope(entry.create, `create ${label}`).argv, 'create', label);
      fn(envelope(entry.resume, `resume ${label}`).argv, 'resume', label);
    }
  };

  it('create argv matches the golden file byte for byte', () => {
    withConfigFixture({}, (root) => {
      const prompt = promptFile();
      const res = runCodex(root, [
        'run', '--cd', root, '--prompt-file', prompt, '--schema', SCHEMA, '--dry-run',
      ]);
      const env = envelope(res);
      assert.equal(env.resolved.cd, root, '-C must carry the --cd the caller passed');
      assert.equal(env.resolved.schema, SCHEMA, '--output-schema must carry the --schema passed');
      assert.match(env.resolved.prompt, new RegExp(PROMPT_MARKER), 'the prompt must be the prompt file');
      const expected = fillGolden(readGolden(GOLDEN_CREATE), {
        '{{CD}}': env.resolved.cd,
        '{{SCHEMA}}': env.resolved.schema,
        '{{OUT}}': env.resolved.out,
        '{{PROMPT}}': env.resolved.prompt,
      });
      assert.deepEqual(env.argv, expected);
    });
  });

  it('resume argv matches the golden file byte for byte', () => {
    withConfigFixture({}, (root) => {
      const prompt = promptFile();
      const res = runCodex(root, [
        'resume', THREAD_ID, '--prompt-file', prompt, '--schema', SCHEMA, '--dry-run',
      ]);
      const env = envelope(res);
      assert.equal(env.resolved.thread_id, THREAD_ID);
      const expected = fillGolden(readGolden(GOLDEN_RESUME), {
        '{{THREAD_ID}}': env.resolved.thread_id,
        '{{SCHEMA}}': env.resolved.schema,
        '{{OUT}}': env.resolved.out,
        '{{PROMPT}}': env.resolved.prompt,
      });
      assert.deepEqual(env.argv, expected);
    });
  });

  it('the create argv always contains -s read-only', () => {
    eachArgv((argv, kind, label) => {
      if (kind !== 'create') return;
      const i = argv.indexOf('-s');
      assert.notEqual(i, -1, `create ${label} must pin the sandbox at creation`);
      assert.equal(argv[i + 1], 'read-only', `create ${label} must pin read-only`);
    });
  });

  it('the resume argv never contains -s at all', () => {
    // -s does not exist on `exec resume` at 0.153.4, so emitting it is not a widening risk,
    // it is an invocation that fails outright. Sandbox mode is inherited from creation.
    eachArgv((argv, kind, label) => {
      if (kind !== 'resume') return;
      assert.ok(!argv.includes('-s'), `resume ${label} must not carry -s`);
      assert.ok(!argv.includes('--sandbox'), `resume ${label} must not carry --sandbox`);
      assert.ok(!argv.includes('-C'), `resume ${label} must not carry -C, absent on resume`);
    });
  });

  it('neither path ever emits a widening flag', () => {
    eachArgv((argv, kind, label) => {
      for (const flag of WIDENING_FLAGS) {
        assert.ok(!argv.includes(flag), `${kind} ${label} must never emit ${flag}`);
      }
    });
  });

  it('neither path ever emits a widening -c key', () => {
    eachArgv((argv, kind, label) => {
      for (const value of cValues(argv)) {
        for (const key of WIDENING_CONFIG_KEYS) {
          assert.ok(
            !value.startsWith(key),
            `${kind} ${label} emitted a widening -c value: ${value}`,
          );
        }
      }
    });
  });

  it('the only -c key emitted is model_reasoning_effort', () => {
    eachArgv((argv, kind, label) => {
      for (const value of cValues(argv)) {
        assert.match(
          value,
          /^model_reasoning_effort="/,
          `${kind} ${label} emitted an unexpected -c value: ${value}`,
        );
      }
    });
  });

  it('--dry-run never spawns the binary', () => {
    withConfigFixture({}, (root) => {
      const prompt = promptFile();
      const res = runCodex(
        root,
        ['run', '--cd', root, '--prompt-file', prompt, '--dry-run'],
        { DONNY_CODEX_BIN: path.join(TMP, 'no-such-codex-binary-xyz') },
      );
      assert.equal(res.status, 0, 'a dry run must not depend on the binary existing');
      const env = envelope(res);
      assert.ok(Array.isArray(env.argv) && env.argv.length > 0, 'a dry run must print the argv');
      assert.equal(env.dry_run, true);
      // Follows from never spawning: the version cannot have been observed.
      assert.equal(env.codex_version, null, 'a dry run cannot have observed a version');
    });
  });
});

// -----------------------------------------------------------------------------------------
// 2. RECORD-01: the call is bounded and stdin is never inherited
// -----------------------------------------------------------------------------------------
describe('RECORD-01: the call is bounded and stdin is never inherited', () => {
  it('spawn options set stdio[0] to ignore', () => {
    // Measured Grade A: spawnSync with stdio[0]='pipe' and no `input` does NOT hang, because
    // Node closes the child's stdin immediately. So this assertion is not what saves the
    // contract from review.md:144's hang. It is still the right thing to pin, because 'ignore'
    // is correct under spawn, exec and execSync too and does not rest on a Node implementation
    // detail that could change. Not cargo cult: a recorded reason.
    withConfigFixture({}, (root) => {
      const res = runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile(), '--dry-run']);
      assert.equal(envelope(res).spawn_stdin, 'ignore');
    });
  });

  it('spawn options carry a numeric timeout resolved from workflow.codex_timeout', () => {
    withConfigFixture({}, (root) => {
      const res = runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile(), '--dry-run']);
      const env = envelope(res);
      assert.equal(typeof env.spawn_timeout_ms, 'number');
      assert.ok(Number.isInteger(env.spawn_timeout_ms), 'the bound must be an integer');
      // Milliseconds, matching workflow.subagent_timeout: 300000. The exact default is 25-03's
      // call; that it is a real bound in ms is not. The CLI's own retry ladder took ~15s
      // unauthenticated, so anything under a second would be a bound on nothing.
      assert.ok(env.spawn_timeout_ms >= 1000, `bound too small to be milliseconds: ${env.spawn_timeout_ms}`);
    });
  });

  it('a project config value for workflow.codex_timeout wins over the default', () => {
    withConfigFixture({ workflow: { codex_timeout: 12345 } }, (root) => {
      const res = runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile(), '--dry-run']);
      assert.equal(envelope(res).spawn_timeout_ms, 12345);
    });
  });

  it('a fake command that sleeps past the bound is classified timeout', () => {
    withConfigFixture({ workflow: { codex_timeout: 400 } }, (root) => {
      const res = runCodex(
        root,
        ['run', '--cd', root, '--prompt-file', promptFile()],
        { FAKE_CODEX_SCENARIO: 'slow', FAKE_CODEX_SLEEP_MS: '5000' },
      );
      assert.equal(envelope(res).status, 'timeout');
    });
  });
});

// -----------------------------------------------------------------------------------------
// 3. RECORD-02: every failure is distinct from a clean review
// -----------------------------------------------------------------------------------------
describe('RECORD-02: every failure is distinct from a clean review', () => {
  const run = (scenario, env = {}, argv = []) =>
    withConfigFixture({}, (root) =>
      runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile(), ...argv], {
        FAKE_CODEX_SCENARIO: scenario,
        ...env,
      }),
    );

  it('exit 1 with a 401 terminal event classifies auth', () => {
    assert.equal(envelope(run('auth')).status, 'auth');
  });

  it('each of the seven quota strings classifies quota', () => {
    // The seven Display arms of UsageLimitReachedError and its siblings, at tag
    // rust-v0.153.4. Two further strings in the recorded vocabulary are deliberately absent:
    // "To use Codex with your ChatGPT plan, upgrade to Plus" and "exceeded retry limit, last
    // status: <code>" carry none of the tokens the research's suggested QUOTA_RE matches, so
    // including them here would silently mandate a wider regex than the research proposed.
    // 25-04 owns that call; this table pins the seven that are not in question.
    const QUOTA_STRINGS = [
      "You've hit your usage limit. Try again at 2026-09-07T18:00:00Z.",
      "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), or try again later.",
      "You've hit your usage limit for gpt-6-astra. Switch to another model now, or try again later.",
      'Your workspace is out of credits. Add credits to continue.',
      'Your workspace is out of credits. Ask your workspace owner to refill in order to continue.',
      'You hit your spend cap set in your workspace. Increase your spend cap to continue.',
      'You hit your spend cap set by the owner of your workspace. Ask them to increase it.',
    ];
    assert.equal(QUOTA_STRINGS.length, 7);
    for (const message of QUOTA_STRINGS) {
      const res = run('quota', { FAKE_CODEX_MESSAGE: message });
      assert.equal(envelope(res).status, 'quota', `must classify quota: ${message}`);
    }
  });

  it('exit 0 with a zero-byte -o file classifies empty, not ok', () => {
    const env = envelope(run('ok_empty_o'));
    assert.equal(env.status, 'empty');
    assert.notEqual(env.status, 'ok');
  });

  it('exit 0 with no -o file classifies nonzero, not ok', () => {
    const env = envelope(run('ok_missing_o'));
    assert.equal(env.status, 'nonzero');
    assert.notEqual(env.status, 'ok');
  });

  it('ENOBUFS classifies nonzero and never timeout', () => {
    // The fake has to out-write the contract's own maxBuffer for this to test anything, so the
    // bound is read from a dry run first. Pitfall 1: over-buffer looks exactly like a timeout
    // (status null, SIGTERM) to any classifier that does not read error.code.
    const bound = withConfigFixture({}, (root) => {
      const res = runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile(), '--dry-run']);
      return envelope(res).spawn_max_buffer;
    });
    assert.equal(typeof bound, 'number', 'the contract must report its resolved maxBuffer');
    assert.ok(bound <= 128 * 1024 * 1024, `a maxBuffer of ${bound} is not a bound`);
    const res = run('enobufs', { FAKE_CODEX_BYTES: String(bound + 1024) });
    const env = envelope(res);
    assert.equal(env.status, 'nonzero');
    assert.notEqual(env.status, 'timeout');
    assert.match(res.stderr, /ENOBUFS/i, 'over-buffer must be named on stderr, not silently folded in');
  });

  it('a missing binary classifies nonzero', () => {
    const res = withConfigFixture({}, (root) =>
      runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile()], {
        DONNY_CODEX_BIN: path.join(TMP, 'no-such-codex-binary-xyz'),
      }),
    );
    assert.equal(envelope(res).status, 'nonzero', 'ENOENT is a failed review, never a clean one');
  });

  it('the recorded 401 fixture classifies auth and yields the right thread_id', () => {
    const env = envelope(run('auth'));
    assert.equal(env.status, 'auth');
    assert.equal(env.session_id, THREAD_ID, 'thread.started is emitted before the model is reached');
  });

  it('the last turn.failed wins over the first error event', () => {
    // The fixture carries ten error events. Nine are retry chatter; only the terminal
    // turn.failed says why. A classifier reading the first error reports "Reconnecting".
    const env = envelope(run('auth'));
    assert.match(env.terminal_message, /^unexpected status 401 Unauthorized: Missing bearer/);
    assert.ok(
      !/Reconnecting/.test(env.terminal_message),
      `terminal_message took retry chatter: ${env.terminal_message}`,
    );
  });

  it('stdout is pure JSON and every human line is on stderr', () => {
    const res = run('ok');
    const raw = res.stdout.trim();
    assert.ok(raw.startsWith('{') && raw.endsWith('}'), `stdout is not one JSON object: ${raw.slice(0, 200)}`);
    assert.doesNotThrow(() => JSON.parse(raw));
    assert.ok(
      !res.stdout.includes('Reading additional input from stdin'),
      "the child's stderr noise must never reach our stdout",
    );
    assert.match(res.stderr, /Reading additional input from stdin/, 'the announcement must survive, not be swallowed');
  });
});

// -----------------------------------------------------------------------------------------
// 4. SEAM-05: the verdict comes from the -o file
// -----------------------------------------------------------------------------------------
describe('SEAM-05: the verdict comes from the -o file', () => {
  it('the verdict is the -o file contents, not the agent_message event', () => {
    const res = withConfigFixture({}, (root) =>
      runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile()], {
        FAKE_CODEX_SCENARIO: 'ok',
      }),
    );
    const env = envelope(res);
    assert.equal(env.status, 'ok');
    assert.match(env.verdict, /FINAL-VERDICT-FROM-O-FILE/);
    assert.ok(
      !/INTERMEDIATE-NOT-THE-VERDICT/.test(env.verdict),
      'the verdict came from an agent_message event, which openai/codex#19816 makes unsafe',
    );
  });

  it('--verdict-out is written only on status ok', () => {
    withConfigFixture({}, (root) => {
      const okOut = scratch('verdict-ok.md');
      const okRes = runCodex(
        root,
        ['run', '--cd', root, '--prompt-file', promptFile(), '--verdict-out', okOut],
        { FAKE_CODEX_SCENARIO: 'ok' },
      );
      assert.equal(envelope(okRes).status, 'ok');
      assert.ok(fs.existsSync(okOut), 'ok must write the verdict destination');
      assert.match(fs.readFileSync(okOut, 'utf-8'), /FINAL-VERDICT-FROM-O-FILE/);

      const authOut = scratch('verdict-auth.md');
      runCodex(
        root,
        ['run', '--cd', root, '--prompt-file', promptFile(), '--verdict-out', authOut],
        { FAKE_CODEX_SCENARIO: 'auth' },
      );
      assert.ok(!fs.existsSync(authOut), 'an auth failure must leave no verdict file behind');

      const emptyOut = scratch('verdict-empty.md');
      runCodex(
        root,
        ['run', '--cd', root, '--prompt-file', promptFile(), '--verdict-out', emptyOut],
        { FAKE_CODEX_SCENARIO: 'ok_empty_o' },
      );
      assert.ok(!fs.existsSync(emptyOut), 'a contentless run must not leave a zero-byte review');
    });
  });

  it('a pre-existing --verdict-out file is removed before the spawn', () => {
    withConfigFixture({}, (root) => {
      const staleOut = scratch('verdict-stale.md');
      fs.writeFileSync(staleOut, 'STALE');
      runCodex(
        root,
        ['run', '--cd', root, '--prompt-file', promptFile(), '--verdict-out', staleOut],
        { FAKE_CODEX_SCENARIO: 'auth' },
      );
      assert.ok(
        !fs.existsSync(staleOut),
        'a stale verdict from a previous run would be read as the review for this run',
      );
    });
  });
});

// -----------------------------------------------------------------------------------------
// 5. SEAM-02: the verb dispatches
// -----------------------------------------------------------------------------------------
describe('SEAM-02: the verb dispatches', () => {
  it('an unknown codex sub-verb errors and names the available ones', () => {
    const res = withConfigFixture({}, (root) => runCodex(root, ['frobnicate']));
    assert.notEqual(res.status, 0, 'an unknown sub-verb must be an error, never a silent no-op');
    assert.match(res.stderr, /\brun\b/, 'the error must name the run sub-verb');
    assert.match(res.stderr, /\bresume\b/, 'the error must name the resume sub-verb');
  });

  it('review.md contains no codex exec string', () => {
    // Expected to stay red until 25-05 rewires line 144. The whole SEAM-02 claim is that
    // exactly one contract reaches Codex, and an ad-hoc shell line in a workflow is a
    // second one.
    const source = fs.readFileSync(REVIEW_MD, 'utf-8');
    assert.ok(
      !/codex exec/.test(source),
      'workflows/review.md still calls codex exec directly',
    );
  });
});

// -----------------------------------------------------------------------------------------
// 6. D-16: the version stamp
// -----------------------------------------------------------------------------------------
describe('D-16: the version stamp', () => {
  it('the observed codex --version is in the envelope', () => {
    const res = withConfigFixture({}, (root) =>
      runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile()], {
        FAKE_CODEX_SCENARIO: 'ok',
      }),
    );
    assert.match(envelope(res).codex_version, /0\.153\.4/);
  });

  it('a version mismatch warns once on stderr and does not change status', () => {
    const res = withConfigFixture({}, (root) =>
      runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile()], {
        FAKE_CODEX_SCENARIO: 'ok',
        FAKE_CODEX_VERSION: '0.154.0',
      }),
    );
    const env = envelope(res);
    assert.match(res.stderr, /version drift/i, 'stale evidence must be visible, never assumed');
    assert.equal(env.status, 'ok', 'a version warning must never become a failure status');
    const hits = res.stderr.match(/version drift/gi) || [];
    assert.equal(hits.length, 1, `warn once, not ${hits.length} times`);
  });
});

// -----------------------------------------------------------------------------------------
// 7. schema_valid (additive, operator decision 2026-09-05)
// -----------------------------------------------------------------------------------------
describe('schema_valid (additive, operator decision 2026-09-05)', () => {
  const withVerdict = (verdict, argv = ['--schema', SCHEMA]) =>
    withConfigFixture({}, (root) =>
      runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile(), ...argv], {
        FAKE_CODEX_SCENARIO: 'ok_json_verdict',
        FAKE_CODEX_VERDICT: verdict,
      }),
    );

  it('schema_valid is null when no --schema is passed', () => {
    const env = envelope(withVerdict('{"zq_verdict_code":"QQ-BRAVO"}', []));
    assert.equal(env.status, 'ok');
    assert.equal(env.schema_valid, null, 'no schema means no verdict about the schema');
  });

  it('a conforming verdict sets schema_valid true', () => {
    const env = envelope(
      withVerdict('{"zq_verdict_code":"QQ-BRAVO","zq_evidence_span":[3,9],"zq_confidence_bucket":73}'),
    );
    assert.equal(env.schema_valid, true);
    assert.deepEqual(env.schema_errors, []);
  });

  it('a missing required key sets schema_valid false and names it', () => {
    const env = envelope(withVerdict('{"zq_verdict_code":"QQ-BRAVO","zq_evidence_span":[3,9]}'));
    assert.equal(env.schema_valid, false);
    assert.match(env.schema_errors.join(' '), /zq_confidence_bucket/);
  });

  it('an illegal enum member sets schema_valid false and names it', () => {
    const env = envelope(
      withVerdict('{"zq_verdict_code":"QQ-DELTA","zq_evidence_span":[3,9],"zq_confidence_bucket":73}'),
    );
    assert.equal(env.schema_valid, false);
    assert.match(env.schema_errors.join(' '), /zq_verdict_code/);
  });

  it('an extra key sets schema_valid false and names it', () => {
    const env = envelope(
      withVerdict(
        '{"zq_verdict_code":"QQ-BRAVO","zq_evidence_span":[3,9],"zq_confidence_bucket":73,"helpful_extra":"no"}',
      ),
    );
    assert.equal(env.schema_valid, false);
    assert.match(env.schema_errors.join(' '), /helpful_extra/);
  });

  it('a non-JSON verdict sets schema_valid false, and status stays ok', () => {
    // The D-02 enum is locked at six values, so a schema violation must never become a
    // seventh status. The run succeeded; only the shape of what it returned is wrong.
    const env = envelope(withVerdict('Looks fine to me, 8 out of 10.'));
    assert.equal(env.schema_valid, false);
    assert.equal(env.status, 'ok');
  });
});
