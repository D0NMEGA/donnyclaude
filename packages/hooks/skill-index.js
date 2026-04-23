#!/usr/bin/env node
// WS-1 Skill Progressive Disclosure - SessionStart hook
// Reads ~/.claude/.donnyclaude-skill-index.json (written at install time),
// merges user overrides from ~/.claude/settings.json (skills.autoInvoke),
// scores skill descriptions against the session's initial user prompt by
// keyword overlap, and emits a short top-K manifest as additionalContext.
// Full SKILL.md bodies do NOT load. Claude Code loads skill content on demand
// when the agent references a skill by name.
//
// Protocol: Claude Code delivers SessionStart context as JSON on stdin. The
// prompt field location varies across CLI versions; we probe a small list
// of known paths and fall back to an empty manifest if none match.
// Exit code 0 always (fail-open per Claude Code convention).

const fs = require('fs');
const os = require('os');
const path = require('path');

const TOP_K = 10;
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'to', 'of',
  'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'it', 'this', 'that',
  'these', 'those', 'i', 'you', 'we', 'they', 'he', 'she', 'not', 'no',
  'can', 'could', 'will', 'would', 'should', 'shall', 'may', 'might', 'must',
  'me', 'my', 'your', 'our', 'their', 'please', 'help', 'need', 'want',
  'how', 'what', 'when', 'where', 'why', 'which', 'who', 'whom',
]);

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text.toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(tok => tok.length >= 3 && !STOP_WORDS.has(tok));
}

function extractPrompt(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const probes = [
    payload.prompt,
    payload.user_prompt,
    payload.initial_prompt,
    payload.message,
    payload.input,
    payload.session && payload.session.initial_prompt,
    payload.session && payload.session.prompt,
  ];
  for (const candidate of probes) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return '';
}

function loadIndex(indexPath) {
  if (!fs.existsSync(indexPath)) return { skills: {} };
  try {
    const raw = fs.readFileSync(indexPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.skills) return { skills: {} };
    return parsed;
  } catch {
    return { skills: {} };
  }
}

function loadUserOverrides(settingsPath) {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    if (parsed && parsed.skills && typeof parsed.skills.autoInvoke === 'object') {
      return parsed.skills.autoInvoke || {};
    }
  } catch {
    // Silent fall-through
  }
  return {};
}

function scoreSkills(skills, promptTokens, overrides) {
  const promptSet = new Set(promptTokens);
  const scored = [];
  for (const [name, meta] of Object.entries(skills)) {
    if (!meta || typeof meta.description !== 'string') continue;
    const descTokens = tokenize(meta.description);
    const nameTokens = tokenize(name);
    let overlap = 0;
    for (const tok of descTokens) if (promptSet.has(tok)) overlap++;
    for (const tok of nameTokens) if (promptSet.has(tok)) overlap += 2;
    const overrideValue = Object.prototype.hasOwnProperty.call(overrides, name)
      ? overrides[name]
      : meta.autoInvoke;
    const autoInvoke = overrideValue === true;
    scored.push({ name, description: meta.description, overlap, autoInvoke });
  }
  return scored;
}

function pickTopK(scored, k) {
  const autoInvoked = scored.filter(s => s.autoInvoke);
  const matched = scored
    .filter(s => !s.autoInvoke && s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.name.localeCompare(b.name));
  const merged = [...autoInvoked];
  for (const entry of matched) {
    if (merged.length >= k) break;
    if (!merged.find(m => m.name === entry.name)) merged.push(entry);
  }
  return merged.slice(0, k);
}

function buildManifest(selected, totalSkills) {
  if (selected.length === 0) {
    return `Skill index ready: ${totalSkills} skills available via progressive disclosure. ` +
      'Reference a skill by name to load its full content on demand.';
  }
  const lines = selected.map(s => `- ${s.name}: ${s.description}`);
  return `Relevant skills for this session (${selected.length} of ${totalSkills} available, ` +
    'loaded on demand when referenced by name):\n' + lines.join('\n');
}

function run() {
  // Event name comes from argv[2] when registered via hooks.json.
  // Defaults to SessionStart for backward compatibility with the original
  // single-trigger registration. Valid values: SessionStart, UserPromptSubmit.
  const eventName = (process.argv[2] && /^[A-Za-z]+$/.test(process.argv[2]))
    ? process.argv[2]
    : 'SessionStart';
  let input = '';
  const stdinTimeout = setTimeout(() => emit('', eventName), 5000);
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    let payload = {};
    try { payload = JSON.parse(input); } catch { payload = {}; }
    const home = os.homedir();
    const indexPath = path.join(home, '.claude', '.donnyclaude-skill-index.json');
    const settingsPath = path.join(home, '.claude', 'settings.json');
    const { skills } = loadIndex(indexPath);
    const overrides = loadUserOverrides(settingsPath);
    const promptTokens = tokenize(extractPrompt(payload));
    const scored = scoreSkills(skills, promptTokens, overrides);
    const selected = pickTopK(scored, TOP_K);
    emit(buildManifest(selected, Object.keys(skills).length), eventName);
  });
}

function emit(message, eventName = 'SessionStart') {
  if (!message) { process.exit(0); return; }
  const output = {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: message,
    },
  };
  try { process.stdout.write(JSON.stringify(output)); } catch { /* ignore */ }
  process.exit(0);
}

if (require.main === module) {
  run();
} else {
  module.exports = {
    tokenize,
    extractPrompt,
    scoreSkills,
    pickTopK,
    buildManifest,
    loadIndex,
    loadUserOverrides,
  };
}
