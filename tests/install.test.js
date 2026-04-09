import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, cpSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

// Use a temp directory to simulate a fresh ~/.claude/
const TEST_HOME = join(tmpdir(), `donnyclaude-test-${Date.now()}`);
const TEST_CLAUDE_HOME = join(TEST_HOME, '.claude');

// ── Helpers ─────────────────────────────────────────────────────────────────

function cleanTestDir() {
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
  mkdirSync(TEST_HOME, { recursive: true });
}

function countDirItems(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(f => !f.startsWith('.')).length;
}

// ── Test: Package Structure ─────────────────────────────────────────────────

describe('Package structure', () => {
  it('has bin/donnyclaude.js', () => {
    assert.ok(existsSync(join(ROOT, 'bin', 'donnyclaude.js')));
  });

  it('has package.json with correct bin entry', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    assert.equal(pkg.bin.donnyclaude, 'bin/donnyclaude.js');
    assert.equal(pkg.type, 'module');
  });

  it('has packages/ with skills, agents, rules, gsd, hooks, commands', () => {
    const dirs = ['skills', 'agents', 'rules', 'gsd', 'hooks', 'commands'];
    for (const dir of dirs) {
      assert.ok(existsSync(join(ROOT, 'packages', dir)), `packages/${dir} missing`);
    }
  });

  it('has templates/ with all required files', () => {
    assert.ok(existsSync(join(ROOT, 'templates', 'setup-prompt.md')));
    assert.ok(existsSync(join(ROOT, 'templates', 'mcp-json', 'mcp-template.json')));
    assert.ok(existsSync(join(ROOT, 'templates', 'planning', 'PROJECT.md')));
    assert.ok(existsSync(join(ROOT, 'templates', 'planning', 'config.json')));
  });

  it('has 100+ skills', () => {
    const count = countDirItems(join(ROOT, 'packages', 'skills'));
    assert.ok(count >= 100, `Expected 100+ skills, got ${count}`);
  });

  it('has 40+ agents', () => {
    const count = countDirItems(join(ROOT, 'packages', 'agents'));
    assert.ok(count >= 40, `Expected 40+ agents, got ${count}`);
  });
});

// ── Test: Templates ─────────────────────────────────────────────────────────

describe('Templates', () => {
  it('MCP template is valid JSON', () => {
    const content = readFileSync(join(ROOT, 'templates', 'mcp-json', 'mcp-template.json'), 'utf-8');
    const parsed = JSON.parse(content);
    assert.ok(parsed.mcpServers, 'Missing mcpServers key');
  });

  it('MCP template has 7 servers', () => {
    const content = readFileSync(join(ROOT, 'templates', 'mcp-json', 'mcp-template.json'), 'utf-8');
    const parsed = JSON.parse(content);
    const servers = Object.keys(parsed.mcpServers);
    assert.equal(servers.length, 7, `Expected 7 servers, got ${servers.length}: ${servers.join(', ')}`);
  });

  it('MCP template has expected servers', () => {
    const content = readFileSync(join(ROOT, 'templates', 'mcp-json', 'mcp-template.json'), 'utf-8');
    const parsed = JSON.parse(content);
    const expected = ['context7', 'playwright', '21st-magic', 'exa-web-search', 'semanticscholar', 'computer-use', 'vercel'];
    for (const name of expected) {
      assert.ok(parsed.mcpServers[name], `Missing server: ${name}`);
    }
  });

  it('planning config.json is valid JSON', () => {
    const content = readFileSync(join(ROOT, 'templates', 'planning', 'config.json'), 'utf-8');
    const parsed = JSON.parse(content);
    assert.ok(parsed.workflow, 'Missing workflow key');
    assert.ok(parsed.models, 'Missing models key');
  });

  it('CLAUDE.md templates exist for all stacks', () => {
    const stacks = ['generic', 'python-fastapi', 'nextjs-typescript', 'rust', 'go'];
    for (const stack of stacks) {
      assert.ok(
        existsSync(join(ROOT, 'templates', 'claude-md', `${stack}.md`)),
        `Missing template: ${stack}.md`
      );
    }
  });

  it('all CLAUDE.md templates mention GSD', () => {
    const stacks = ['generic', 'python-fastapi', 'nextjs-typescript', 'rust', 'go'];
    for (const stack of stacks) {
      const content = readFileSync(join(ROOT, 'templates', 'claude-md', `${stack}.md`), 'utf-8');
      assert.ok(content.includes('gsd'), `${stack}.md does not mention GSD`);
    }
  });

  it('all CLAUDE.md templates mention Context7', () => {
    const stacks = ['generic', 'python-fastapi', 'nextjs-typescript', 'rust', 'go'];
    for (const stack of stacks) {
      const content = readFileSync(join(ROOT, 'templates', 'claude-md', `${stack}.md`), 'utf-8');
      assert.ok(content.includes('Context7'), `${stack}.md does not mention Context7`);
    }
  });

  it('setup-prompt.md contains wizard steps', () => {
    const content = readFileSync(join(ROOT, 'templates', 'setup-prompt.md'), 'utf-8');
    assert.ok(content.includes('Step 1'));
    assert.ok(content.includes('Step 2'));
    assert.ok(content.includes('Step 3'));
    assert.ok(content.includes('Step 4'));
    assert.ok(content.includes('Step 5'));
  });
});

// ── Test: Settings Merge ────────────────────────────────────────────────────

describe('Settings merge', () => {
  before(() => cleanTestDir());
  after(() => {
    if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it('creates settings.json on fresh install (no existing)', () => {
    const settingsPath = join(TEST_CLAUDE_HOME, 'settings.json');
    const templatePath = join(ROOT, 'packages', 'core', 'settings-template.json');

    mkdirSync(TEST_CLAUDE_HOME, { recursive: true });

    // Simulate merge logic
    const template = JSON.parse(readFileSync(templatePath, 'utf-8'));
    writeFileSync(settingsPath, JSON.stringify(template, null, 2));

    assert.ok(existsSync(settingsPath));
    const result = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    assert.ok(result.permissions);
    assert.ok(result.hooks);
  });

  it('preserves existing permissions on merge', () => {
    const settingsPath = join(TEST_CLAUDE_HOME, 'settings.json');
    const templatePath = join(ROOT, 'packages', 'core', 'settings-template.json');

    // Write existing settings with custom permissions
    const existing = {
      permissions: { defaultMode: 'askEveryTime' },
      hooks: {},
      customKey: 'preserved'
    };
    writeFileSync(settingsPath, JSON.stringify(existing, null, 2));

    // Merge logic
    const template = JSON.parse(readFileSync(templatePath, 'utf-8'));
    const current = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    if (!current.permissions) current.permissions = template.permissions;
    if (template.hooks) {
      if (!current.hooks) current.hooks = {};
      for (const [event, hookList] of Object.entries(template.hooks)) {
        if (!current.hooks[event]) current.hooks[event] = hookList;
      }
    }

    writeFileSync(settingsPath, JSON.stringify(current, null, 2));

    const result = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    assert.equal(result.permissions.defaultMode, 'askEveryTime', 'Existing permissions overwritten');
    assert.equal(result.customKey, 'preserved', 'Custom key lost');
    assert.ok(result.hooks.SessionStart, 'Template hooks not added');
  });

  it('does not overwrite existing hooks for same event', () => {
    const settingsPath = join(TEST_CLAUDE_HOME, 'settings.json');
    const templatePath = join(ROOT, 'packages', 'core', 'settings-template.json');

    // Write existing settings with custom SessionStart hook
    const existing = {
      permissions: {},
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo custom' }] }]
      }
    };
    writeFileSync(settingsPath, JSON.stringify(existing, null, 2));

    // Merge logic
    const template = JSON.parse(readFileSync(templatePath, 'utf-8'));
    const current = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    if (template.hooks) {
      if (!current.hooks) current.hooks = {};
      for (const [event, hookList] of Object.entries(template.hooks)) {
        if (!current.hooks[event]) current.hooks[event] = hookList;
      }
    }

    writeFileSync(settingsPath, JSON.stringify(current, null, 2));

    const result = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    // SessionStart should still have the custom hook, not the template's
    assert.equal(result.hooks.SessionStart[0].hooks[0].command, 'echo custom');
  });
});

// ── Test: Fresh Install Simulation ──────────────────────────────────────────

describe('Fresh install simulation', () => {
  const FRESH_HOME = join(tmpdir(), `donnyclaude-fresh-${Date.now()}`);
  const FRESH_CLAUDE = join(FRESH_HOME, '.claude');

  before(() => {
    mkdirSync(FRESH_HOME, { recursive: true });
  });

  after(() => {
    if (existsSync(FRESH_HOME)) rmSync(FRESH_HOME, { recursive: true, force: true });
  });

  it('copies skills to fresh directory', () => {
    const src = join(ROOT, 'packages', 'skills');
    const dest = join(FRESH_CLAUDE, 'skills');
    cpSync(src, dest, { recursive: true, force: true });
    assert.ok(existsSync(dest));
    assert.ok(countDirItems(dest) >= 100);
  });

  it('copies agents to fresh directory', () => {
    const src = join(ROOT, 'packages', 'agents');
    const dest = join(FRESH_CLAUDE, 'agents');
    cpSync(src, dest, { recursive: true, force: true });
    assert.ok(existsSync(dest));
    assert.ok(countDirItems(dest) >= 40);
  });

  it('copies rules with language subdirectories', () => {
    const src = join(ROOT, 'packages', 'rules');
    const dest = join(FRESH_CLAUDE, 'rules');
    cpSync(src, dest, { recursive: true, force: true });
    assert.ok(existsSync(join(dest, 'common')));
    assert.ok(existsSync(join(dest, 'typescript')));
    assert.ok(existsSync(join(dest, 'python')));
  });

  it('copies GSD engine', () => {
    const src = join(ROOT, 'packages', 'gsd');
    const dest = join(FRESH_CLAUDE, 'get-shit-done');
    cpSync(src, dest, { recursive: true, force: true });
    assert.ok(existsSync(dest));
    assert.ok(countDirItems(dest) >= 3);
  });

  it('copies hooks', () => {
    const src = join(ROOT, 'packages', 'hooks');
    const dest = join(FRESH_CLAUDE, 'hooks');
    cpSync(src, dest, { recursive: true, force: true });
    assert.ok(existsSync(dest));
  });

  it('copies commands', () => {
    const src = join(ROOT, 'packages', 'commands');
    const dest = join(FRESH_CLAUDE, 'commands');
    cpSync(src, dest, { recursive: true, force: true });
    assert.ok(existsSync(dest));
    assert.ok(countDirItems(dest) >= 50);
  });
});

// ── Test: CLI Commands ──────────────────────────────────────────────────────

describe('CLI commands', () => {
  it('help command exits 0', () => {
    const output = execSync(`node ${join(ROOT, 'bin', 'donnyclaude.js')} help`, {
      encoding: 'utf-8',
    });
    assert.ok(output.includes('Usage:'));
    assert.ok(output.includes('npx donnyclaude'));
  });

  it('--help flag works', () => {
    const output = execSync(`node ${join(ROOT, 'bin', 'donnyclaude.js')} --help`, {
      encoding: 'utf-8',
    });
    assert.ok(output.includes('Usage:'));
  });

  it('-h flag works', () => {
    const output = execSync(`node ${join(ROOT, 'bin', 'donnyclaude.js')} -h`, {
      encoding: 'utf-8',
    });
    assert.ok(output.includes('Usage:'));
  });

  it('doctor command runs without error', () => {
    const output = execSync(`node ${join(ROOT, 'bin', 'donnyclaude.js')} doctor`, {
      encoding: 'utf-8',
    });
    assert.ok(output.includes('Health Check'));
    assert.ok(output.includes('checks passed'));
  });

  it('banner displays in all commands', () => {
    const output = execSync(`node ${join(ROOT, 'bin', 'donnyclaude.js')} help`, {
      encoding: 'utf-8',
    });
    assert.ok(output.includes('DonnyClaude'));
  });
});

// ── Test: Cross-Platform Path Safety ────────────────────────────────────────

describe('Cross-platform safety', () => {
  it('bin/donnyclaude.js uses path.join not hardcoded separators', () => {
    const content = readFileSync(join(ROOT, 'bin', 'donnyclaude.js'), 'utf-8');
    // Should use join() for all path construction
    assert.ok(content.includes("join("), 'No path.join usage found');
    // Should not have hardcoded unix paths in logic (template strings are ok)
    const lines = content.split('\n').filter(l =>
      !l.trim().startsWith('//') &&
      !l.trim().startsWith('*') &&
      !l.includes('console.log') &&
      !l.includes("'utf-8'")
    );
    // Check no raw path concatenation with /
    const badPaths = lines.filter(l => /\+ ['"]\//.test(l));
    assert.equal(badPaths.length, 0, `Found hardcoded path separators: ${badPaths.join('\n')}`);
  });
});
