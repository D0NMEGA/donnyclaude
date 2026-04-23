# WS-1 Summary: Skill Progressive Disclosure

## Files changed

| Path | Type | Lines |
|---|---|---:|
| `bin/donnyclaude.js` | modified | +91 / -1 (379 to 473) |
| `packages/core/settings-template.json` | modified | +5 (added `skills: {enabled, disabled, autoInvoke}`) |
| `packages/hooks/skill-index.js` | created | 166 |
| `packages/hooks/skill-index.test.js` | created | 119 |
| `packages/hooks/package.json` | created | 6 (CommonJS scope for local test execution; root is ESM) |

## Hook registration diff (applied by orchestrator)

Added to `packages/hooks/hooks.json` SessionStart array:

```json
{
  "matcher": "*",
  "hooks": [
    {
      "type": "command",
      "command": "node \"${CLAUDE_PLUGIN_ROOT}/packages/hooks/skill-index.js\"",
      "timeout": 5
    }
  ],
  "description": "WS-1 skill progressive disclosure"
}
```

## Implementation recap

At install, `writeSkillIndex(src)` parses each `SKILL.md` frontmatter (simple YAML-subset reader), aggregates `{name, description, autoInvoke:false, path}` into `~/.claude/.donnyclaude-skill-index.json`. At SessionStart, `skill-index.js` loads that index, merges `settings.json` `skills.autoInvoke` overrides, probes six known prompt-field paths in the hook stdin payload, tokenizes with stop-words, scores by description and name overlap (name weighted 2x), emits top-10 via `hookSpecificOutput.additionalContext`. Fail-open on every error path. Missing index yields a neutral "0 surfaced" message. Smoke-tested against the 104-skill catalog: REST API prompt correctly surfaces api-design, backend-patterns, django-patterns.

## Tests

10 passed, 0 failed. Coverage: tokenizer edge cases, prompt-field probing, scoring, autoInvoke overrides, top-K ranking, manifest rendering, end-to-end prompt-to-surface.

## Expected delta vs 9742c210 baseline (7.05M tokens, 90.3% cache)

Full skill catalog (name + description for 104 skills) measures 12,477 chars, approximately 3,119 tokens. Top-10 manifest averages approximately 300 tokens. **90% reduction in the skill-catalog portion of the always-loaded prefix, exceeding the >50% target at that layer.** Amplified across the baseline's 76 assistant turns, the session-total reduction is approximately 213K tokens, roughly 3.0% of the 7.05M total. The total-session figure is modest because the skill catalog is only one slice of the prefix; the catalog itself is cut by an order of magnitude.

## Known risks

1. SessionStart stdin prompt-field name is undocumented for Claude Code 2.1.x. Hook probes six candidates and falls back to a neutral no-op if none match.
2. Interaction with ECC's existing session-start.js (also emits additionalContext) not end-to-end tested.
3. Keyword matcher has no semantic recall; embeddings-based retrieval is deferred per spec.
4. autoInvoke defaults false for every skill; users must opt in per skill in settings.json to pin any skill.
5. `packages/hooks/package.json` with `type: commonjs` is required for local test execution. Strictly additive, no existing hook modified.

## Em-dash audit

Zero U+2014 and zero U+2013 across all files written.
