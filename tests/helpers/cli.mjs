/**
 * Driving donny-tools.cjs as a subprocess.
 *
 * error() (core.cjs:202-205) writes to fd 2 and calls process.exit(1), and output()
 * writes with fs.writeSync(1, ...), so neither is observable in-process. Every test
 * that needs an exit code or a stderr message goes through here.
 *
 * Extracted from verify-gate.test.js (:1373 runTools, :2135 withConfigFixture,
 * :2157 configGetIdiom) so config-merge.test.js reuses one copy instead of a second.
 *
 * Scope: SUBPROCESSES only. A test that calls loadConfig in-process (plan 24-06) is
 * not covered by the hermetic default below and must pin process.env.DONNY_HOME
 * itself in a before(), restoring it in an after().
 */

import fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..', '..');
export const TOOLS = resolve(ROOT, 'packages/donny/bin/donny-tools.cjs');

/**
 * An empty throwaway directory, created once at module load, used as the DEFAULT
 * DONNY_HOME for every child process this module launches.
 *
 * Without it the suite reads the operator's real ~/.donny/defaults.json. That is
 * inert while the file is {}, but Phase 24 makes the global layer live on both read
 * paths and plan 24-09 deliberately populates that file across a blocking human
 * checkpoint. A test result that depends on unmanaged machine state is a latent flake,
 * so the default is hermetic and a caller that wants the real file, or a populated
 * fixture, passes DONNY_HOME explicitly and wins.
 *
 * It is left on disk. It is empty, it is in the OS temp dir, and reaping it in a
 * process-exit hook would race the subprocesses that reference it.
 */
export const HERMETIC_DONNY_HOME = join(
  tmpdir(),
  'donny-hermetic-home-' + process.pid + '-' + Math.random().toString(36).slice(2),
);
fs.mkdirSync(HERMETIC_DONNY_HOME, { recursive: true });

/**
 * Merge caller env over process.env, with the hermetic DONNY_HOME as the default.
 *
 * The asymmetry is deliberate: an inherited DONNY_HOME from the parent shell is
 * overridden, so DONNY_HOME=/somewhere npm test cannot change what the suite proves,
 * while a DONNY_HOME the caller passed for this specific call still wins. A caller
 * value of undefined deletes the key outright, which is how a test clears an API key
 * env var, or deliberately lets a child see the operator's real ~/.donny.
 */
const childEnvFor = (env) => {
  const merged = { DONNY_HOME: HERMETIC_DONNY_HOME, ...process.env, ...(env || {}) };
  // process.env wins over the hermetic default only if the caller set it explicitly
  // for this call; an inherited DONNY_HOME from the parent shell must NOT leak in.
  if (!(env && 'DONNY_HOME' in env)) merged.DONNY_HOME = HERMETIC_DONNY_HOME;
  for (const [k, v] of Object.entries(env || {})) if (v === undefined) delete merged[k];
  return merged;
};

/**
 * Run donny-tools in a fixture root and return { status, stdout, stderr }.
 *
 * spawnSync, not execFileSync: execFileSync returns only stdout on success and pipes the
 * child's stderr straight to the parent, so a command that WARNS and still exits 0 had an
 * unobservable stderr. Plan 24-04's D-04 warn-and-continue tests need exactly that case.
 * spawnSync also does not throw on a non-zero exit, so both outcomes take one path.
 *
 * @param {string} cwd  project root to run in
 * @param {string[]} argv  arguments after the binary
 * @param {object} [env]  extra environment, merged over process.env. Pass
 *   { DONNY_HOME: dir } to redirect the global defaults directory; an explicit value
 *   wins over the hermetic default. A value of undefined for a key deletes it, so a
 *   test can clear BRAVE_API_KEY. Omit it and the child sees an empty global dir.
 */
export const runTools = (cwd, argv, env) => {
  const childEnv = childEnvFor(env);
  const r = spawnSync(process.execPath, [TOOLS, ...argv], { cwd, encoding: 'utf-8', env: childEnv });
  // status is null when the child was killed by a signal or never spawned at all.
  return { status: r.status === null || r.status === undefined ? -1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};

/** A throwaway project root carrying only .planning/, optionally with a config.json. */
export const withConfigFixture = (config, fn) => {
  const root = join(
    tmpdir(),
    'donny-cfg-' + Date.now() + '-' + Math.random().toString(36).slice(2),
  );
  fs.mkdirSync(join(root, '.planning'), { recursive: true });
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

/**
 * The exact shell idiom every workflow uses to read an optional config key:
 *   config-get <key> --raw 2>/dev/null || echo "<literal>"
 *
 * TOOLS and fallback are quoted through JSON.stringify. key is interpolated bare, as it
 * was before the extraction; every caller passes a source-controlled literal from the
 * measured key table. Do not pass a computed value here without quoting it.
 *
 * @param {string} root
 * @param {string} key
 * @param {string} [fallback='true']  the literal that key's read sites actually use
 * @param {object} [env]  extra environment, same semantics as runTools, including the
 *   hermetic DONNY_HOME default
 */
export const configGetIdiom = (root, key, fallback = 'true', env) => {
  const childEnv = childEnvFor(env);
  return execSync(
    `node ${JSON.stringify(TOOLS)} config-get ${key} --raw 2>/dev/null || echo ${JSON.stringify(fallback)}`,
    { cwd: root, encoding: 'utf-8', env: childEnv },
  ).trim();
};
