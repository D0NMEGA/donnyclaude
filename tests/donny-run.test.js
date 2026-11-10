/**
 * packages/bin/donny-run, driven as a real subprocess against a throwaway git repository.
 *
 * Nothing here touches the real harness: HOME is a temp dir that holds stub copies of
 * donny-tools.cjs and cc-crossreview at the paths the script resolves from $HOME, and a
 * stub `claude` is first on PATH. The stubs print canned output and exit with a chosen
 * code; their behaviour is steered by STUB_* environment variables. The script needed no
 * test seam of its own.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ROOT } from './helpers/cli.mjs';

const DONNY_RUN = resolve(ROOT, 'packages/bin/donny-run');

const STUB_TOOLS = `#!/usr/bin/env node
const fs = require('fs');
const [, , cmd, sub, arg] = process.argv;
const log = process.env.STUB_LOG;
if (cmd === 'roadmap' && sub === 'analyze') {
  const nums = (process.env.STUB_PHASES || '1').split(',');
  process.stdout.write(JSON.stringify({ phases: nums.map((n) => ({ number: n, name: 'p' + n })) }, null, 2));
} else if (cmd === 'verify' && sub === 'phase-verified') {
  fs.appendFileSync(log + '/verify.args', arg + '\\n');
  process.stdout.write(JSON.stringify({ verified: process.env.STUB_VERIFIED !== 'false', status: 'x' }, null, 2));
} else {
  process.stderr.write('stub donny-tools: unexpected ' + process.argv.slice(2).join(' ') + '\\n');
  process.exit(2);
}
`;

const STUB_CLAUDE = `#!/usr/bin/env bash
# Stub for \`claude -p <prompt> ...\`: records the prompt, prints canned output, optionally commits.
prompt="$2"
printf '%s\\n' "$prompt" >> "$STUB_LOG/claude.calls"
n=$(wc -l < "$STUB_LOG/claude.calls" | tr -d ' ')
[ -z "\${STUB_CLAUDE_OUT:-}" ] || printf '%s\\n' "$STUB_CLAUDE_OUT"
if [ -n "\${STUB_COMMIT_FILE:-}" ] && [[ "$prompt" == *execute-phase* ]]; then
  printf 'phase\\n' >> "$STUB_COMMIT_FILE"; git add -A -- "$STUB_COMMIT_FILE"; git commit -q -m work
fi
if [ "\${STUB_FAIL_FIRST:-0}" = 1 ] && [ "$n" = 1 ]; then exit 1; fi
exit "\${STUB_CLAUDE_EXIT:-0}"
`;

const STUB_REVIEW = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_LOG/crossreview.args"
printf '%s\\n' "\${STUB_REVIEW_OUT:-VERDICT: PASS}"
exit "\${STUB_REVIEW_EXIT:-0}"
`;

let dir;
let repo;
let env;

const git = (...args) => {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf-8', env });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

const write = (path, text, mode) => {
  fs.mkdirSync(join(path, '..'), { recursive: true });
  fs.writeFileSync(path, text, { mode });
};

const run = (args, extraEnv = {}) => {
  const r = spawnSync('bash', [DONNY_RUN, ...args], { cwd: repo, encoding: 'utf-8', env: { ...env, ...extraEnv }, timeout: 60000 });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

const calls = () => {
  const f = join(dir, 'log', 'claude.calls');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').trim().split('\n') : [];
};
const readLog = (name) => {
  const f = join(dir, 'log', name);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').trim() : null;
};

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'donny-run-test-'));
  repo = join(dir, 'repo');
  const home = join(dir, 'home');
  const bin = join(dir, 'bin');
  fs.mkdirSync(join(dir, 'log'), { recursive: true });
  write(join(home, '.claude/donny/bin/donny-tools.cjs'), STUB_TOOLS, 0o755);
  write(join(home, '.claude/bin/cc-crossreview'), STUB_REVIEW, 0o755);
  write(join(bin, 'claude'), STUB_CLAUDE, 0o755);
  env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: home,
    STUB_LOG: join(dir, 'log'),
    STUB_PHASES: '1,1.1,2',
    DONNY_RUN_RETRY_SECS: '0',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
  };
  fs.mkdirSync(repo, { recursive: true });
  git('init', '-q', '-b', 'main');
  write(join(repo, 'file.txt'), 'base\n');
  write(join(repo, '.git/info/exclude'), '.planning\n');
  for (const d of ['01-foo', '01.1-bar', '02-baz']) write(join(repo, '.planning/phases', d, `${d.split('-')[0]}-01-PLAN.md`), 'plan\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('donny-run usage-limit retry', () => {
  it('runs a step that exits 0 once, even when its log mentions a rate limit', () => {
    const r = run(['1', '--no-review'], { STUB_CLAUDE_OUT: 'note: the API has a rate limit and a usage limit' });
    assert.equal(r.status, 0, r.out);
    assert.equal(calls().length, 2, 'plan and execute once each');
  });

  it('retries a failed step whose log tail reports a limit', () => {
    const r = run(['1', '--no-review'], { STUB_CLAUDE_OUT: 'Claude usage limit reached', STUB_FAIL_FIRST: '1' });
    assert.equal(r.status, 0, r.out);
    assert.equal(calls().length, 3, 'plan twice, execute once');
  });

  it('does not retry a failure when the limit text is older than the last 40 lines', () => {
    const r = run(['1', '--no-review'], { STUB_CLAUDE_OUT: 'usage limit\n' + 'filler\n'.repeat(60), STUB_CLAUDE_EXIT: '1' });
    assert.equal(r.status, 1, r.out);
    assert.equal(calls().length, 1);
  });
});

describe('donny-run phase list and arguments', () => {
  it('a dry run lists phases 1 and 1.1 but not 2, and writes nothing', () => {
    const r = run(['1', '1.1', '--dry-run']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /=== phase 1 ===/);
    assert.match(r.out, /=== phase 1\.1 ===/);
    assert.doesNotMatch(r.out, /=== phase 2 ===/);
    assert.equal(calls().length, 0, 'a dry run must not call claude');
    assert.equal(fs.existsSync(join(repo, '.planning/runner/1-start.sha')), false);
  });

  it('the plan step is told not to advance into execution, and the default effort is high', () => {
    assert.equal(run(['1', '--no-review']).status, 0);
    assert.equal(calls()[0], '/donny-plan-phase 1 --auto --no-advance');
    const r = run(['1', '--dry-run']);
    assert.match(r.out, /--effort high/);
    assert.doesNotMatch(r.out, /xhigh/);
    assert.match(run(['1', '--dry-run'], { DONNY_RUN_EFFORT: 'max', DONNY_RUN_MODEL: 'sonnet' }).out, /--model sonnet --effort max/);
  });

  it('pads only the integer part of a decimal phase when finding its directory', () => {
    const r = run(['1.1', '--no-review']);
    assert.equal(r.status, 0, r.out);
    assert.equal(readLog('verify.args'), '.planning/phases/01.1-bar');
  });
});

describe('donny-run gates and markers', () => {
  it('writes a marker only after its gate passed, bound to the current commit', () => {
    const r = run(['1', '--no-review'], { STUB_VERIFIED: 'false' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /verified=false/);
    assert.equal(fs.readFileSync(join(repo, '.planning/runner/1-plan.done'), 'utf-8').trim(), git('rev-parse', 'HEAD'));
    assert.equal(fs.existsSync(join(repo, '.planning/runner/1-execute.done')), false, 'the execute gate failed');
  });

  it('--resume skips a step whose marker commit is still in history, and runs one that has none', () => {
    run(['1', '--no-review'], { STUB_VERIFIED: 'false' });
    const before = calls().length;
    const r = run(['1', '--no-review', '--resume']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /plan: done earlier, skipping/);
    assert.equal(calls().length - before, 1, 'only execute runs again');
  });
});

describe('donny-run review', () => {
  it('passes the start commit recorded for the phase to the reviewer', () => {
    const start = git('rev-parse', 'HEAD');
    const r = run(['1'], { STUB_COMMIT_FILE: 'file.txt' });
    assert.equal(r.status, 0, r.out);
    assert.equal(readLog('crossreview.args'), start);
    assert.equal(fs.readFileSync(join(repo, '.planning/runner/1-start.sha'), 'utf-8').trim(), start);
    assert.notEqual(git('rev-parse', 'HEAD'), start, 'the run committed work after the start');
  });

  it('--resume reuses the recorded start commit rather than taking a new one', () => {
    const first = git('rev-parse', 'HEAD');
    write(join(repo, 'file.txt'), 'changed\n');
    git('commit', '-q', '-am', 'second');
    write(join(repo, '.planning/runner/1-start.sha'), first + '\n');
    const r = run(['1', '--resume']);
    assert.equal(r.status, 0, r.out);
    assert.equal(readLog('crossreview.args'), first);
  });

  it('--resume reviews again when commits were made after the review that passed', () => {
    const r1 = run(['1'], { STUB_COMMIT_FILE: 'file.txt' });
    assert.equal(r1.status, 0, r1.out);
    const reviewed = fs.readFileSync(join(repo, '.planning/runner/1-review.done'), 'utf-8').trim();
    write(join(repo, 'file.txt'), 'unreviewed change\n');
    git('commit', '-q', '-am', 'after review');
    assert.notEqual(git('rev-parse', 'HEAD'), reviewed);
    fs.rmSync(join(env.STUB_LOG, 'crossreview.args'), { force: true });
    const r2 = run(['1', '--resume']);
    assert.equal(r2.status, 0, r2.out);
    assert.ok(readLog('crossreview.args'), 'the reviewer ran again for the commit made after its pass');
  });

  it('refuses to treat an empty diff as a pass', () => {
    const r = run(['1']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /refusing to treat an empty review as a pass/);
    assert.equal(readLog('crossreview.args'), null, 'the reviewer is not even asked');
  });

  it('a reviewer that prints VERDICT: PASS but exits 1 does not pass', () => {
    const r = run(['1'], { STUB_COMMIT_FILE: 'file.txt', STUB_REVIEW_EXIT: '1' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /did not pass \(exit 1/);
    assert.equal(fs.existsSync(join(repo, '.planning/runner/1-review.done')), false);
  });

  it('a reviewer whose final verdict is BLOCK does not pass, even if PASS appears earlier', () => {
    const r = run(['1'], { STUB_COMMIT_FILE: 'file.txt', STUB_REVIEW_OUT: 'VERDICT: PASS (draft)\nVERDICT: BLOCK' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /final verdict 'VERDICT: BLOCK'/);
  });
});

describe('donny-run merge', () => {
  const onPhaseBranch = (diverge) => {
    git('checkout', '-q', '-b', 'phase/01-foo');
    git('checkout', '-q', 'main');
    if (diverge) { write(join(repo, 'file.txt'), 'main\n'); git('commit', '-q', '-am', 'main moves on'); }
    git('checkout', '-q', 'phase/01-foo');
  };

  it('squash-merges the phase branch as one commit and leaves .planning changes alone', () => {
    onPhaseBranch(false);
    write(join(repo, '.planning/STATE.md'), 'dirty planning file\n');
    const r = run(['1', '--no-review', '--merge'], { STUB_COMMIT_FILE: 'file.txt' });
    assert.equal(r.status, 0, r.out);
    assert.equal(git('branch', '--show-current'), 'main');
    assert.equal(git('log', '-1', '--format=%s'), 'feat(foo): foo');
    assert.equal(git('rev-list', '--count', 'main'), '2', 'base plus the one squash commit');
    assert.equal(fs.readFileSync(join(repo, '.planning/STATE.md'), 'utf-8'), 'dirty planning file\n');
  });

  it('a failed merge creates no commit', () => {
    onPhaseBranch(true);
    const mainBefore = git('rev-parse', 'main');
    const r = run(['1', '--no-review', '--merge'], { STUB_COMMIT_FILE: 'file.txt' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /squash merge of phase\/01-foo into main failed/);
    assert.equal(git('rev-parse', 'main'), mainBefore, 'main must not gain a commit');
  });

  it('an untracked file outside .planning stops the merge and is still there afterwards', () => {
    onPhaseBranch(false);
    write(join(repo, 'notes.txt'), 'my notes\n');
    const mainBefore = git('rev-parse', 'main');
    const r = run(['1', '--no-review', '--merge'], { STUB_COMMIT_FILE: 'file.txt' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /uncommitted changes outside \.planning\//);
    assert.match(r.out, /notes\.txt/);
    assert.equal(fs.readFileSync(join(repo, 'notes.txt'), 'utf-8'), 'my notes\n');
    assert.equal(git('branch', '--show-current'), 'phase/01-foo', 'no checkout happened');
    assert.equal(git('rev-parse', 'main'), mainBefore);
    assert.equal(git('stash', 'list'), '', 'nothing was stashed');
  });
});
