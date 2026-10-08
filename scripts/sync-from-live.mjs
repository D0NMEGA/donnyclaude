#!/usr/bin/env node
// Make the package mirror the live ~/.claude harness.
//
// For every component the installer owns (same list as COMPONENT_DIRS in bin/donnyclaude.js):
//   - live files are copied into packages/<component> (new files are adopted, changed files updated)
//   - package files with no live counterpart are moved to packages/_archived/<component>/
//     so a fresh install reproduces the live tree instead of re-adding retired items.
// Plus the two single files the installer treats specially: core/CLAUDE.md and core/statusline.py.
//
// Dry run by default; pass --apply to write. Never touches ~/.claude.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE_HOME = join(process.env.HOME, '.claude');
const APPLY = process.argv.includes('--apply');
const COMPONENTS = ['skills', 'agents', 'rules', 'donny', 'hooks', 'commands', 'bin', 'cco-memory', 'scrapers'];
const SINGLE_FILES = [['CLAUDE.md', 'core/CLAUDE.md'], ['statusline.py', 'core/statusline.py']];
// These two hold runtime state next to their code (dream journals, instinct data, caches):
// only files the package already ships are updated; nothing new is adopted or archived.
const TRACKED_ONLY = new Set(['cco-memory', 'scrapers']);
// Plugin-mode artifacts the live install never uses; the package copy is the source of truth.
const PACKAGE_WINS = new Set(['hooks/hooks.json']);
// Not part of the package: claude.ai synced skills, caches, editor backups, local-only state.
const IGNORE_DIRS = new Set(['synced', '__pycache__', 'node_modules', '.git']);
const IGNORE_FILE = /(^\.|\.bak(?:[-.]|$)|\.pyc$|\.DS_Store$|\.orig$|\.rej$)/;

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) out.push(...walk(join(dir, e.name), base));
    } else if (!IGNORE_FILE.test(e.name)) {
      out.push(relative(base, join(dir, e.name)));
    }
  }
  return out;
}

// The installer rewrites one frontmatter key in every SKILL.md at install time
// (disable-model-invocation, from settings.json skills.autoInvoke), so that key alone is not drift.
function normalized(path) {
  const buf = readFileSync(path);
  if (!path.endsWith('SKILL.md')) return buf;
  return Buffer.from(buf.toString('utf-8').replace(/^disable-model-invocation:.*\n/m, ''));
}

function same(a, b) {
  return existsSync(a) && existsSync(b) && normalized(a).equals(normalized(b));
}

function pruneEmpty(dir, stop) {
  while (dir !== stop && existsSync(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir);
    dir = dirname(dir);
  }
}

const totals = { adopted: 0, updated: 0, archived: 0, unchanged: 0 };
for (const comp of COMPONENTS) {
  const liveDir = join(CLAUDE_HOME, comp);
  const pkgDir = join(ROOT, 'packages', comp);
  const live = new Set(walk(liveDir));
  const pkg = new Set(walk(pkgDir));
  for (const rel of live) {
    const src = join(liveDir, rel);
    const dst = join(pkgDir, rel);
    if (same(src, dst) || PACKAGE_WINS.has(`${comp}/${rel}`)) { totals.unchanged++; continue; }
    if (TRACKED_ONLY.has(comp) && !pkg.has(rel)) continue;
    const kind = pkg.has(rel) ? 'updated' : 'adopted';
    totals[kind]++;
    console.log(`${kind.padEnd(8)} ${comp}/${rel}`);
    if (APPLY) { mkdirSync(dirname(dst), { recursive: true }); cpSync(src, dst, { preserveTimestamps: true }); }
  }
  for (const rel of pkg) {
    if (live.has(rel) || TRACKED_ONLY.has(comp)) continue;
    totals.archived++;
    console.log(`archived ${comp}/${rel}`);
    if (APPLY) {
      const from = join(pkgDir, rel);
      const to = join(ROOT, 'packages', `_archived-${comp}`, rel);
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
      pruneEmpty(dirname(from), pkgDir);
    }
  }
}
for (const [liveRel, pkgRel] of SINGLE_FILES) {
  const src = join(CLAUDE_HOME, liveRel);
  const dst = join(ROOT, 'packages', pkgRel);
  if (!existsSync(src)) continue;
  if (same(src, dst)) { totals.unchanged++; continue; }
  totals[existsSync(dst) ? 'updated' : 'adopted']++;
  console.log(`${existsSync(dst) ? 'updated ' : 'adopted '} ${pkgRel}`);
  if (APPLY) { mkdirSync(dirname(dst), { recursive: true }); cpSync(src, dst, { preserveTimestamps: true }); }
}
const mode = APPLY ? 'applied' : 'dry run (pass --apply to write)';
console.log(`\n${mode}: ${totals.adopted} adopted, ${totals.updated} updated, ${totals.archived} archived, ${totals.unchanged} unchanged`);
