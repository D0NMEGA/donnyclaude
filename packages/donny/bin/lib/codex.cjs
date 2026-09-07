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
 *
 * One recorded weakness, stated rather than hidden: the `auth` and `quota` arms of the
 * classifier are string matches over `turn.failed.error.message`, because the exec JSONL
 * carries no machine-readable error code at all - `ThreadErrorEvent { message: String }` is
 * the entire shape at rust-v0.153.4 (Grade A). See AUTH_RE and `classify`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
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

// ─── Reading the result ───────────────────────────────────────────────────────

/**
 * The failure vocabulary, Grade A from `codex-rs/protocol/src/error.rs` at rust-v0.153.4.
 * Deliberately broad, because these are model-facing UI strings that will drift.
 *
 * Two of the eleven recorded strings are deliberately NOT matched. 25-01 pinned the seven that
 * are not in question and left this call to 25-04; it is made here.
 * `To use Codex with your ChatGPT plan, upgrade to Plus` is `UsageNotIncluded`, an entitlement
 * failure rather than an exhausted quota - waiting does not help, so `quota` would mislead the
 * caller and `nonzero` plus the verbatim terminal_message is honest.
 * `exceeded retry limit, last status: <code>` is `RetryLimitReached`, whose meaning depends on
 * that code: the 429 case is already caught by the `429` token below, and a 5xx case really is
 * a transient failure rather than a quota one. Widening for either would mandate a looser
 * regex than the research proposed and buy nothing, since `terminal_message` carries the exact
 * reason in the envelope either way.
 */
const AUTH_RE = /\b401\b|Unauthorized|Missing bearer|refresh token|not logged in|codex login/i;
const QUOTA_RE = /usage limit|out of credits|spend cap|Quota exceeded|rate limit|429/i;

// A model-authored file is untrusted input, so the read is capped. An unbounded read of
// untrusted input is the wrong default even though nothing plausible produces 8 MiB of verdict.
const MAX_VERDICT_BYTES = 8 * 1024 * 1024;

/**
 * Parse the `--json` event stream into the four things the contract needs from it.
 *
 * An unparseable line is SKIPPED rather than fatal: `--json` writes JSONL to stdout while the
 * tracing layer writes to stderr (Grade A, `lib.rs:239-243`), so stdout should be clean, but a
 * future event variant must not break the contract.
 *
 * @returns {{events: object[], sessionId: string|null, terminal: object|null, usage: object|null, agentMessages: string[]}}
 */
function parseEvents(stdoutText) {
  const events = [];
  for (const line of String(stdoutText || '').split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* not an event we understand; skip it */ }
  }
  // thread.started arrives before the model is contacted at all: the recorded unauthenticated
  // run produced it even though auth failed, which is why a session id survives a failure.
  const started = events.find((e) => e && e.type === 'thread.started');
  // The LAST terminal event, never the first `error`. The recorded fixture emits ten `error`
  // events of retry chatter (`Reconnecting... 2/5`) and only the final `turn.failed` carries
  // the real reason (Grade A). A classifier reading the first one reports the chatter.
  let terminal = null;
  for (const e of events) {
    if (e && (e.type === 'turn.failed' || e.type === 'turn.completed')) terminal = e;
  }
  return {
    events,
    sessionId: started ? started.thread_id || null : null,
    terminal,
    usage: terminal && terminal.type === 'turn.completed' ? terminal.usage || null : null,
    // Collected ONLY so the SEAM-05 test can prove the verdict is not taken from here. Never
    // used to produce a verdict; see the comment at readVerdict for why that is load-bearing.
    agentMessages: events
      .filter((e) => e && e.type === 'item.completed' && e.item && e.item.type === 'agent_message')
      .map((e) => e.item.text),
  };
}

/**
 * The one spawn. Single-shot at this layer (D-04); `codex exec` runs its own retry ladder
 * underneath - five WebSocket attempts then five HTTPS, about 15 s to a terminal auth failure
 * (Grade A) - which is why the default bound is generous rather than tight.
 *
 * @returns {object} the raw spawnSync result plus a measured `duration_ms`
 */
function runCodex({ bin, argv, cwd, timeoutMs }) {
  const t0 = Date.now();
  const r = spawnSync(bin, argv, {
    // Proof D: `exec resume` accepts no -C and does NOT inherit the creating turn's root -
    // both resumed turns recorded the CALLING process's cwd. On that path this option is the
    // only thing that puts the reviewer in the right directory, and nothing in the argv would
    // reveal it if it were left off.
    cwd,
    // RECORD-01. Note for the next reader: spawnSync with stdio[0]='pipe' and no `input` does
    // not actually hang, because Node closes the child's stdin immediately (measured, Grade A).
    // 'ignore' is pinned anyway because it is the correct value under spawn, exec and execSync
    // too, and it does not depend on that Node implementation detail. The hang at
    // review.md:144 was a shell invocation inheriting an open pipe, and `codex exec` blocks in
    // read_to_end until EOF whenever stdin is not a TTY.
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
    encoding: 'utf-8',
    // Pitfall 1: the default is 1 MiB and exceeding it produces status null + SIGTERM +
    // ENOBUFS, which is indistinguishable from a timeout to a classifier that only checks
    // status and signal. 64 MiB is cheap and a --json review stream is nowhere near it.
    maxBuffer: MAX_SPAWN_BUFFER,
  });
  // `status` is NOT coerced here. Two precedents both coerce it with a nullish default:
  // core.cjs execGit defaults a null status to 1, and openai/codex-plugin-cc's process.mjs
  // defaults it to 0, which turns a signal-kill into a success. The first is the safer of the
  // two and still collapses a timeout into an exit code. This contract keeps status, signal and
  // error.code distinct, because that triple is exactly what tells a timeout, an over-buffer
  // and a missing binary apart.
  return { ...r, duration_ms: Date.now() - t0 };
}

/**
 * The six-value D-02 status, plus a human note for the cases where silence would hide the
 * reason. Order matters: `error.code` is read first, because a timeout and an over-buffer both
 * arrive as status null + SIGTERM and only `error.code` separates them.
 *
 * @returns {{status: 'ok'|'auth'|'quota'|'timeout'|'empty'|'nonzero', note: string|null}}
 */
function classify(r, outPath, terminal) {
  const code = r.error ? r.error.code : null;
  if (code === 'ENOENT') return { status: 'nonzero', note: `the codex binary was not found at ${r.error.path || codexBin()}` };
  if (code === 'ETIMEDOUT') return { status: 'timeout', note: null };
  if (code === 'ENOBUFS') {
    // NOT timeout. Pitfall 1, and the whole reason error.code is read before status.
    return { status: 'nonzero', note: `ENOBUFS: the child wrote past the ${MAX_SPAWN_BUFFER}-byte stdout bound and was killed. This is an over-buffer, not a timeout.` };
  }
  if (code) return { status: 'nonzero', note: `spawn failed with ${code}` };
  if (r.status === 0) {
    if (!fs.existsSync(outPath)) {
      // The CLI's own invariant says this cannot happen: the -o file is written on every
      // TurnStatus::Completed. Being loud beats reporting a review nobody wrote.
      return { status: 'nonzero', note: `codex exited 0 but wrote no --output-last-message file at ${outPath}` };
    }
    return fs.statSync(outPath).size === 0
      ? { status: 'empty', note: 'codex completed with no agent message; the output file is zero bytes' }
      : { status: 'ok', note: null };
  }
  // AUTH_RE is tested before QUOTA_RE because the auth string contains 401 and no quota string
  // does, so the order is stable rather than incidental.
  const msg = (terminal && terminal.error && terminal.error.message) || '';
  if (AUTH_RE.test(msg)) return { status: 'auth', note: null };
  if (QUOTA_RE.test(msg)) return { status: 'quota', note: null };
  return { status: 'nonzero', note: null };
}

/**
 * SEAM-05. The verdict comes from the --output-last-message file and from nowhere else.
 * openai/codex#19816 is OPEN and a maintainer stated on 2026-04-28 that it cannot be fixed in
 * the harness: with --output-schema set, EVERY assistant message in the sampling loop is
 * schema-shaped, so an intermediate progress note parses as a valid final result. parseEvents
 * collects agentMessages only so a test can prove they are not used here. Do not "optimise"
 * this function into reading the agent message it already has in memory.
 *
 * @returns {{text: string|null, chars: number, truncated: boolean}}
 */
function readVerdict(outPath) {
  let size;
  try { size = fs.statSync(outPath).size; } catch { return { text: null, chars: 0, truncated: false }; }
  if (size <= MAX_VERDICT_BYTES) {
    const text = fs.readFileSync(outPath, 'utf-8');
    return { text, chars: text.length, truncated: false };
  }
  const fd = fs.openSync(outPath, 'r');
  const buf = Buffer.alloc(MAX_VERDICT_BYTES);
  try { fs.readSync(fd, buf, 0, MAX_VERDICT_BYTES, 0); } finally { fs.closeSync(fd); }
  warnOnce('verdict-size', `the verdict file ${outPath} is ${size} bytes, over the ` +
    `${MAX_VERDICT_BYTES}-byte cap. Reading the first ${MAX_VERDICT_BYTES} bytes only.`);
  const text = buf.toString('utf-8');
  return { text, chars: text.length, truncated: true };
}

/**
 * Check a verdict against the three properties the probe schema exercises: required keys
 * present, enum members legal, and no extra keys under `additionalProperties: false`.
 *
 * Hand-rolled, with no npm dependency, because the engine ships zero runtime dependencies and
 * that property is worth more here than generality. It is also the OpenAI maintainer's own
 * recommendation on the closed openai/codex#15451: "If you need to work around the problem in
 * your use case, you can wrap the call to `codex exec` with schema validation logic."
 *
 * The result reaches the envelope as `schema_valid`, a SEPARATE additive field, and never as a
 * seventh `status`. D-02's enum is locked at ok/auth/quota/timeout/empty/nonzero and a schema
 * violation is orthogonal to all six: a run can be a complete success at the transport layer
 * and still return the wrong shape. Do not fold this into `status` later.
 *
 * A parse failure is a recorded violation rather than a throw, because the file is
 * model-authored: untrusted input must not be able to end the process. The body is never
 * eval'd and never selects a code path.
 *
 * @returns {{valid: boolean|null, violations: string[]}}
 */
function validateAgainstSchema(text, schemaPath) {
  if (!schemaPath) return { valid: null, violations: [] };
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  } catch (err) {
    return { valid: false, violations: [`schema unreadable at ${schemaPath}: ${err.message}`] };
  }
  let value;
  try {
    value = JSON.parse(String(text));
  } catch {
    return { valid: false, violations: ['verdict is not valid JSON'] };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, violations: ['verdict is not a JSON object'] };
  }
  const props = schema.properties || {};
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const violations = [];
  for (const key of schema.required || []) {
    if (!has(value, key)) violations.push(`missing required key: ${key}`);
  }
  for (const [key, spec] of Object.entries(props)) {
    if (!spec || !Array.isArray(spec.enum) || !has(value, key)) continue;
    if (!spec.enum.includes(value[key])) {
      violations.push(`illegal enum value for ${key}: ${JSON.stringify(value[key])}`);
    }
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!has(props, key)) violations.push(`unexpected key: ${key}`);
    }
  }
  return { valid: violations.length === 0, violations };
}

// ─── The verb ─────────────────────────────────────────────────────────────────

// One test seam so the suite can substitute a fake binary; no shipped workflow sets it.
// Never probed: a dry run spawns nothing at all, including `codex --version`.
const codexBin = () => process.env.DONNY_CODEX_BIN || 'codex';

/**
 * D-16. Stamp the running CLI on every result and warn once when it has drifted from the
 * version 25-PROBES.md was recorded against. Never hard-errors, never changes `status`, and a
 * failure of the probe itself is recorded as null rather than propagated (Phase 24 D-04's
 * posture). The CLI moved 0.151.0 to 0.153.4 in four days, so stale evidence must be visible
 * rather than assumed, and a hard error would make a routine upgrade break every review.
 *
 * @returns {{observed: string|null, drift: boolean}}
 */
function observeVersion(bin) {
  // 11 ms on this machine. Its own short bound, so a hung probe cannot eat the review's.
  const r = spawnSync(bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 10000 });
  if (r.error || r.status !== 0) return { observed: null, drift: false };
  const observed = String(r.stdout || '').trim();
  const m = observed.match(/codex-cli\s+(\S+)/);
  const version = m ? m[1] : observed;
  if (version === PROOFS_RECORDED_AGAINST) return { observed, drift: false };
  warnOnce('version-drift', `codex version drift: the proofs in 25-PROBES.md were recorded ` +
    `against codex-cli ${PROOFS_RECORDED_AGAINST}, this run observed ${version}. Re-run the ` +
    `probes if behaviour looks wrong.`);
  return { observed, drift: true };
}

/**
 * The envelope, one shape for a dry run and a live one. A dry run reports status null rather
 * than a seventh status value: the D-02 enum is locked at six, all six describe a completed
 * spawn, and a run that spawned nothing has no verdict about itself - the same reading
 * schema_valid: null already has. The live path spreads its result over this base, so the two
 * surfaces cannot drift apart field by field.
 */
function buildEnvelope({ mode, argv, cfg, spawnCwd, cd, outPath, opts, threadId }) {
  return {
    mode,
    status: null,
    dry_run: true,
    bin: codexBin(),
    argv: [...argv],
    codex_version: null,
    version_drift: false,
    verdict: null,
    verdict_path: outPath,
    verdict_chars: 0,
    verdict_truncated: false,
    verdict_out: opts.verdictOut || null,
    verdict_out_written: false,
    schema_valid: null,
    schema_errors: [],
    session_id: null,
    terminal_message: null,
    usage: null,
    // D-02 asks for the rate_limits block "when Codex emits one". At codex-cli 0.153.4
    // `codex exec` emits none: `rate_limit` and `RateLimitSnapshot` appear nowhere in the
    // codex-rs/exec crate at tag rust-v0.153.4. UsageLimitReachedError carries plan_type,
    // resets_at and a rate_limits snapshot, but only its Display string survives into exec,
    // flattened as "{message} ({details})". So this field is null today and terminal_message
    // carries the raw string verbatim. Phase 26's CRITIC-05 reads a usage window from this
    // block; that is recorded as a named condition in 25-PROBES.md section 8.
    rate_limits: null,
    // Best effort only, and never parsed into a timestamp: it is one capture out of a
    // model-facing UI string, offered because a caller that hit a usage limit wants it.
    resets_at_text: null,
    note: null,
    exit_status: null,
    signal: null,
    error_code: null,
    duration_ms: null,
    spawn_stdin: 'ignore',
    spawn_cwd: spawnCwd,
    spawn_timeout_ms: cfg.timeoutMs,
    spawn_max_buffer: MAX_SPAWN_BUFFER,
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

/**
 * The live half, shared by both verbs: everything after the argv is identical on create and
 * resume, which is D-07's point - Phase 26 inherits a tested path rather than an untested one.
 *
 * The process exits 0 whenever an envelope was produced, including on every failure status. The
 * posture is advisory (Phase 23 D-02): nothing about Codex may block a run, and the caller
 * reads `status`, or `--pick status` when the body is large enough for output() to divert it to
 * an @file: payload. A non-zero exit would let a failed review kill the workflow that asked
 * for it, which is the opposite of RECORD-02's intent.
 */
function executeCodex({ mode, argv, cfg, spawnCwd, cd, outPath, opts, threadId, raw }) {
  const bin = codexBin();
  // Both destinations are cleared BEFORE the spawn. The -o path is fresh per call, so that one
  // is belt and braces; --verdict-out is the caller's and is stable across runs by design, and
  // a stale or empty file at a stable path reading as a clean review is the exact defect
  // RECORD-02 exists to close.
  fs.rmSync(outPath, { force: true });
  if (opts.verdictOut) fs.rmSync(opts.verdictOut, { force: true });

  const version = observeVersion(bin);
  const r = runCodex({ bin, argv, cwd: spawnCwd, timeoutMs: cfg.timeoutMs });
  // Forwarded verbatim, never swallowed. This is what `2>/dev/null` at review.md:144 was
  // discarding, including the one line that says why a run failed.
  if (r.stderr) process.stderr.write(r.stderr);

  const parsed = parseEvents(r.stdout);
  const { status, note } = classify(r, outPath, parsed.terminal);
  if (note) process.stderr.write(`donny-tools: codex: ${note}\n`);

  const verdict = status === 'ok' ? readVerdict(outPath) : { text: null, chars: 0, truncated: false };
  // RECORD-02 at the caller's boundary: written ONLY on ok. Not on empty, not on any failure.
  // That is what makes a contentless run impossible to render as a clean review, and it makes
  // the presence of the file itself the ok signal.
  const wroteOut = status === 'ok' && Boolean(opts.verdictOut);
  if (wroteOut) fs.writeFileSync(opts.verdictOut, verdict.text);

  // Only an ok run has a shape to have an opinion about. Anything else reports null, the same
  // reading a missing --schema gets: no verdict was produced, so none is judged.
  const schema = status === 'ok'
    ? validateAgainstSchema(verdict.text, opts.schema || null)
    : { valid: null, violations: [] };

  const terminalMessage = parsed.terminal
    ? (parsed.terminal.error && parsed.terminal.error.message) || null
    : null;
  const resets = terminalMessage && terminalMessage.match(/Try again at ([^.]+)\./);

  output({
    ...buildEnvelope({ mode, argv, cfg, spawnCwd, cd, outPath, opts, threadId }),
    status,
    dry_run: false,
    codex_version: version.observed,
    version_drift: version.drift,
    verdict: verdict.text,
    verdict_chars: verdict.chars,
    verdict_truncated: verdict.truncated,
    verdict_out_written: wroteOut,
    schema_valid: schema.valid,
    schema_errors: schema.violations,
    session_id: parsed.sessionId,
    terminal_message: terminalMessage,
    usage: parsed.usage,
    resets_at_text: resets ? resets[1] : null,
    note,
    exit_status: r.status,
    signal: r.signal,
    error_code: r.error ? r.error.code : null,
    duration_ms: r.duration_ms,
  }, raw);
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
  // The child runs in the root it pinned with -C, so the two agree by construction and
  // T-25-05's mitigation is a property of the spawn rather than of the caller's luck.
  const shared = { mode: 'run', argv: argvOut, cfg, spawnCwd: cd, cd, outPath, opts, threadId: null };
  if (opts.dryRun) {
    output(buildEnvelope(shared), raw);
    return;
  }
  executeCodex({ ...shared, raw });
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
  const shared = { mode: 'resume', argv: argvOut, cfg, spawnCwd, cd: null, outPath, opts, threadId };
  if (opts.dryRun) {
    output(buildEnvelope(shared), raw);
    return;
  }
  executeCodex({ ...shared, raw });
}

module.exports = {
  ALLOWED_CREATE_FLAGS, ALLOWED_RESUME_FLAGS, ALLOWED_C_KEYS,
  FORBIDDEN_FLAGS, FORBIDDEN_C_PREFIXES,
  PROOFS_RECORDED_AGAINST, MAX_PROMPT_BYTES, MAX_SPAWN_BUFFER,
  resolveCodexConfig, buildCreateArgv, buildResumeArgv, assertArgvSafe,
  resolvePrompt, resolveCd, parseCodexOpts,
  parseEvents, runCodex, classify, readVerdict, validateAgainstSchema, observeVersion,
  cmdCodexRun, cmdCodexResume,
};
