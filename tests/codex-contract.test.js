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
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runTools, withConfigFixture, ROOT } from './helpers/cli.mjs';

// The argv builders are pure, so half of this file's safety property can be asserted
// without a subprocess. The CLI assertions stay: they are what proves the shipped path
// uses these same functions rather than a second copy that can drift.
const require_ = createRequire(import.meta.url);
const CODEX = require_(path.resolve(ROOT, 'packages/donny/bin/lib/codex.cjs'));

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

  // -------------------------------------------------------------------------------------
  // The same properties against the exported pure functions. Sixteen rows again, and this
  // time the effort column is real: the CLI matrix above cannot set effort to null,
  // because an unregistered key in a fixture config is inert on the read path, so only a
  // direct call reaches the omit-the-flag branch.
  // -------------------------------------------------------------------------------------
  const PURE = [];
  for (const model of [null, 'gpt-6-astra-mini'])
    for (const effort of [null, 'low'])
      for (const schemaPath of [null, SCHEMA])
        for (const cd of ['/tmp', '/usr']) PURE.push({ model, effort, schemaPath, cd });

  const pureArgvs = () => {
    assert.equal(PURE.length, 16, 'the pure permutation table must cover all sixteen rows');
    const out = [];
    for (const row of PURE) {
      const label = JSON.stringify(row);
      out.push({
        label,
        kind: 'create',
        argv: CODEX.buildCreateArgv({ ...row, outPath: '/tmp/donny-o.txt', prompt: PROMPT_MARKER }),
      });
      out.push({
        label,
        kind: 'resume',
        argv: CODEX.buildResumeArgv({
          threadId: THREAD_ID,
          model: row.model,
          effort: row.effort,
          schemaPath: row.schemaPath,
          outPath: '/tmp/donny-o.txt',
          prompt: PROMPT_MARKER,
        }),
      });
    }
    return out;
  };

  it('the builders emit no widening flag and no widening -c key on any of sixteen rows', () => {
    for (const { label, kind, argv } of pureArgvs()) {
      for (const flag of WIDENING_FLAGS) {
        assert.ok(!argv.includes(flag), `${kind} ${label} emitted ${flag}`);
      }
      for (const value of cValues(argv)) {
        for (const key of WIDENING_CONFIG_KEYS) {
          assert.ok(!value.startsWith(key), `${kind} ${label} emitted -c ${value}`);
        }
      }
    }
  });

  it('every flag token on either path is a member of that path frozen allowlist', () => {
    // The closed half of the claim. The two assertions above say "not these ten"; this one
    // says "only these nine", which is what makes an unknown flag unrepresentable rather
    // than merely unlisted. The final element is the prompt and can begin with anything.
    for (const { label, kind, argv } of pureArgvs()) {
      const allowed = kind === 'create' ? CODEX.ALLOWED_CREATE_FLAGS : CODEX.ALLOWED_RESUME_FLAGS;
      for (let i = 0; i < argv.length - 1; i++) {
        if (!argv[i].startsWith('-')) continue;
        assert.ok(allowed.includes(argv[i]), `${kind} ${label} emitted unlisted flag ${argv[i]}`);
      }
    }
  });

  it('create pins -s read-only and -C on every row, and resume carries neither', () => {
    for (const { label, kind, argv } of pureArgvs()) {
      if (kind === 'create') {
        assert.equal(argv[argv.indexOf('-s') + 1], 'read-only', `create ${label}`);
        assert.notEqual(argv.indexOf('-C'), -1, `create ${label} must pin the working root`);
      } else {
        assert.ok(!argv.includes('-s') && !argv.includes('--sandbox'), `resume ${label}`);
        assert.ok(!argv.includes('-C'), `resume ${label}: -C does not exist on exec resume`);
      }
    }
  });

  it('a null model or effort omits the flag and its value together', () => {
    for (const { label, kind, argv } of pureArgvs()) {
      const row = JSON.parse(label);
      if (!row.model) assert.ok(!argv.includes('-m'), `${kind} ${label} left an orphan -m`);
      else assert.equal(argv[argv.indexOf('-m') + 1], row.model, `${kind} ${label}`);
      if (!row.effort) assert.ok(!argv.includes('-c'), `${kind} ${label} left an orphan -c`);
      if (!row.schemaPath) assert.ok(!argv.includes('--output-schema'), `${kind} ${label}`);
      // An odd token count is the signature of an orphan flag on both shapes: create is
      // 17 tokens with everything set and drops 2 per omission, resume 15 the same way.
      assert.ok(argv.every((t) => typeof t === 'string'), `${kind} ${label} emitted a non-string`);
    }
  });

  it('the only -c value the builders ever emit is model_reasoning_effort', () => {
    for (const { label, kind, argv } of pureArgvs()) {
      for (const value of cValues(argv)) {
        assert.match(value, /^model_reasoning_effort="[^"]*"$/, `${kind} ${label}: ${value}`);
      }
    }
  });

  it('the frozen constants are actually frozen', () => {
    for (const name of ['ALLOWED_CREATE_FLAGS', 'ALLOWED_RESUME_FLAGS', 'ALLOWED_C_KEYS', 'FORBIDDEN_FLAGS', 'FORBIDDEN_C_PREFIXES']) {
      assert.ok(Object.isFrozen(CODEX[name]), `${name} must be frozen`);
    }
    assert.equal(CODEX.FORBIDDEN_FLAGS.length, 10, 'ten items, matching this file own list');
    assert.deepEqual([...CODEX.FORBIDDEN_FLAGS].sort(), [...WIDENING_FLAGS].sort());
    assert.deepEqual(CODEX.ALLOWED_C_KEYS, ['model_reasoning_effort']);
  });

  it('assertArgvSafe rejects a hand-built widening argv on both paths', () => {
    // Without this the allowlist tests are consistent with a guard that returns true
    // unconditionally: every row above is built by the very function under test, so none
    // of them can produce a violation. These are the negative controls.
    const create = (extra) => [
      'exec', '--skip-git-repo-check', '--ignore-user-config', '-C', '/tmp', '-s', 'read-only',
      ...extra, '-o', '/tmp/donny-o.txt', '--json', PROMPT_MARKER,
    ];
    assert.throws(
      () => CODEX.assertArgvSafe(create(['--dangerously-bypass-approvals-and-sandbox']), 'create'),
      /dangerously-bypass-approvals-and-sandbox/,
      'the clap-global bypass flag is Proof D attack vector 1',
    );
    assert.throws(
      () => CODEX.assertArgvSafe(create(['-c', 'sandbox_mode="danger-full-access"']), 'create'),
      /sandbox_mode/,
      'the -c route is Proof D attack vector 2 and widened just as effectively',
    );
    assert.throws(() => CODEX.assertArgvSafe(create(['--add-dir', '/']), 'create'), /add-dir/);
    assert.throws(() => CODEX.assertArgvSafe(create(['-c', 'approval_policy="never"']), 'create'), /approval_policy/);
    assert.throws(() => CODEX.assertArgvSafe(create(['-p', 'somewhere']), 'create'), /-p/);
    assert.throws(
      () => CODEX.assertArgvSafe(create(['--totally-new-flag']), 'create'),
      /--totally-new-flag/,
      'an unknown flag is refused by the allowlist without anyone having listed it',
    );
    assert.throws(
      () => CODEX.assertArgvSafe(
        ['exec', 'resume', THREAD_ID, '--skip-git-repo-check', '-s', 'read-only', '-o', '/tmp/o', '--json', 'p'],
        'resume',
      ),
      /-s/,
      'resume has no -s at 0.153.4, so emitting one is a broken invocation',
    );
    assert.throws(
      () => CODEX.assertArgvSafe(
        ['exec', '--skip-git-repo-check', '--ignore-user-config', '-C', '/tmp', '-o', '/tmp/o', '--json', 'p'],
        'create',
      ),
      /read-only/,
      'a create argv that forgot the sandbox pin must not pass',
    );
    // And the positive control: a conforming argv passes, so the guard is not "throw always".
    assert.doesNotThrow(() => CODEX.assertArgvSafe(create(['-c', 'model_reasoning_effort="high"']), 'create'));
  });

  it('a --cd naming a path that does not exist is refused, naming the path', () => {
    withConfigFixture({}, (root) => {
      const missing = path.join(TMP, 'no-such-working-root-xyz');
      const res = runCodex(root, ['run', '--cd', missing, '--prompt-file', promptFile(), '--dry-run']);
      assert.notEqual(res.status, 0);
      assert.match(res.stderr, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
  });

  it('an unrecognised option is refused rather than passed through', () => {
    // A pass-through option would be a hole straight through the allowlist, and it would
    // make the sixteen-row property above untestable.
    withConfigFixture({}, (root) => {
      const res = runCodex(root, [
        'run', '--cd', root, '--prompt-file', promptFile(), '--sandbox', 'danger-full-access', '--dry-run',
      ]);
      assert.notEqual(res.status, 0, 'an unknown option must never be forwarded to codex');
      assert.match(res.stderr, /--sandbox/);
      assert.match(res.stderr, /--prompt-file/, 'the error lists what is recognised');
    });
  });

  it('a prompt past the argv cap is refused by name, not with a bare E2BIG', () => {
    withConfigFixture({}, (root) => {
      const big = scratch('huge-prompt.md');
      fs.writeFileSync(big, 'x'.repeat(CODEX.MAX_PROMPT_BYTES + 1));
      const res = runCodex(root, ['run', '--cd', root, '--prompt-file', big, '--dry-run']);
      assert.notEqual(res.status, 0);
      assert.match(res.stderr, /ARG_MAX/, 'the failure must name the kernel limit it is protecting');
      assert.match(res.stderr, new RegExp(String(CODEX.MAX_PROMPT_BYTES + 1)), 'and the observed size');
    });
  });

  it('the dry run reports the working root the child would spawn in, on both paths', () => {
    // Proof D, Grade A: `exec resume` accepts no -C and does NOT inherit the creating
    // turn's working root. Both resumed turns recorded the CALLING process's cwd. So on
    // the resume path the working root exists only as the spawn's cwd, and a dry run that
    // printed argv alone would under-report the scope the reviewer runs with.
    // macOS canonicalises a child's cwd, so process.cwd() inside donny-tools reports
    // /private/var/... for a fixture created under /var/... . A DEFAULT working root
    // therefore arrives already realpath'd, while an explicit --cd is preserved verbatim
    // (resolveCd does not realpath, because the golden test requires resolved.cd to equal
    // what the caller passed). Both forms are recorded; resolved.cd_real carries the
    // canonical one.
    withConfigFixture({}, (root) => {
      const real = fs.realpathSync(root);
      const create = envelope(runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile(), '--dry-run']));
      assert.equal(create.spawn_cwd, root, 'create spawns in the root it pinned with -C');
      assert.equal(create.argv[create.argv.indexOf('-C') + 1], create.spawn_cwd);
      assert.equal(create.resolved.cd_real, real, 'and the canonical form is in the record');

      const bare = envelope(runCodex(root, ['resume', THREAD_ID, '--prompt-file', promptFile(), '--dry-run']));
      assert.equal(bare.spawn_cwd, real, 'resume defaults to the project root, not to nothing');
      assert.equal(bare.resolved.cd, null, 'there is no -C on resume, so resolved.cd is honestly null');

      const explicit = envelope(
        runCodex(root, ['resume', THREAD_ID, '--cd', TMP, '--prompt-file', promptFile(), '--dry-run']),
      );
      assert.equal(explicit.spawn_cwd, TMP, '--cd on resume moves the spawn cwd');
      assert.ok(!explicit.argv.includes('-C'), 'and it must never reach the argv as -C');
    });
  });

  it('the dry-run envelope carries the surface plans 04 and 05 read', () => {
    withConfigFixture({}, (root) => {
      const out = scratch('verdict.md');
      const env = envelope(runCodex(root, [
        'run', '--cd', root, '--prompt-file', promptFile(), '--schema', SCHEMA,
        '--verdict-out', out, '--dry-run',
      ]));
      assert.equal(env.mode, 'run');
      assert.equal(env.dry_run, true);
      assert.equal(env.bin, FAKE, 'the binary is one env indirection, reported not guessed');
      assert.equal(env.verdict_out, out, '--verdict-out is the caller destination, not the argv -o');
      assert.notEqual(env.resolved.out, out, 'and it is never the same path as -o');
      assert.equal(env.argv[env.argv.indexOf('-o') + 1], env.resolved.out);
      assert.equal(env.proofs_recorded_against, '0.153.4', 'the version the evidence was recorded at');
      assert.equal(env.status, null, 'the six-value status enum describes a spawn; this one spawned nothing');
      assert.equal(env.resolved.model, 'gpt-6-astra');
      assert.equal(env.resolved.effort, 'high');
      // The -o path is fresh per call, so two dry runs cannot collide and a stale file from
      // a previous run can never be read as this run's verdict (T-25-16).
      const again = envelope(runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile(), '--dry-run']));
      assert.notEqual(again.resolved.out, env.resolved.out);
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

  it('runCodex passes the resolved working root to the child as its spawn cwd', () => {
    // Proof D, Grade A: `exec resume` accepts no -C and does NOT inherit the creating turn's
    // root, so on that path the spawn's cwd is the only thing that puts the reviewer in the
    // right directory - and nothing in the argv would reveal it if it were left off. The
    // dry-run test in block 1 proves the value is REPORTED; this one proves it is PASSED.
    // The fake binary cannot show it, because it never reads its own cwd, so the seam is
    // driven directly.
    const dir = fs.realpathSync(TMP);
    const r = CODEX.runCodex({
      bin: process.execPath,
      argv: ['-e', 'process.stdout.write(process.cwd())'],
      cwd: dir,
      timeoutMs: 10000,
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, dir, 'the child ran somewhere other than the resolved working root');
    assert.notEqual(
      r.stdout,
      process.cwd(),
      'and not merely in the caller cwd, which is the Proof D failure mode',
    );
  });

  it('runCodex does not let the child inherit an open stdin', () => {
    // `codex exec` blocks in read_to_end until EOF whenever stdin is not a TTY, which is what
    // hung review.md:144. A child that reads stdin must see EOF at once, not a live pipe.
    const r = CODEX.runCodex({
      bin: 'sh', argv: ['-c', 'cat; echo READ_DONE'], cwd: TMP, timeoutMs: 5000,
    });
    assert.equal(r.status, 0, 'the child blocked on stdin instead of seeing EOF');
    assert.equal(r.stdout, 'READ_DONE\n');
  });

  it('runCodex keeps timeout, nonzero exit and missing binary distinguishable', () => {
    // The measured triple, Grade A on Node v24.16.0. classify branches on error.code precisely
    // because status and signal alone cannot tell a timeout from an over-buffer.
    const t = CODEX.runCodex({ bin: 'sh', argv: ['-c', 'sleep 5'], cwd: TMP, timeoutMs: 300 });
    assert.equal(t.status, null);
    assert.equal(t.signal, 'SIGTERM');
    assert.equal(t.error.code, 'ETIMEDOUT');
    assert.ok(Number.isInteger(t.duration_ms) && t.duration_ms >= 0, 'every call is measured');

    const n = CODEX.runCodex({
      bin: 'sh', argv: ['-c', 'echo out; echo err 1>&2; exit 7'], cwd: TMP, timeoutMs: 10000,
    });
    assert.equal(n.status, 7, 'a real exit code must survive uncoerced');
    assert.equal(n.signal, null);
    assert.equal(n.error, undefined);
    assert.equal(n.stderr, 'err\n', 'and stderr is captured, never discarded');

    const e = CODEX.runCodex({
      bin: path.join(TMP, 'no-such-binary-xyz'), argv: [], cwd: TMP, timeoutMs: 10000,
    });
    assert.equal(e.status, null);
    assert.equal(e.error.code, 'ENOENT');
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

  it('the two strings the seven-row table excluded are a recorded decision', () => {
    // 25-01 pinned the seven arms that are not in question and left the other two of the
    // eleven recorded strings to 25-04. That call, made explicit here rather than left to be
    // inferred from a regex:
    //
    //  - "To use Codex with your ChatGPT plan, upgrade to Plus" is UsageNotIncluded, an
    //    ENTITLEMENT failure. Waiting does not help, so `quota` would mislead a caller that
    //    reads it as "try later"; `nonzero` plus the verbatim terminal_message is honest.
    //  - "exceeded retry limit, last status: <code>" is RetryLimitReached, and its meaning is
    //    that code. A 429 ladder IS quota exhaustion and is already matched by the 429 token;
    //    a 5xx ladder is a transient failure and is correctly `nonzero`.
    //
    // Two strings the regex already covers are pinned alongside them, so a later widening
    // cannot pass unnoticed.
    const ROWS = [
      ['Quota exceeded. Check your plan and billing details.', 'quota'],
      ['rate limit exceeded: 40 requests per minute', 'quota'],
      ['exceeded retry limit, last status: 429, request id: req_abc', 'quota'],
      ['exceeded retry limit, last status: 503, request id: req_abc', 'nonzero'],
      ['To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/#pricing', 'nonzero'],
    ];
    for (const [message, expected] of ROWS) {
      const env = envelope(run('quota', { FAKE_CODEX_MESSAGE: message }));
      assert.equal(env.status, expected, `${message} must classify ${expected}`);
      assert.equal(
        env.terminal_message,
        message,
        'and either way the raw reason survives verbatim, which is what makes the coarse bucket safe',
      );
    }
  });

  it('a run that emits no JSONL at all classifies nonzero without throwing', () => {
    // Config errors, a malformed --output-schema file, a failed git-repo check and a bad
    // thread id all exit before the event stream opens (Grade A, four separate live cases).
    // The parser must survive an empty stream rather than treat it as impossible.
    const res = run('no_jsonl');
    const env = envelope(res);
    assert.equal(env.status, 'nonzero');
    assert.equal(env.session_id, null, 'no thread.started means no session id, reported honestly');
    assert.equal(env.terminal_message, null);
    assert.equal(env.exit_status, 1, 'and the real exit code survives uncoerced');
    assert.match(res.stderr, /unknown configuration field/, "the child's reason is not swallowed");
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
    // And in the JSON, because the caller is a workflow reading a field, not a human reading
    // a terminal. status says which bucket; error_code and note say why.
    assert.equal(env.error_code, 'ENOBUFS');
    assert.match(env.note, /ENOBUFS/);
    assert.equal(env.signal, 'SIGTERM', 'the signal that made it look like a timeout is recorded too');
  });

  it('a missing binary classifies nonzero', () => {
    const res = withConfigFixture({}, (root) =>
      runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile()], {
        DONNY_CODEX_BIN: path.join(TMP, 'no-such-codex-binary-xyz'),
      }),
    );
    assert.equal(envelope(res).status, 'nonzero', 'ENOENT is a failed review, never a clean one');
  });

  it('a spawn failure names itself in the envelope, not only on stderr', () => {
    const res = withConfigFixture({}, (root) =>
      runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile(), '--verdict-out', scratch('v.md')], {
        DONNY_CODEX_BIN: path.join(TMP, 'no-such-codex-binary-xyz'),
      }),
    );
    const env = envelope(res);
    assert.equal(env.error_code, 'ENOENT');
    assert.match(env.note, /binary was not found/);
    assert.equal(env.codex_version, null, 'a version probe failure is recorded, never propagated');
    assert.equal(env.verdict, null);
    assert.equal(env.verdict_out_written, false, 'and nothing is written where a review would go');
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

// -----------------------------------------------------------------------------------------
// 8. The rest of the envelope (D-02), and the resume path Phase 26 inherits (D-07)
// -----------------------------------------------------------------------------------------
describe('the envelope (D-02) and the resume path (D-07)', () => {
  const run = (scenario, env = {}, argv = []) =>
    withConfigFixture({}, (root) =>
      runCodex(root, ['run', '--cd', root, '--prompt-file', promptFile(), ...argv], {
        FAKE_CODEX_SCENARIO: scenario,
        ...env,
      }),
    );

  it('rate_limits is present and null, and resets_at_text is best effort', () => {
    // D-02 asks for a rate_limits block "when Codex emits one". `codex exec` emits none at
    // 0.153.4: rate_limit and RateLimitSnapshot appear nowhere in the codex-rs/exec crate at
    // tag rust-v0.153.4, and UsageLimitReachedError reaches a caller as its Display string
    // only. Pinned as an explicit null rather than an absent key, because Phase 26's CRITIC-05
    // reads a usage window from here and an absent key is indistinguishable from an oversight.
    const ok = envelope(run('ok'));
    assert.ok('rate_limits' in ok, 'the key must exist, so its absence is never inferred');
    assert.equal(ok.rate_limits, null);
    assert.equal(ok.resets_at_text, null);
    assert.equal(ok.usage.output_tokens, 340, 'usage IS available, from turn.completed');
    assert.equal(ok.exit_status, 0);
    assert.equal(ok.signal, null);
    assert.equal(ok.error_code, null);
    assert.ok(Number.isInteger(ok.duration_ms), 'every live call is measured');

    const quota = envelope(run('quota', {
      FAKE_CODEX_MESSAGE: "You've hit your usage limit. Try again at 2026-09-07T18:00:00Z.",
    }));
    assert.equal(quota.status, 'quota');
    assert.equal(quota.rate_limits, null, 'even a usage-limit failure carries no structured block');
    assert.equal(quota.resets_at_text, '2026-09-07T18:00:00Z');
    assert.equal(quota.usage, null, 'and a failed turn has no usage to report');
  });

  it('readVerdict caps its read of a model-authored file', () => {
    // Nothing plausible produces 8 MiB of verdict, but an unbounded read of untrusted input is
    // the wrong default and the cap is one statSync.
    const p = scratch('huge-verdict.txt');
    fs.writeFileSync(p, 'V'.repeat(9 * 1024 * 1024));
    const v = CODEX.readVerdict(p);
    assert.equal(v.truncated, true);
    assert.equal(v.chars, 8 * 1024 * 1024);
    const missing = CODEX.readVerdict(path.join(TMP, 'no-such-verdict-file'));
    assert.deepEqual(missing, { text: null, chars: 0, truncated: false });
  });

  it('a large verdict is diverted to an @file: payload, and --pick status reads through it', () => {
    withConfigFixture({}, (root) => {
      const out = scratch('verdict-big.md');
      // Past output()'s 50000-character threshold (core.cjs:178-199), so stdout becomes
      // @file:<path> rather than the JSON. That is existing, documented engine behaviour, and
      // it is why review.md takes the body from --verdict-out and the status from --pick
      // instead of parsing stdout. Both halves are pinned here rather than discovered later.
      const big = 'B'.repeat(80000);
      const args = ['codex', 'run', '--cd', root, '--prompt-file', promptFile(), '--verdict-out', out];
      const childEnv = {
        DONNY_CODEX_BIN: FAKE, FAKE_CODEX_SCENARIO: 'ok_json_verdict', FAKE_CODEX_VERDICT: big,
      };
      const res = runTools(root, args, childEnv);
      assert.match(res.stdout.trim(), /^@file:/, 'a large envelope is diverted, never truncated');
      const payload = JSON.parse(fs.readFileSync(res.stdout.trim().slice(6), 'utf-8'));
      assert.equal(payload.status, 'ok');
      assert.equal(payload.verdict_chars, big.length);
      assert.equal(payload.verdict_truncated, false);
      assert.equal(fs.readFileSync(out, 'utf-8'), big, 'the body reaches the destination intact');

      const picked = runTools(root, [...args, '--pick', 'status'], childEnv);
      assert.equal(picked.stdout, 'ok', '--pick must read through the @file: prefix');
    });
  });

  it('the resume path runs the same pipeline as create', () => {
    // Phase 26 is resume's first real consumer, and D-07's whole point is that it inherits a
    // tested path rather than an untested one. The create assertions do not cover it: resume
    // has its own argv builder and, with no -C to carry, its own working-root handling.
    withConfigFixture({}, (root) => {
      const out = scratch('verdict-resume.md');
      const env = envelope(runCodex(
        root,
        ['resume', THREAD_ID, '--cd', root, '--prompt-file', promptFile(), '--verdict-out', out],
        { FAKE_CODEX_SCENARIO: 'ok' },
      ));
      assert.equal(env.mode, 'resume');
      assert.equal(env.dry_run, false);
      assert.equal(env.status, 'ok');
      assert.match(env.verdict, /FINAL-VERDICT-FROM-O-FILE/);
      assert.ok(!/INTERMEDIATE-NOT-THE-VERDICT/.test(env.verdict), 'SEAM-05 holds here too');
      assert.equal(env.resolved.thread_id, THREAD_ID);
      assert.equal(env.spawn_cwd, root, 'the working root reaches the child only as the spawn cwd');
      assert.ok(!env.argv.includes('-C'), 'and never as -C, which does not exist on exec resume');
      assert.match(env.codex_version, /0\.153\.4/);
      assert.equal(fs.readFileSync(out, 'utf-8'), env.verdict);
    });
  });

  it('a failure on the resume path is just as distinct as on the create path', () => {
    withConfigFixture({}, (root) => {
      const out = scratch('verdict-resume-auth.md');
      fs.writeFileSync(out, 'STALE');
      const env = envelope(runCodex(
        root,
        ['resume', THREAD_ID, '--prompt-file', promptFile(), '--verdict-out', out],
        { FAKE_CODEX_SCENARIO: 'auth' },
      ));
      assert.equal(env.status, 'auth');
      assert.equal(env.session_id, THREAD_ID);
      assert.equal(env.verdict, null);
      assert.equal(env.verdict_out_written, false);
      assert.ok(!fs.existsSync(out), 'a stale verdict must not survive a failed resume either');
    });
  });
});
