#!/usr/bin/env node

import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const CLAUDE_HOME = join(homedir(), '.claude');
const IS_WIN = platform() === 'win32';
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version;

// Only these commands are allowed in shell execution -- never pass user input
const SAFE_COMMANDS = new Set(['node', 'npm', 'claude', 'npx']);

// WS-1 Path B: the top-K skills that get disable-model-invocation: false at install
// time. Every other skill is marked disable-model-invocation: true, keeping it
// invokable by name via the runtime manifest but out of the always-loaded catalog.
// User can override per-skill via settings.json skills.autoInvoke.
// Rotation logic is deferred to a later enhancement; this is the safe static default.
const DEFAULT_TOP_K_AUTOINVOKE_SKILLS = Object.freeze([
  'gsd-new-project',
  'gsd-new-milestone',
  'gsd-plan-phase',
  'gsd-discuss-phase',
  'gsd-execute-phase',
  'gsd-autonomous',
  'gsd-progress',
  'gsd-next',
  'gsd-verify-work',
  'gsd-ship',
]);

// ── Branding ────────────────────────────────────────────────────────────────

const BANNER = `
\x1b[1;31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m
\x1b[1;37m  DonnyClaude v${VERSION}\x1b[0m
\x1b[2m  Power-user setup for Claude Code\x1b[0m
\x1b[1;31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m
`;

// ── Helpers ─────────────────────────────────────────────────────────────────

function ok(msg) { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); }
function warn(msg) { console.log(`  \x1b[33m!\x1b[0m ${msg}`); }
function info(msg) { console.log(`  \x1b[2m${msg}\x1b[0m`); }
function heading(msg) { console.log(`\n\x1b[1m${msg}\x1b[0m`); }

/** Shell-safe command execution -- only whitelisted commands allowed */
function commandExists(cmd) {
  if (!SAFE_COMMANDS.has(cmd)) throw new Error(`Unsafe command: ${cmd}`);
  try {
    execSync(IS_WIN ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Shell-safe version check -- only whitelisted commands allowed */
function getVersion(cmd, flag = '--version') {
  if (!SAFE_COMMANDS.has(cmd)) throw new Error(`Unsafe command: ${cmd}`);
  try {
    return execSync(`${cmd} ${flag}`, { encoding: 'utf-8' }).trim().split('\n')[0];
  } catch {
    return null;
  }
}

function countItems(dir) {
  try {
    return readdirSync(dir).filter(f => !f.startsWith('.')).length;
  } catch {
    return 0;
  }
}

/** Safe JSON parse with error message */
function safeParseJSON(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    fail(`Failed to parse ${label}: ${filePath}`);
    info(`  Error: ${err.message}`);
    return null;
  }
}

// ── Phase 1: Prerequisites ──────────────────────────────────────────────────

function checkPrerequisites() {
  heading('Checking prerequisites...');

  let allGood = true;

  // Node.js
  const nodeVer = getVersion('node');
  if (nodeVer) {
    const major = parseInt(nodeVer.replace(/^v/, ''), 10);
    if (major >= 20) {
      ok(`Node.js ${nodeVer}`);
    } else {
      fail(`Node.js ${nodeVer} -- need v20+`);
      info('  Update: https://nodejs.org/en/download');
      allGood = false;
    }
  } else {
    fail('Node.js not found');
    info('  Install: https://nodejs.org/en/download');
    allGood = false;
  }

  // npm
  const npmVer = getVersion('npm');
  if (npmVer) {
    ok(`npm ${npmVer}`);
  } else {
    fail('npm not found');
    allGood = false;
  }

  // Claude Code
  const claudeVer = getVersion('claude');
  if (claudeVer) {
    ok(`Claude Code ${claudeVer}`);
  } else {
    info('Claude Code not found -- installing...');
    try {
      execSync('npm install -g @anthropic-ai/claude-code', {
        stdio: 'inherit',
      });
      const newVer = getVersion('claude');
      if (newVer) {
        ok(`Claude Code ${newVer} installed`);
      } else {
        fail('Claude Code install succeeded but command not found');
        info('  Try: npm install -g @anthropic-ai/claude-code');
        allGood = false;
      }
    } catch (err) {
      fail('Failed to install Claude Code');
      if (err.message?.includes('EACCES') || err.message?.includes('permission')) {
        info('  Try: sudo npm install -g @anthropic-ai/claude-code');
      } else {
        info('  Manual install: npm install -g @anthropic-ai/claude-code');
      }
      allGood = false;
    }
  }

  return allGood;
}

// ── Phase 2: Install Global Tools ───────────────────────────────────────────

function installGlobalTools() {
  heading('Installing DonnyClaude toolkit...');

  // Warn if existing ~/.claude/ has content
  if (existsSync(CLAUDE_HOME) && countItems(CLAUDE_HOME) > 0) {
    warn('Existing ~/.claude/ detected -- DonnyClaude will add/update files but preserve your settings');
  }

  mkdirSync(CLAUDE_HOME, { recursive: true });

  const components = [
    { name: 'skills', src: 'skills', dest: 'skills', showCount: true },
    { name: 'agents', src: 'agents', dest: 'agents', showCount: true },
    { name: 'rules', src: 'rules', dest: 'rules', label: 'Rules installed (common + language-specific)' },
    { name: 'GSD workflow engine', src: 'gsd', dest: 'get-shit-done' },
    { name: 'hooks', src: 'hooks', dest: 'hooks' },
    { name: 'commands', src: 'commands', dest: 'commands' },
  ];

  for (const comp of components) {
    const src = join(ROOT, 'packages', comp.src);
    const dest = join(CLAUDE_HOME, comp.dest);
    if (existsSync(src)) {
      cpSync(src, dest, { recursive: true, force: true });
      if (comp.showCount) {
        ok(`${countItems(src)} ${comp.name} installed`);
      } else {
        ok(comp.label ?? `${comp.name} installed`);
      }
      // Build the skill-index registry during the same install pass.
      // This powers WS-1 progressive disclosure (skills referenced by name,
      // loaded on demand by Claude Code) instead of always-loaded blobs.
      if (comp.name === 'skills') {
        const topK = new Set(DEFAULT_TOP_K_AUTOINVOKE_SKILLS);
        const userOverrides = loadUserAutoInvokeOverrides();
        writeSkillIndex(src, topK, userOverrides);
        // Pass the source skills directory so applyInvocationFlags can scope
        // strictly to donnyclaude-shipped skills. Without this, the function
        // would walk the entire ~/.claude/skills/ tree and accidentally
        // disable plugin or third-party skills the user installed elsewhere.
        applyInvocationFlags(join(CLAUDE_HOME, 'skills'), src, topK, userOverrides);
      }
    } else {
      info(`${comp.name} not found in package -- skipping`);
    }
  }

  // Settings merge
  mergeSettings();
}

/**
 * Extract frontmatter fields from a SKILL.md file.
 * Returns null if no frontmatter block is present or required fields are missing.
 * Handles quoted, unquoted, and multi-line list fields in a simple YAML-subset
 * parser. We only need name + description for the index.
 */
function parseSkillFrontmatter(content) {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const body = content.slice(3, end);
  const fields = {};
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    // Skip list-item continuation lines (leading spaces + dash)
    if (/^\s+-\s/.test(line)) continue;
    const match = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (!value) continue;
    // Strip surrounding single or double quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  if (!fields.name || !fields.description) return null;
  return fields;
}

/**
 * Walk the installed skills directory, parse each SKILL.md frontmatter, and
 * aggregate a small registry at ~/.claude/.donnyclaude-skill-index.json.
 * The registry is consumed by the skill-index SessionStart hook, which emits
 * a prompt-aware short manifest instead of dumping every skill into context.
 * @param {string} skillsSrc absolute path to packages/skills directory
 */
function writeSkillIndex(skillsSrc, topKAllowed = new Set(), userOverrides = {}) {
  const indexPath = join(CLAUDE_HOME, '.donnyclaude-skill-index.json');
  const skills = {};
  let entryCount = 0;
  let skipCount = 0;
  let entries = [];
  try {
    entries = readdirSync(skillsSrc, { withFileTypes: true });
  } catch {
    info('Could not enumerate skills for index (install continuing)');
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    const skillPath = join(skillsSrc, entry.name, 'SKILL.md');
    if (!existsSync(skillPath)) {
      skipCount++;
      continue;
    }
    let content;
    try {
      content = readFileSync(skillPath, 'utf-8');
    } catch {
      skipCount++;
      continue;
    }
    const fm = parseSkillFrontmatter(content);
    if (!fm) {
      skipCount++;
      continue;
    }
    const userFlag = userOverrides && Object.prototype.hasOwnProperty.call(userOverrides, fm.name)
      ? Boolean(userOverrides[fm.name])
      : null;
    const autoInvoke = userFlag !== null ? userFlag : topKAllowed.has(fm.name);
    skills[fm.name] = {
      description: fm.description,
      autoInvoke,
      path: join(CLAUDE_HOME, 'skills', entry.name),
    };
    entryCount++;
  }
  const payload = { skills, generatedAt: new Date().toISOString(), version: 1 };
  try {
    writeFileSync(indexPath, JSON.stringify(payload, null, 2));
    const skipNote = skipCount > 0 ? ` (${skipCount} skipped)` : '';
    ok(`Skill index written (${entryCount} entries${skipNote})`);
  } catch (err) {
    warn(`Skill index write failed: ${err.message}`);
  }
}

/**
 * Load the skills.autoInvoke block from the user's existing settings.json, if
 * present. Returns a plain object mapping skill name to explicit boolean
 * override. Missing file, malformed JSON, or missing block all resolve to {}.
 * Explicit overrides win over DEFAULT_TOP_K_AUTOINVOKE_SKILLS in applyInvocationFlags.
 */
function loadUserAutoInvokeOverrides() {
  const settingsPath = join(CLAUDE_HOME, 'settings.json');
  if (!existsSync(settingsPath)) return {};
  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const overrides = parsed && parsed.skills && parsed.skills.autoInvoke;
    if (!overrides || typeof overrides !== 'object') return {};
    // Filter to boolean values only so a malformed entry cannot hijack the flag.
    const clean = {};
    for (const [k, v] of Object.entries(overrides)) {
      if (typeof v === 'boolean') clean[k] = v;
    }
    return clean;
  } catch {
    return {};
  }
}

/**
 * Upsert a single scalar key in a markdown YAML frontmatter block. Adds the
 * key at the end of the block if not present, replaces the existing line if it
 * is. Returns the updated file content. If the input has no frontmatter block,
 * prepends a fresh one with just this key. The value is serialized as boolean
 * (unquoted true or false), which is what Claude Code expects for
 * disable-model-invocation.
 */
function setFrontmatterBoolean(content, key, value) {
  const literal = value === true ? 'true' : 'false';
  if (!content.startsWith('---')) {
    return `---\n${key}: ${literal}\n---\n\n${content}`;
  }
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  const fm = content.slice(3, end);
  const tail = content.slice(end);
  const keyRegex = new RegExp(`^${key}:[^\\n]*$`, 'm');
  if (keyRegex.test(fm)) {
    return `---${fm.replace(keyRegex, `${key}: ${literal}`)}${tail}`;
  }
  const trimmed = fm.replace(/\n+$/, '');
  return `---${trimmed}\n${key}: ${literal}\n${tail.slice(1)}`;
}

/**
 * WS-1 Path B core: walk the INSTALLED skills directory at CLAUDE_HOME/skills
 * and set disable-model-invocation on each SKILL.md frontmatter. Skills in the
 * top-K allow-list (or explicitly true in user overrides) get false; everyone
 * else gets true. Called after the source-to-install cpSync completes, so this
 * modifies the user's runtime copies, not the packaged source tree.
 * Users who run `npx donnyclaude` again after editing their own ~/.claude/skills
 * will see their frontmatter edits overwritten; settings.json skills.autoInvoke
 * is the stable way to pin a skill to the allow-list across reinstalls.
 */
function applyInvocationFlags(installedSkillsDir, donnyclaudeSkillsSrc, topKAllowed, userOverrides = {}) {
  // Source-of-truth: enumerate skills donnyclaude actually ships, NOT the entire
  // installed dir. This prevents the installer from touching plugin/third-party
  // skills the user has installed elsewhere under ~/.claude/skills/.
  let donnyclaudeNames;
  try {
    donnyclaudeNames = readdirSync(donnyclaudeSkillsSrc, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);
  } catch {
    info('Could not enumerate donnyclaude source skills -- skipping invocation flags');
    return;
  }
  let flipped = 0;
  let kept = 0;
  let skipped = 0;
  for (const name of donnyclaudeNames) {
    const skillPath = join(installedSkillsDir, name, 'SKILL.md');
    if (!existsSync(skillPath)) { skipped++; continue; }
    let content;
    try { content = readFileSync(skillPath, 'utf-8'); } catch { skipped++; continue; }
    const fm = parseSkillFrontmatter(content);
    if (!fm) { skipped++; continue; }
    const skillName = fm.name;
    const userFlag = Object.prototype.hasOwnProperty.call(userOverrides, skillName)
      ? Boolean(userOverrides[skillName])
      : null;
    const autoInvoke = userFlag !== null ? userFlag : topKAllowed.has(skillName);
    const disable = !autoInvoke;
    const updated = setFrontmatterBoolean(content, 'disable-model-invocation', disable);
    if (updated === content) { kept++; continue; }
    try {
      writeFileSync(skillPath, updated);
      flipped++;
    } catch (err) {
      warn(`Could not update frontmatter for ${skillName}: ${err.message}`);
      skipped++;
    }
  }
  const note = skipped > 0 ? `, ${skipped} skipped` : '';
  ok(`Invocation flags applied to donnyclaude skills (${flipped} updated, ${kept} unchanged${note})`);
}

function mergeSettings() {
  const settingsPath = join(CLAUDE_HOME, 'settings.json');
  const templatePath = join(ROOT, 'packages', 'core', 'settings-template.json');

  if (!existsSync(templatePath)) {
    info('No settings template found -- skipping settings merge');
    return;
  }

  const template = safeParseJSON(templatePath, 'settings template');
  if (!template) return;

  if (existsSync(settingsPath)) {
    // Back up existing settings before merge
    const backupPath = join(CLAUDE_HOME, 'settings.json.bak');
    copyFileSync(settingsPath, backupPath);

    const existing = safeParseJSON(settingsPath, 'existing settings');
    if (!existing) {
      warn('Existing settings.json is malformed -- backed up to settings.json.bak');
      writeFileSync(settingsPath, JSON.stringify(template, null, 2));
      ok('Fresh settings installed (backup saved)');
      return;
    }

    // Preserve permissions -- never overwrite user's permission choice
    if (!existing.permissions) {
      existing.permissions = template.permissions;
    }

    // Merge hooks: add template hooks that don't already exist
    if (template.hooks) {
      if (!existing.hooks) existing.hooks = {};
      for (const [event, hookList] of Object.entries(template.hooks)) {
        if (!existing.hooks[event]) {
          existing.hooks[event] = hookList;
        }
      }
    }

    writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
    ok('Settings merged (existing config preserved, backup at settings.json.bak)');
  } else {
    writeFileSync(settingsPath, JSON.stringify(template, null, 2));
    ok('Settings installed');
  }
}

// ── Phase 3: Launch Claude Code Wizard ──────────────────────────────────────

function launchWizard() {
  heading('Launching Claude Code with DonnyClaude setup wizard...');
  console.log();

  const promptPath = join(ROOT, 'templates', 'setup-prompt.md');
  if (!existsSync(promptPath)) {
    fail('Setup prompt template not found');
    info('Run `donnyclaude` from the installed package directory');
    process.exit(1);
  }

  const setupPrompt = readFileSync(promptPath, 'utf-8');
  const templateDir = join(ROOT, 'templates');
  const filledPrompt = setupPrompt.replace(/\{\{TEMPLATE_DIR\}\}/g, templateDir);

  const child = spawn('claude', [
    '--append-system-prompt', filledPrompt,
    'Run the DonnyClaude setup wizard. Follow your system prompt instructions to configure this project.',
  ], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: {
      ...process.env,
      DONNYCLAUDE_TEMPLATES: templateDir,
    },
  });

  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      fail('Claude Code CLI not found in PATH');
      info('Install: npm install -g @anthropic-ai/claude-code');
    } else {
      fail(`Failed to launch Claude Code: ${err.message}`);
    }
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log(`\n\x1b[32mDonnyClaude setup complete.\x1b[0m`);
    }
    process.exit(code ?? 0);
  });
}

// ── Update Command ──────────────────────────────────────────────────────────

function handleUpdate() {
  heading('Updating DonnyClaude...');
  try {
    execSync('npm install -g donnyclaude@latest', { stdio: 'inherit' });
    ok('Updated to latest version');
    installGlobalTools();
    ok('Global tools updated');
  } catch (err) {
    fail('Update failed');
    if (err.message?.includes('EACCES') || err.message?.includes('permission')) {
      info('Try: sudo npm install -g donnyclaude@latest');
    } else {
      info('Try: npm install -g donnyclaude@latest');
    }
  }
}

// ── Doctor Command ──────────────────────────────────────────────────────────

function handleDoctor() {
  heading('DonnyClaude Health Check');

  const checks = [
    ['Claude Code', () => commandExists('claude')],
    ['Skills directory', () => existsSync(join(CLAUDE_HOME, 'skills'))],
    ['Agents directory', () => existsSync(join(CLAUDE_HOME, 'agents'))],
    ['Rules directory', () => existsSync(join(CLAUDE_HOME, 'rules'))],
    ['GSD engine', () => existsSync(join(CLAUDE_HOME, 'get-shit-done'))],
    ['Hooks directory', () => existsSync(join(CLAUDE_HOME, 'hooks'))],
    ['Settings file', () => existsSync(join(CLAUDE_HOME, 'settings.json'))],
    ['Commands directory', () => existsSync(join(CLAUDE_HOME, 'commands'))],
  ];

  let passed = 0;
  for (const [name, check] of checks) {
    if (check()) {
      ok(name);
      passed++;
    } else {
      fail(name);
    }
  }

  console.log(`\n  ${passed}/${checks.length} checks passed`);
  if (passed < checks.length) {
    info('Run `npx donnyclaude` to reinstall missing components');
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log(BANNER);

  switch (command) {
    case 'update':
      handleUpdate();
      break;
    case 'doctor':
      handleDoctor();
      break;
    case 'version':
    case '--version':
    case '-v':
      console.log(`  donnyclaude v${VERSION}`);
      break;
    case 'help':
    case '--help':
    case '-h':
      console.log('Usage:');
      console.log('  npx donnyclaude            Install tools & launch setup wizard');
      console.log('  npx donnyclaude update     Update to latest version');
      console.log('  npx donnyclaude doctor     Check installation health');
      console.log('  npx donnyclaude version    Show version');
      console.log('  npx donnyclaude help       Show this help');
      break;
    default: {
      if (command && !['init', undefined].includes(command)) {
        warn(`Unknown command: "${command}" -- running default install`);
        info('Use "donnyclaude help" to see available commands');
        console.log();
      }

      const prereqOk = checkPrerequisites();
      if (!prereqOk) {
        console.log('\n\x1b[31mPrerequisite check failed. Fix issues above and retry.\x1b[0m');
        process.exit(1);
      }

      installGlobalTools();
      launchWizard();
      break;
    }
  }
}

main();
