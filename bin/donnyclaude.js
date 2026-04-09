#!/usr/bin/env node

import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const CLAUDE_HOME = join(homedir(), '.claude');
const IS_WIN = platform() === 'win32';

// ── Branding ────────────────────────────────────────────────────────────────

const BANNER = `
\x1b[1;31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m
\x1b[1;37m  DonnyClaude v1.0\x1b[0m
\x1b[2m  Power-user setup for Claude Code\x1b[0m
\x1b[1;31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m
`;

// ── Helpers ─────────────────────────────────────────────────────────────────

function ok(msg) { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); }
function info(msg) { console.log(`  \x1b[2m${msg}\x1b[0m`); }
function heading(msg) { console.log(`\n\x1b[1m${msg}\x1b[0m`); }

function commandExists(cmd) {
  try {
    execSync(IS_WIN ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getVersion(cmd, flag = '--version') {
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
    return '?';
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
    } catch {
      fail('Failed to install Claude Code');
      info('  Manual install: npm install -g @anthropic-ai/claude-code');
      allGood = false;
    }
  }

  return allGood;
}

// ── Phase 2: Install Global Tools ───────────────────────────────────────────

function installGlobalTools() {
  heading('Installing DonnyClaude toolkit...');

  mkdirSync(CLAUDE_HOME, { recursive: true });

  // Skills
  const skillsSrc = join(ROOT, 'packages', 'skills');
  const skillsDest = join(CLAUDE_HOME, 'skills');
  if (existsSync(skillsSrc)) {
    cpSync(skillsSrc, skillsDest, { recursive: true, force: true });
    const count = countItems(skillsSrc);
    ok(`${count} skills installed`);
  } else {
    info('Skills directory not found in package -- skipping');
  }

  // Agents
  const agentsSrc = join(ROOT, 'packages', 'agents');
  const agentsDest = join(CLAUDE_HOME, 'agents');
  if (existsSync(agentsSrc)) {
    cpSync(agentsSrc, agentsDest, { recursive: true, force: true });
    const count = countItems(agentsSrc);
    ok(`${count} agents installed`);
  } else {
    info('Agents directory not found in package -- skipping');
  }

  // Rules
  const rulesSrc = join(ROOT, 'packages', 'rules');
  const rulesDest = join(CLAUDE_HOME, 'rules');
  if (existsSync(rulesSrc)) {
    cpSync(rulesSrc, rulesDest, { recursive: true, force: true });
    ok('Rules installed (common + language-specific)');
  } else {
    info('Rules directory not found in package -- skipping');
  }

  // GSD workflow engine
  const gsdSrc = join(ROOT, 'packages', 'gsd');
  const gsdDest = join(CLAUDE_HOME, 'get-shit-done');
  if (existsSync(gsdSrc)) {
    cpSync(gsdSrc, gsdDest, { recursive: true, force: true });
    ok('GSD workflow engine installed');
  } else {
    info('GSD directory not found in package -- skipping');
  }

  // Hooks
  const hooksSrc = join(ROOT, 'packages', 'hooks');
  const hooksDest = join(CLAUDE_HOME, 'hooks');
  if (existsSync(hooksSrc)) {
    cpSync(hooksSrc, hooksDest, { recursive: true, force: true });
    ok('Hooks installed');
  } else {
    info('Hooks directory not found in package -- skipping');
  }

  // Commands
  const cmdsSrc = join(ROOT, 'packages', 'commands');
  const cmdsDest = join(CLAUDE_HOME, 'commands');
  if (existsSync(cmdsSrc)) {
    cpSync(cmdsSrc, cmdsDest, { recursive: true, force: true });
    ok('Commands installed');
  } else {
    info('Commands directory not found in package -- skipping');
  }

  // Settings merge
  mergeSettings();
}

function mergeSettings() {
  const settingsPath = join(CLAUDE_HOME, 'settings.json');
  const templatePath = join(ROOT, 'packages', 'core', 'settings-template.json');

  if (!existsSync(templatePath)) {
    info('No settings template found -- skipping settings merge');
    return;
  }

  const template = JSON.parse(readFileSync(templatePath, 'utf-8'));

  if (existsSync(settingsPath)) {
    // Merge: preserve existing, add new hooks
    const existing = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    // Preserve permissions
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
        // Don't overwrite existing hooks for the same event
      }
    }

    writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
    ok('Settings merged (existing config preserved)');
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

  // Pass the template directory path so Claude can find templates
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
    // Re-run install to push new tools
    installGlobalTools();
    ok('Global tools updated');
  } catch {
    fail('Update failed');
    info('Try: npm install -g donnyclaude@latest');
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
    case 'help':
    case '--help':
    case '-h':
      console.log('Usage:');
      console.log('  npx donnyclaude          Install tools & launch setup wizard');
      console.log('  npx donnyclaude update   Update to latest version');
      console.log('  npx donnyclaude doctor   Check installation health');
      console.log('  npx donnyclaude help     Show this help');
      break;
    default: {
      // Default: full install flow
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
