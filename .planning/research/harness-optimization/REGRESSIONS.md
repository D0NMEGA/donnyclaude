# Harness Optimization Regressions (Step 2 gate)

Generated: 2026-04-23 UTC
Purpose: Flag any workstream whose Step 2 DELTA shows a worse-than-baseline metric. Per user directive, flagged workstreams are NOT committed; they are surfaced here for discussion.

## RESOLVED 2026-04-23: WS-1 shipped via Path B

The original flag stands for audit trail (see below) but the regression is resolved. User picked Path B, verified `disable-model-invocation: true` is honored in Claude Code 2.1.117 via a fresh-subprocess empirical test (test skill with the flag set to true did NOT appear in the subprocess's skill catalog; 0 occurrences of skill name / description / directive text in the JSONL's system prompt, 4 occurrences of the sentinel phrase all attributable to user-prompt echoes). Scope expansion granted for WS-1 ONLY (other workstreams and the v1.3 prune question remain untouched). Implementation lands the frontmatter flip at install time on the runtime copies at `~/.claude/skills/*/SKILL.md`, not the source tree at `packages/skills/*/SKILL.md`. Re-measurement shows 78.4% composite reduction, exceeding the >50% target. Full record in `ws-1/SCOPE-EXPANSION.md`.

---

## Original flag (preserved for audit trail)

## WS-1 Skill Progressive Disclosure: FLAGGED

### The regression

MEASURED metric in DELTA.md: "Composite always-on tokens (native catalog + WS-1 manifest)" shows +415 tokens (+13.0%) vs the 3,196-token name-and-description baseline. This is worse than baseline on the skill-catalog always-on dimension.

### Root cause

WS-1 as shipped is purely additive. It does the following:
- Writes `~/.claude/.donnyclaude-skill-index.json` at install time (new file, not read by Claude Code natively).
- Registers a SessionStart hook that emits a top-K manifest as `hookSpecificOutput.additionalContext` (additive injection).

It does not do the following:
- Set `disable-model-invocation: true` on any skill's frontmatter.
- Modify packages/skills/*/SKILL.md.
- Hook into Claude Code's native skill-loading behavior to suppress the always-on catalog.

Result: Claude Code's native catalog (all 105 descriptions, 3,196 tokens) still loads on every session prefix. WS-1's top-K manifest (415 tokens) adds to that, not replaces it.

### Why this matters

The spec in DEEP-RESEARCH.md rec #1 and SUMMARY.md priority #1 states the goal as ">50% reduction in always-loaded skill token overhead." The intent is replacement behavior. WS-1's additive implementation cannot hit that target by arithmetic: adding tokens, however relevant, cannot reduce always-on token count.

The architectural path to actual replacement requires modifying SKILL.md frontmatter for skills that are NOT in the always-on top-K, which is out of scope per the hard constraint: "Do not touch packages/skills/ content; the prune question is v1.3 work per the deferral."

### Three paths forward (user chooses)

**Path A: Commit WS-1 anyway with the accurate framing**  
Reframe the workstream's goal in its commit message and SUMMARY.md as "prompt-aware skill surfacing to reduce wrong-skill-invocation rates, additive context cost of ~415 tokens per session" rather than ">50% token reduction." Ship the plumbing; accept that the measurable token delta is +13% on the specific dimension, approximately +0.45% amortized across a 76-turn session. Behavioral value (top-K steering) is projected but unmeasured.

Pro: lands the infrastructure so when a v1.3 milestone re-opens packages/skills/ scope, the frontmatter flip is a small patch on top.  
Con: ships a feature that violates its stated spec goal. Arguably dishonest to call it "progressive disclosure" when it is additive overlay.

**Path B: Extend scope for this run only**  
Relax the "do not touch packages/skills/" constraint for WS-1 specifically. Modify the 95 skills that score below the top-10 threshold to include `disable-model-invocation: true`. This achieves actual replacement: native catalog shrinks to 10 skills (those with autoInvoke), WS-1's manifest surfaces all 105 as name-referencable.

Pro: hits the >50% spec goal honestly.  
Con: violates a hard constraint without explicit user permission. Couples v1.2 harness work to v1.3 skill-prune discussion. Risk: if a skill that was relied-on semantically gets disabled-model-invocation, behavior changes.

**Path C: Defer WS-1 entirely to a v1.3-scoped milestone**  
Do not commit WS-1's implementation files. Remove WS-1's hooks.json registration. Keep the research artifacts (HOOK-PATCH.md, SUMMARY.md) for reference. Re-approach WS-1 as part of v1.3 once the skill-prune rubric redesign is done (see .planning/research/v1.3-seeds/README.md).

Pro: honors every hard constraint. Keeps the architectural gap as a known open question for v1.3, where the rubric redesign can address replacement properly.  
Con: WS-1 represents the biggest potential token win per DEEP-RESEARCH.md; deferring it costs time-to-value on the largest lever.

### Recommendation

Path A is the pragmatic ship-what-works choice. It captures the engineering work, lands the autoInvoke plumbing in bin/donnyclaude.js and settings-template.json, and registers the hook. Future v1.3 work (modifying SKILL.md frontmatter for replacement) becomes a small patch on top. The honest framing fixes the spec mismatch: the workstream's real value is prompt-aware steering, not token reduction.

Path C is the spec-purist choice. Sound if the user wants to keep v1.2 harness work strictly to things that hit their targets.

Path B is not recommended without explicit scope expansion from the user.

## WS-2, WS-3, WS-4: CLEAN

None of the other three workstreams show a regression in their Step 2 DELTA measurements.

- WS-2 delta on baseline-specific failures is 0/0 (null-null) because baseline's failures were Bash, not Edit. Architecture is sound. Commit.
- WS-3 PASS on synthetic round-trip. All 8 backup fields present. Restore advisory injection works. Commit.
- WS-4 83 ms median cold-start latency, 83.4% reduction in hooks.json block size, structured context payload of 138 tokens. Commit.

## Current state on disk

WS-1's implementation files exist in the working tree, uncommitted, pending user decision on Path A vs B vs C. hooks.json in the working tree currently includes the WS-1 registration entry (added during the Step 1 jq merge). Before committing WS-2, WS-3, WS-4, the orchestrator will revert hooks.json to its pre-merge state and re-apply only WS-2, WS-3, WS-4 so that the WS-1 registration does not land in the committed history.

WS-1 working-tree files (will remain uncommitted pending path choice):
- `bin/donnyclaude.js` (+91 / -1 modification)
- `packages/core/settings-template.json` (+5 addition)
- `packages/hooks/skill-index.js` (new, 166 lines)
- `packages/hooks/skill-index.test.js` (new, 119 lines)
- `packages/hooks/package.json` (new, 6 lines; CommonJS scope for hook tests; orchestrator will commit this separately as an infra-only commit since it enables WS-2, WS-3, WS-4 tests too, not strictly WS-1-specific)

## Em-dash audit

Zero U+2014 and zero U+2013 in this document. Verified on completion.
