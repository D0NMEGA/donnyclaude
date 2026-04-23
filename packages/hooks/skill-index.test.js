#!/usr/bin/env node
// Minimal unit tests for skill-index hook logic.
// Run with: node packages/hooks/skill-index.test.js
// Exit code 0 on pass, 1 on fail.

const assert = require('node:assert');
const { tokenize, extractPrompt, scoreSkills, pickTopK, buildManifest } =
  require('./skill-index.js');

const fixtureSkills = {
  'api-design': {
    description: 'REST API design patterns including resource naming, status codes, pagination, and versioning for production APIs.',
    autoInvoke: false,
    path: '/fake/api-design',
  },
  'python-testing': {
    description: 'Python testing strategies using pytest, TDD methodology, fixtures, mocking, and coverage requirements.',
    autoInvoke: false,
    path: '/fake/python-testing',
  },
  'frontend-patterns': {
    description: 'Frontend development patterns for React, Next.js, state management, performance optimization, and UI best practices.',
    autoInvoke: false,
    path: '/fake/frontend-patterns',
  },
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}: ${err.message}`);
    failed++;
  }
}

test('tokenize strips stop words and short tokens', () => {
  const tokens = tokenize('I need help building a REST API');
  assert.deepStrictEqual(tokens.sort(), ['api', 'building', 'rest'].sort());
});

test('tokenize handles empty/invalid input', () => {
  assert.deepStrictEqual(tokenize(''), []);
  assert.deepStrictEqual(tokenize(null), []);
  assert.deepStrictEqual(tokenize(undefined), []);
});

test('extractPrompt probes multiple known paths', () => {
  assert.strictEqual(extractPrompt({ prompt: 'hello world' }), 'hello world');
  assert.strictEqual(extractPrompt({ user_prompt: 'foo' }), 'foo');
  assert.strictEqual(extractPrompt({ session: { prompt: 'nested' } }), 'nested');
  assert.strictEqual(extractPrompt({}), '');
  assert.strictEqual(extractPrompt(null), '');
});

test('scoreSkills gives overlap for description token matches', () => {
  const tokens = tokenize('help me design a REST API with pagination');
  const scored = scoreSkills(fixtureSkills, tokens, {});
  const apiDesign = scored.find(s => s.name === 'api-design');
  const pythonTesting = scored.find(s => s.name === 'python-testing');
  assert.ok(apiDesign.overlap > 0, 'api-design should match');
  assert.strictEqual(pythonTesting.overlap, 0, 'python-testing should not match');
});

test('scoreSkills applies autoInvoke overrides', () => {
  const scored = scoreSkills(fixtureSkills, [], { 'python-testing': true });
  const py = scored.find(s => s.name === 'python-testing');
  assert.strictEqual(py.autoInvoke, true);
});

test('pickTopK ranks by overlap, pulls autoInvoke first', () => {
  const scored = [
    { name: 'a', description: 'x', overlap: 1, autoInvoke: false },
    { name: 'b', description: 'y', overlap: 3, autoInvoke: false },
    { name: 'c', description: 'z', overlap: 0, autoInvoke: true },
  ];
  const top = pickTopK(scored, 2);
  assert.strictEqual(top[0].name, 'c');
  assert.strictEqual(top[1].name, 'b');
});

test('pickTopK drops zero-overlap non-autoInvoke entries', () => {
  const scored = [
    { name: 'a', description: 'x', overlap: 0, autoInvoke: false },
    { name: 'b', description: 'y', overlap: 0, autoInvoke: false },
  ];
  const top = pickTopK(scored, 5);
  assert.strictEqual(top.length, 0);
});

test('buildManifest returns fallback message when no skills selected', () => {
  const msg = buildManifest([], 107);
  assert.ok(msg.includes('107 skills available'));
});

test('buildManifest formats selected skills', () => {
  const msg = buildManifest(
    [{ name: 'api-design', description: 'REST APIs', overlap: 2, autoInvoke: false }],
    107,
  );
  assert.ok(msg.includes('api-design: REST APIs'));
  assert.ok(msg.includes('1 of 107'));
});

test('end-to-end: REST prompt surfaces api-design in top-K', () => {
  const tokens = tokenize('I need help designing a REST API with status codes and pagination');
  const scored = scoreSkills(fixtureSkills, tokens, {});
  const top = pickTopK(scored, 10);
  const names = top.map(s => s.name);
  assert.ok(names.includes('api-design'), `expected api-design in top-K, got ${names.join(',')}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
