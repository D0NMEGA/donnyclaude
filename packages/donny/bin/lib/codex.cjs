/**
 * Codex - the single owned contract for every Codex call the engine makes (SEAM-02).
 *
 * There is exactly one `codex exec` invocation in this package and it is built here. The
 * previous caller was a shell line at workflows/review.md:144 with an open stdin, no bound
 * and stderr sent to /dev/null; four requirements failed on that one line.
 *
 * The argv is a PURE function of config plus arguments, checked against a frozen allowlist
 * rather than a denylist. `codex exec` gained --strict-config, --enable, --disable and
 * --ignore-rules in one four-day window, so a denylist needs maintaining against a moving
 * target while an allowlist makes every unknown flag unrepresentable by construction.
 *
 * SEAM-03, measured rather than assumed. `--sandbox` is absent from `exec resume` at 0.153.4
 * because clap's mark_exec_global_args does not mark it global, NOT because resume refuses to
 * widen: Proof D widened a session created `-s read-only` on BOTH vectors, the clap-global
 * --dangerously-bypass-approvals-and-sandbox flag and `-c sandbox_mode="danger-full-access"`,
 * with three signals agreeing (a filesystem sentinel, the command_execution events, and
 * Codex's own persisted turn_context). Enforcement here is "this contract never asks for
 * it", pinned by the allowlist and assertArgvSafe at the point of construction, not "the CLI
 * prevents it". See 25-PROBES.md section 4.
 *
 * Working root, also measured. D-28 assumed a resumed round inherits the creating turn's
 * `-C` root; both resumed turns in Proof D recorded the CALLING process's cwd instead. Since
 * `exec resume` accepts no `-C`, the working root exists there only as the child spawn's cwd,
 * so it is resolved here and reported as `spawn_cwd`: a dry run printing argv alone would
 * under-report the scope the reviewer runs with.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { output, error, planningRoot } = require('./core.cjs');
const { configGetDefaults, loadGlobalDefaults, mergeConfigLayers } = require('./config.cjs');

// ─── The frozen contract ──────────────────────────────────────────────────────

/** Every flag this contract may emit on `codex exec`. Nothing else is representable. */
const ALLOWED_CREATE_FLAGS = Object.freeze([
  '--skip-git-repo-check', '--ignore-user-config', '-C', '-s', '-m', '-c',
  '--output-schema', '-o', '--json',
]);

/** The same, minus the four that do not exist on `codex exec resume` at 0.153.4. */
const ALLOWED_RESUME_FLAGS = Object.freeze([
  '--skip-git-repo-check', '--ignore-user-config', '-m', '-c',
  '--output-schema', '-o', '--json',
]);

/** The only `-c` key this contract sets. A second key is a second permission surface. */
const ALLOWED_C_KEYS = Object.freeze(['model_reasoning_effort']);

/**
 * The ten widening items, Grade A from `--help` and codex-rs/exec/src/lib.rs at
 * rust-v0.153.4. Listed as well as excluded by the allowlist, so a violation names the flag
 * instead of reporting a generic "unlisted".
 *
 * -p and --profile are forbidden rather than merely unused: --ignore-user-config blanks the
 * profile layer too (load_user_config_layer short-circuits to an empty table for both
 * $CODEX_HOME/config.toml and $CODEX_HOME/<name>.config.toml), so a -p that silently
 * contributes nothing is worse than one that is refused.
 */
const FORBIDDEN_FLAGS = Object.freeze([
  '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust',
  '--approve-for-me', '--add-dir', '--enable', '--disable', '--ignore-rules',
  '--full-auto', '-p', '--profile',
]);

/** `-c` keys that select a permission syntax or widen the sandbox, on every subcommand. */
const FORBIDDEN_C_PREFIXES = Object.freeze([
  'sandbox_mode=', 'default_permissions=', 'permission_profile=',
  'approval_policy=', 'features.',
]);

// The codex-cli version 25-PROBES.md was recorded against. A module constant, not a config
// key: it is a property of the recorded evidence, and making it settable would let the D-16
// drift warning be silenced by configuration.
const PROOFS_RECORDED_AGAINST = '0.153.4';

// The prompt is the last positional argv element and macOS ARG_MAX is 1048576 bytes for the
// WHOLE argv. Past it the spawn fails with a bare E2BIG far from its cause, so cap it at
// half the limit and fail by name.
const MAX_PROMPT_BYTES = 512 * 1024;

// spawnSync's maxBuffer, in the envelope so a test can out-write it deliberately. The ~1 MiB
// default truncates a real --json stream as status null plus SIGTERM, indistinguishable from
// a timeout to a classifier that does not read error.code (pitfall 1). 64 MiB is a bound.
const MAX_SPAWN_BUFFER = 64 * 1024 * 1024;

// A reasoning effort reaches the argv inside a TOML string literal, so a value carrying a
// quote, a space or a comma could close the string and append a second key. The vocabulary
// is a closed set of lowercase words, so anything else is dropped rather than sanitised.
const EFFORT_RE = /^[a-z][a-z-]*$/;

// ─── Config ───────────────────────────────────────────────────────────────────

const warned = new Set();
const warnOnce = (key, message) => {
  if (warned.has(key)) return;
  warned.add(key);
  process.stderr.write(`donny-tools: warning: ${message}\n`);
};

/** null for an absent or empty value, a string otherwise. Never a non-string in argv. */
const optString = (v) => (v === null || v === undefined || v === '' ? null : String(v));

/**
 * Resolve the three workflow.codex_* keys through Phase 24's ladder, composing the same
 * three functions cmdConfigGet uses so a value written to $DONNY_HOME/defaults.json reaches
 * this module the day it is written (D-01).
 *
 * @returns {{timeoutMs: number, model: string|null, effort: string|null}}
 */
function resolveCodexConfig(cwd) {
  const configPath = path.join(planningRoot(cwd), 'config.json');
  let project = {};
  if (fs.existsSync(configPath)) {
    try {
      project = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
      // A project config is not optional the way the global file is; same posture as
      // cmdConfigGet, which hard-errors here rather than reviewing under a guessed config.
      error('Failed to read config.json: ' + err.message);
    }
  }
  const defaults = configGetDefaults();
  const merged = mergeConfigLayers(defaults, loadGlobalDefaults(), project);
  const wf = merged.workflow || {};

  // D-04 posture on both coercions: warn, never silently swallow, never hard-error on an
  // optional path. A dropped effort matters because Proof B measured the CLI built-in as
  // "low" under --ignore-user-config, so the warning is the only signal the operator gets.
  let timeoutMs = Number(wf.codex_timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    warnOnce('timeout', `workflow.codex_timeout is ${JSON.stringify(wf.codex_timeout)}, not a ` +
      `positive number of milliseconds. Using ${defaults.workflow.codex_timeout}.`);
    timeoutMs = defaults.workflow.codex_timeout;
  }

  let effort = optString(wf.codex_reasoning_effort);
  if (effort !== null && !EFFORT_RE.test(effort)) {
    warnOnce('effort', `workflow.codex_reasoning_effort is ${JSON.stringify(effort)}, not a bare ` +
      'lowercase word. Omitting -c model_reasoning_effort; the review runs at the CLI built-in.');
    effort = null;
  }

  return { timeoutMs: Math.trunc(timeoutMs), model: optString(wf.codex_model), effort };
}

// ─── The argv builders ────────────────────────────────────────────────────────

/**
 * `codex exec` - create a session, pinned read-only at creation (SEAM-03).
 *
 * Order is the frozen fixture tests/fixtures/codex/golden-argv-create.json, authored before
 * this function existed. The -c token carries LITERAL double quotes: Codex parses a -c value
 * as TOML and a string value has to arrive quoted. Not shell quoting, not a typo, and the
 * CLI accepts a mangled value silently, so do not "clean up" the quotes.
 *
 * @returns {readonly string[]} frozen argv, binary excluded
 */
function buildCreateArgv({ cd, model, effort, schemaPath, outPath, prompt }) {
  const argv = ['exec', '--skip-git-repo-check', '--ignore-user-config', '-C', cd, '-s', 'read-only'];
  if (model) argv.push('-m', model);
  if (effort) argv.push('-c', `model_reasoning_effort="${effort}"`);
  if (schemaPath) argv.push('--output-schema', schemaPath);
  argv.push('-o', outPath, '--json', prompt);
  assertArgvSafe(argv, 'create');
  return Object.freeze(argv);
}

/**
 * `codex exec resume <thread_id>` - continue a session (D-07).
 *
 * No -s, no -C, no -p, no --add-dir: none exists on `exec resume` at 0.153.4, so emitting
 * one is a broken invocation rather than a widening risk. --skip-git-repo-check IS included,
 * because without it a resume outside a trusted directory fails with "Not inside a trusted
 * directory and --skip-git-repo-check was not specified." before reaching the session store.
 */
function buildResumeArgv({ threadId, model, effort, schemaPath, outPath, prompt }) {
  const argv = ['exec', 'resume', threadId, '--skip-git-repo-check', '--ignore-user-config'];
  if (model) argv.push('-m', model);
  if (effort) argv.push('-c', `model_reasoning_effort="${effort}"`);
  if (schemaPath) argv.push('--output-schema', schemaPath);
  argv.push('-o', outPath, '--json', prompt);
  assertArgvSafe(argv, 'resume');
  return Object.freeze(argv);
}

/**
 * Throw unless argv is representable under this contract. Both builders call it on their own
 * output, so the property holds even if a later edit adds a branch that forgets it: the
 * safety claim lives where the argv is produced, not only in a test file that can be deleted.
 *
 * @param {string[]} argv
 * @param {'create'|'resume'} mode
 */
function assertArgvSafe(argv, mode) {
  const allowed = mode === 'create' ? ALLOWED_CREATE_FLAGS : ALLOWED_RESUME_FLAGS;
  const bad = (why) => { throw new Error(`codex argv rejected (${mode}): ${why}`); };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (typeof tok !== 'string') bad(`token ${i} is not a string`);
    if (FORBIDDEN_FLAGS.includes(tok)) bad(`forbidden flag ${tok}`);
    // A token is only a flag if it is in flag position. The prompt is the LAST element and
    // may begin with anything, including a hyphen, so flag checking stops before it.
    if (i < argv.length - 1 && tok.startsWith('-') && !allowed.includes(tok)) {
      bad(`flag ${tok} is not in the frozen allowlist [${allowed.join(' ')}]`);
    }
    if (tok === '-c') {
      const value = argv[i + 1];
      if (typeof value !== 'string') bad('-c with no value');
      for (const prefix of FORBIDDEN_C_PREFIXES) {
        if (value.startsWith(prefix)) bad(`forbidden -c key ${value}`);
      }
      const key = value.split('=')[0];
      if (!ALLOWED_C_KEYS.includes(key)) bad(`-c key ${key} is not in [${ALLOWED_C_KEYS.join(' ')}]`);
      if (!/^model_reasoning_effort="[^"]*"$/.test(value)) bad(`malformed -c value ${value}`);
    }
  }

  if (mode === 'create') {
    const s = argv.indexOf('-s');
    if (s === -1 || argv[s + 1] !== 'read-only') bad('the create path must pin -s read-only');
    const c = argv.indexOf('-C');
    if (c === -1 || !argv[c + 1] || argv[c + 1].startsWith('-')) bad('the create path must pin -C');
  } else {
    if (argv.includes('-s') || argv.includes('--sandbox')) bad('exec resume has no sandbox flag');
    if (argv.includes('-C')) bad('exec resume has no -C');
  }
}

// ─── Argument resolution ──────────────────────────────────────────────────────

/** Read the prompt file, refusing one large enough to blow ARG_MAX later and obscurely. */
function resolvePrompt(promptFile) {
  let st;
  try {
    st = fs.statSync(promptFile);
  } catch {
    error(`codex: --prompt-file does not exist: ${promptFile}`);
  }
  if (!st.isFile()) error(`codex: --prompt-file is not a file: ${promptFile}`);
  if (st.size > MAX_PROMPT_BYTES) {
    error(`codex: --prompt-file ${promptFile} is ${st.size} bytes, over the ` +
      `${MAX_PROMPT_BYTES}-byte cap. The prompt is the last argv element and the whole argv ` +
      'must fit in ARG_MAX (1048576 on macOS), so a larger one fails with a bare E2BIG.');
  }
  return fs.readFileSync(promptFile, 'utf-8');
}

/**
 * The working root, absolute and verified to exist.
 *
 * NOT realpath'd: the frozen contract test requires the resolved root to equal the --cd the
 * caller passed, and on macOS os.tmpdir() sits under the /var -> /private/var symlink, so
 * realpath would rewrite a stated path into one nobody wrote. The canonical form travels
 * separately as resolved.cd_real, so a --cd through a symlink is still visible in the record.
 */
function resolveCd(cdArg, cwd) {
  const abs = path.resolve(cdArg || cwd);
  let st;
  try { st = fs.statSync(abs); } catch { error(`codex: --cd does not exist: ${abs}`); }
  if (!st.isDirectory()) error(`codex: --cd is not a directory: ${abs}`);
  return abs;
}

/** The canonical form of a path already known to exist. */
const realOf = (p) => { try { return fs.realpathSync(p); } catch { return p; } };

/**
 * A fresh per-call directory for the -o file, never a fixed
 * /tmp/donny-review-codex-{phase}.md-shaped path: the -o file is written only on success, so
 * a stale file at a predictable path would be read as this run's verdict, and a predictable
 * path is pre-creatable by any other local process (T-25-16). Allocated on the dry-run path
 * too, so the printed argv is the argv and an operator can paste it and have it work.
 */
function allocOutPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'donny-codex-')), 'last-message.txt');
}

const RECOGNISED_OPTS = '--prompt-file <path>, --verdict-out <path>, --schema <path>, --cd <dir>, --dry-run';

/**
 * Parse exactly five options. An unrecognised one is refused, never forwarded: a
 * pass-through is a hole straight through the allowlist and would make SEAM-03's property
 * untestable, which is worth more than the flexibility.
 */
function parseCodexOpts(argv) {
  const opts = { promptFile: null, verdictOut: null, schema: null, cd: null, dryRun: false };
  const takes = { '--prompt-file': 'promptFile', '--verdict-out': 'verdictOut', '--schema': 'schema', '--cd': 'cd' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') { opts.dryRun = true; continue; }
    if (!takes[arg]) error(`codex: unrecognised option ${arg}. Recognised: ${RECOGNISED_OPTS}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) error(`codex: missing value for ${arg}`);
    opts[takes[arg]] = value;
    i++;
  }
  if (!opts.promptFile) error(`codex: --prompt-file is required. Recognised: ${RECOGNISED_OPTS}`);
  return opts;
}

// ─── The verb ─────────────────────────────────────────────────────────────────

// One test seam so the suite can substitute a fake binary; no shipped workflow sets it.
// Never probed: a dry run spawns nothing at all, including `codex --version`.
const codexBin = () => process.env.DONNY_CODEX_BIN || 'codex';

/**
 * The envelope. A dry run reports status null rather than a seventh status value: the D-02
 * enum is locked at six, all six describe a completed spawn, and a run that spawned nothing
 * has no verdict about itself - the same reading schema_valid: null already has.
 */
function dryRunEnvelope({ mode, argv, cfg, spawnCwd, cd, outPath, opts, threadId }) {
  return {
    mode,
    status: null,
    dry_run: true,
    bin: codexBin(),
    argv: [...argv],
    codex_version: null,
    spawn_stdin: 'ignore',
    spawn_cwd: spawnCwd,
    spawn_timeout_ms: cfg.timeoutMs,
    spawn_max_buffer: MAX_SPAWN_BUFFER,
    verdict_out: opts.verdictOut || null,
    proofs_recorded_against: PROOFS_RECORDED_AGAINST,
    resolved: {
      cd,
      // The canonical form travels beside the argv value rather than replacing it, so a
      // --cd reached through a symlink is visible without rewriting what the caller wrote.
      cd_real: cd === null ? null : realOf(cd),
      model: cfg.model,
      effort: cfg.effort,
      schema: opts.schema || null,
      out: outPath,
      prompt: argv[argv.length - 1],
      thread_id: threadId,
    },
  };
}

/** `donny-tools codex run [--cd <dir>] --prompt-file <p> [--schema <p>] [--verdict-out <p>] [--dry-run]` */
function cmdCodexRun(cwd, argv, raw) {
  const opts = parseCodexOpts(argv);
  const cfg = resolveCodexConfig(cwd);
  const cd = resolveCd(opts.cd, cwd);
  const prompt = resolvePrompt(opts.promptFile);
  const outPath = allocOutPath();
  const argvOut = buildCreateArgv({
    cd, model: cfg.model, effort: cfg.effort, schemaPath: opts.schema, outPath, prompt,
  });
  if (opts.dryRun) {
    // The child runs in the root it pinned with -C, so the two agree by construction and
    // T-25-05's mitigation is a property of the spawn rather than of the caller's luck.
    output(dryRunEnvelope({
      mode: 'run', argv: argvOut, cfg, spawnCwd: cd, cd, outPath, opts, threadId: null,
    }), raw);
    return;
  }
  error('codex run: live invocation lands in plan 25-04');
}

/** `donny-tools codex resume <thread_id> [--cd <dir>] --prompt-file <p> ... [--dry-run]` */
function cmdCodexResume(cwd, threadId, argv, raw) {
  if (!threadId || threadId.startsWith('-')) error('codex resume: thread id required');
  const opts = parseCodexOpts(argv);
  const cfg = resolveCodexConfig(cwd);
  // --cd is accepted here and moves the SPAWN cwd, never the argv: `exec resume` has no -C
  // at 0.153.4, and Proof D measured that a resumed turn does not inherit the creating
  // turn's root either - it uses the calling process's cwd. So this is the only lever over
  // a resumed round's working root, and refusing the option would leave that root implicit.
  const spawnCwd = resolveCd(opts.cd, cwd);
  const prompt = resolvePrompt(opts.promptFile);
  const outPath = allocOutPath();
  const argvOut = buildResumeArgv({
    threadId, model: cfg.model, effort: cfg.effort, schemaPath: opts.schema, outPath, prompt,
  });
  if (opts.dryRun) {
    output(dryRunEnvelope({
      mode: 'resume', argv: argvOut, cfg, spawnCwd, cd: null, outPath, opts, threadId,
    }), raw);
    return;
  }
  error('codex resume: live invocation lands in plan 25-04');
}

module.exports = {
  ALLOWED_CREATE_FLAGS, ALLOWED_RESUME_FLAGS, ALLOWED_C_KEYS,
  FORBIDDEN_FLAGS, FORBIDDEN_C_PREFIXES,
  PROOFS_RECORDED_AGAINST, MAX_PROMPT_BYTES, MAX_SPAWN_BUFFER,
  resolveCodexConfig, buildCreateArgv, buildResumeArgv, assertArgvSafe,
  resolvePrompt, resolveCd, parseCodexOpts, cmdCodexRun, cmdCodexResume,
};
