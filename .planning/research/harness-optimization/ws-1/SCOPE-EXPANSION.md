# WS-1 Scope Expansion (approved by user, 2026-04-23)

## Context

Step 2 DELTA.md surfaced that WS-1 as shipped in Step 1 was purely additive: it registered a SessionStart hook that emitted a top-K skill manifest, but it did nothing to suppress Claude Code's native always-loaded skill catalog. The measured delta was +13% on the skill-catalog-always-on dimension, a regression against the >50% reduction target from DEEP-RESEARCH.md rec #1.

REGRESSIONS.md flagged WS-1 and offered three paths: (A) commit with a reframed goal, (B) expand scope to modify SKILL.md frontmatter, (C) defer to v1.3.

## User decision

Path B, conditional on verifying that `disable-model-invocation: true` is actually honored by this Claude Code version (2.1.117). The verification was required to be blocking.

## Verification (2026-04-23, before Path B execution)

A test skill was created at both `packages/skills/_ahol-test-disable/SKILL.md` and `~/.claude/skills/_ahol-test-disable/SKILL.md` with the frontmatter:

```yaml
---
name: ahol-disable-test
description: Use this skill when the user mentions the sentinel phrase qqzzyy-plexus-3847 ...
disable-model-invocation: true
---
```

A fresh `claude --print --model opus` subprocess was spawned and asked to list any skill whose description contained the sentinel phrase.

Results:
- Subprocess response: `NONE`
- JSONL of fresh subprocess session: 0 occurrences of the skill name `ahol-disable-test`, 0 occurrences of the skill description text, 0 occurrences of the string `disable-model-invocation`. The 4 occurrences of the sentinel phrase were all in the user prompt echoes (queue-operation, user message, last-prompt tracking), never in system-prompt skill catalog context.

Verdict: **disable-model-invocation: true is honored in Claude Code 2.1.117.** Path B viable.

Both test skill directories were deleted after verification.

## Scope expansion granted

The hard constraint "Do not touch packages/skills/ content; the prune question is v1.3 work per the deferral" was relaxed for WS-1 ONLY. Other workstreams and the v1.3 prune question remain untouched.

In practice, the implementation did NOT modify any file in packages/skills/. The frontmatter flip happens at install time in `bin/donnyclaude.js`, modifying the installed copies at `~/.claude/skills/*/SKILL.md` rather than the source tree at `packages/skills/*/SKILL.md`. This keeps the source tree clean and reproducible while achieving the equivalent runtime effect.

The scope expansion approval was nonetheless necessary because the install-time behavior of touching `SKILL.md` files was architecturally adjacent to the prohibited zone.

## Implementation

`bin/donnyclaude.js` gains four additions:

1. `DEFAULT_TOP_K_AUTOINVOKE_SKILLS` constant: a frozen array of 10 GSD workflow skills that get `disable-model-invocation: false` at install time. Chosen for the core GSD loop coverage (new-project, new-milestone, plan-phase, discuss-phase, execute-phase, autonomous, progress, next, verify-work, ship).

2. `loadUserAutoInvokeOverrides()` helper: reads the user's existing `~/.claude/settings.json` and extracts the `skills.autoInvoke` block, filtered to boolean-valued entries. Missing file, malformed JSON, or missing block all resolve to `{}`. User explicit booleans win over the top-K default, so `settings.json` is the stable way to pin or unpin a skill across reinstalls.

3. `setFrontmatterBoolean(content, key, value)` helper: upserts a single boolean key into a markdown YAML frontmatter block. Replaces existing line if present, appends to end of block if not, adds a fresh frontmatter block if the file has none. Returns the new content. Pure function.

4. `applyInvocationFlags(installedSkillsDir, topKAllowed, userOverrides)` helper: walks the installed skills directory, parses each SKILL.md frontmatter, computes `autoInvoke = userOverrides[name] ?? topKAllowed.has(name)`, writes `disable-model-invocation: <not autoInvoke>` back to the file. Reports `flipped / kept / skipped` counts. Fails soft (writes a warning on IO errors, does not abort the install).

`writeSkillIndex(skillsSrc, topKAllowed, userOverrides)` is extended to take the same top-K + overrides, so the index file's `autoInvoke` field reflects the flags applied to disk. Previously defaulted to `false` for every skill.

The install-time call site is updated so both functions run in the same pass, with the same top-K and overrides, producing a consistent index-and-frontmatter state.

## Verification (Path B, post-implementation)

Syntax check: `node --check bin/donnyclaude.js` → OK.

Integration test against a fake install dir at `/tmp/pathb-test`:
- Copied 3 real SKILL.md files (gsd-plan-phase, python-patterns, tdd-workflow) into the fake install.
- Ran `applyInvocationFlags` equivalent logic with `topK = {gsd-plan-phase}`.
- Asserted: gsd-plan-phase gets `disable-model-invocation: false`, python-patterns and tdd-workflow get `disable-model-invocation: true`.
- Result: 3/3 PASS.

Unit tests on the runtime hook side: `node packages/hooks/skill-index.test.js` → 10/10 pass (unchanged behavior).

## Measurement (DELTA.md WS-1 row update)

Baseline: 105 skills, 3,196 tokens always-loaded skill catalog.

Post-Path-B:
- Native catalog after disable-model-invocation flips: only 10 top-K skills' name+description in the always-loaded system-prompt catalog. Sum: 1,097 chars = 274 tokens. -91.4% on native catalog.
- WS-1 runtime manifest: ~415 tokens per session (unchanged from Step 1 measurement).
- Composite always-loaded: 274 + 415 = 689 tokens. -78.4% vs baseline 3,196.

>50% reduction target: **MET (78.4% reduction).**

## Rotation (future enhancement, deferred)

The top-K list is statically defined in `DEFAULT_TOP_K_AUTOINVOKE_SKILLS`. A future enhancement could rotate or re-rank based on continuous-learning-v2 usage frequency logs, per-project context (e.g., elevate python-patterns automatically in Python projects), or AHOL-style benchmark-scored rotations. This is out of scope for WS-1 Path B.

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
