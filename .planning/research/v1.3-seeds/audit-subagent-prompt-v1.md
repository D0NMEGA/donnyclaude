# Phase 1 Audit Subagent Prompt

Reference snapshot SHA: 8d7ef909312fcb8544eebb469f515da965c9b1c3
Captured: 2026-04-13T07:18:05Z
Rubric version: v1.2-phase1

The SHA above is what the `reference_snapshot_sha` field in PRUNE-VERDICT.json must equal. Do not compute a fresh snapshot — this SHA is locked for Phase 1.

## Your Job

You are auditing 41 candidate skills from `packages/skills/` against a two-pass rubric. Your output is a `PRUNE-VERDICT.json` file matching the locked schema in §D-18 of CONTEXT.md (the JSON top-level includes a `reference_snapshot_sha` field — it must exactly match the SHA at the top of this prompt). Every verdict row MUST include per-clause `verdict` + `evidence` + `lines_cited`, and clause (c) MUST include `checked_paths` for provenance.

## CRITICAL: Frozen Reference Snapshot

Clause (c) of the training-duplicate rubric is "no internal references to this skill exist in donnyclaude's distribution." This evaluation MUST be done against the repo state at SHA `8d7ef909312fcb8544eebb469f515da965c9b1c3`, NOT against the in-progress pruned state.

Concretely: if you process skills alphabetically and flag `plankton-code-quality` for removal before reaching `verification-loop`, the reference from plankton → verification-loop disappears from the referrer set, and verification-loop's clause-(c) evidence changes mid-audit. Snapshot the reference graph BEFORE making any prune decisions, then evaluate all 41 candidates against the frozen snapshot.

Mechanism: Before evaluating any skill, run a single grep pass and write the result to a scratch file. Read the scratch file (not live grep output) when evaluating clause (c) for each candidate.

```bash
grep -rn -l --include='*.md' '\b\(skill-name-pattern\)\b' \
  packages/agents/ packages/hooks/ packages/commands/ \
  packages/skills/*/SKILL.md packages/rules/ \
  > .planning/phases/01-skill-audit-prune-rc-gate/.reference-graph-snapshot.txt
```

Adjust the grep regex to match the skill names you need to evaluate.

## Protected list (64 skills — DO NOT EVALUATE)

These 64 skills are protected and pass through the audit unchanged:

**60 gsd-* skills (structurally coupled to GSD workflow engine, D-06):**
All 60 directories matching `packages/skills/gsd-*`.

**4 non-gsd protected skills (D-04, D-05):**
- `skill-stocktake` — Test A (harness meta-tooling: distribution auditor with quick-diff.sh + results.json)
- `humanizer` — Test B (substantive anti-AI-voice taste encoding, v2.3.0)
- `strategic-compact` — Test B + executable (suggest-compact.js PreToolUse hook)
- `frontend-slides` — Test B (opinionated aesthetic taste claim, @zarazhangrui credit)

Emit these in PRUNE-VERDICT.json with `category: "protected"` and `verdict: "KEEP"` and `clauses: null` — they bypass both passes.

## Cruft determinations (D-08, D-09)

Two skills are removed as cruft, NOT via the rubric. Emit them in PRUNE-VERDICT.json with `category: "cruft"` and the sub-category as listed:

- `configure-ecc` — `cruft:unrelated-project-installer` — Step 0 of its SKILL.md `git clone`s `https://github.com/affaan-m/everything-claude-code.git` into `/tmp`. It is an installer for a different project (ECC), not donnyclaude infrastructure.
- `continuous-learning` OR `continuous-learning-v2` (whichever is the loser) — `cruft:version-superseded` — Read both SKILL.md files and identify which is the successor. Usually v2 unless v1 retains features v2 dropped. Record the loser as cruft and the winner as `category: "candidate"` (it advances to the rubric like any other candidate).

## The 41 rubric candidates

Every skill in `packages/skills/` that is NOT in the protected 64 AND NOT in the cruft determinations advances to the rubric. Build the candidate list from:

```bash
ls packages/skills | grep -v '^gsd-' | grep -vE '^(skill-stocktake|humanizer|strategic-compact|frontend-slides|configure-ecc)$'
```

Then resolve `continuous-learning` vs `continuous-learning-v2` per above (the loser drops out of the candidate list and into the cruft list; the winner stays). The grep above returns 42 entries (107 − 60 gsd-* − 4 non-gsd protected − 1 configure-ecc); after continuous-learning resolution drops the loser into cruft, **resulting count: 41**. The candidate list includes the four skills downgraded from the original protection candidate list per D-07: `eval-harness`, `plankton-code-quality`, `mcp-server-patterns`, and `iterative-retrieval` — they go through the rubric like any other candidate.

## Pass 1 — Cruft filter (positive test) — per D-11

For each candidate, ask:

> "Does this skill encode workflow, opinion, integration, or knowledge that is meaningfully tied to donnyclaude's supported tools (Claude Code, MCP servers, GSD engine, the rule files for the 13 supported languages, or the agents/hooks shipped in the distribution)?"

YES on any clause = passes the cruft filter and advances to Pass 2.
NO on all clauses = cruft removal, logged with category `cruft:origin-drift` (or another cruft sub-category if obvious).

Pay extra attention to skills with `origin: ECC` in the YAML frontmatter — that tag has hidden cruft once (`configure-ecc`).

## Pass 2 — Training-duplicate rubric (all three must be TRUE to PRUNE) — per D-12

**Clause (a) — Duplicates training-data knowledge**
Does this skill duplicate knowledge for a popular language/framework the model has extensive training-data coverage of?
- PASS (a fails) = unique/rare/specialized content NOT in training data
- FAIL (a triggers) = standard idioms covered extensively in training (e.g., python-patterns, golang-patterns, rust-patterns, kotlin-patterns, laravel-patterns, django-patterns, springboot-patterns, java-coding-standards, cpp-coding-standards)

**Clause (b) — No donnyclaude-specific glue**
Does the SKILL.md body reference donnyclaude-native agents, hooks, commands, rule files, MCP server conventions, or the GSD engine in a way that would break if the skill were removed?
- PASS (b fails) = has donnyclaude-specific glue
- FAIL (b triggers) = no donnyclaude-native references

**Clause (c) — No internal references**
Does anything else in donnyclaude's distribution reference this skill by name? Grep the FROZEN SNAPSHOT (not live state) across:
- `packages/agents/`
- `packages/hooks/`
- `packages/commands/`
- `packages/skills/*/SKILL.md`
- `packages/rules/`
PASS (c fails) = at least one referrer found
FAIL (c triggers) = zero referrers in the frozen snapshot

**Verdict logic:** ALL THREE clauses must FAIL (a fails AND b fails AND c fails) → `verdict: "PRUNE"`. Any clause PASSES → `verdict: "KEEP"` with the passing clause as the rationale. If you are uncertain on any clause, use `verdict: "UNCERTAIN"` and explain in the rationale field — UNCERTAIN verdicts are reviewed by a human in Plan 02.

## Worked examples (already-verified clause-c keeps from D-14)

These are NOT calibration anchors — they are reference examples showing how clause (c) is supposed to fire to protect glue-wired generic skills:

- `tdd-workflow` — fails (a) (generic TDD methodology) and fails (b) (no donnyclaude-native references in body). BUT clause (c) PASSES with 7 referrers: tdd-guide agent, tdd/go-test/cpp-test/kotlin-test commands, php/testing rule, commands/tdd.md body. Verdict: KEEP. Rationale: clause-c protection.

- `e2e-testing` — fails (a) (generic Playwright) and fails (b) (no donnyclaude-native references in body). BUT clause (c) PASSES with 2 referrers: e2e-runner agent, frontend-slides skill. Verdict: KEEP. Rationale: clause-c protection.

These two demonstrate the rubric working as designed — generic-content skills that ARE wired into donnyclaude's internal structure stay protected.

## Calibration set (5 skills, mandatory pre-flight)

Before processing the 41 candidates, evaluate these 5 pinned skills and emit a `calibration_results` block in PRUNE-VERDICT.json. Compare your verdicts to the expected verdicts.

| Skill | Expected verdict | Why this calibration anchor |
|-------|------------------|------------------------------|
| `python-patterns` | PRUNE | Pure language idioms; fails a, b, c |
| `golang-patterns` | PRUNE | Same pattern as python-patterns |
| `tdd-workflow` | KEEP | Tests clause-c protection (7 referrers) |
| `e2e-testing` | KEEP | Tests clause-c protection (2 referrers, harder than tdd-workflow) |
| `eval-harness` | PRUNE | Borderline: origin:ECC, generic EDD methodology, no donnyclaude glue, no spot-checked referrers |

**Calibration gate:** If your `agreement_count` is 5/5, set `proceed: true` in the calibration_results block and continue to the full pass. If agreement is 4/5 or worse, set `proceed: false` and STOP. Do NOT process the 41 candidates. The human reviewer in Plan 02 will tighten the rubric prompt and re-run calibration before the full pass is allowed.

## Output: PRUNE-VERDICT.json schema (locked, D-18)

Write your output to `.planning/phases/01-skill-audit-prune-rc-gate/PRUNE-VERDICT.json` with this EXACT shape:

```json
{
  "version": "1.0",
  "rubric_version": "v1.2-phase1",
  "generated_at": "{ISO-8601 timestamp}",
  "reference_snapshot_sha": "8d7ef909312fcb8544eebb469f515da965c9b1c3",
  "calibration_results": {
    "pinned_skills": ["python-patterns", "golang-patterns", "tdd-workflow", "e2e-testing", "eval-harness"],
    "expected_verdicts": {
      "python-patterns": "PRUNE",
      "golang-patterns": "PRUNE",
      "tdd-workflow": "KEEP",
      "e2e-testing": "KEEP",
      "eval-harness": "PRUNE"
    },
    "actual_verdicts": { "python-patterns": "...", "golang-patterns": "...", "tdd-workflow": "...", "e2e-testing": "...", "eval-harness": "..." },
    "agreement_count": 0,
    "proceed": false
  },
  "verdicts": [
    {
      "skill": "python-patterns",
      "category": "candidate",
      "verdict": "PRUNE",
      "clauses": {
        "a": { "verdict": "FAIL", "evidence": "Lines X-Y enumerate standard Python idioms covered extensively in training data", "lines_cited": [X, Y] },
        "b": { "verdict": "FAIL", "evidence": "No references to donnyclaude conventions; pure language reference", "lines_cited": [] },
        "c": { "verdict": "FAIL", "evidence": "grep against frozen snapshot returned 0 matches in referrer set", "checked_paths": ["packages/agents/", "packages/hooks/", "packages/commands/", "packages/skills/*/SKILL.md", "packages/rules/"], "referrer_lines": [] }
      },
      "recommendation": "PRUNE",
      "rationale": "Pure language reference, no donnyclaude glue, no internal references. Training-duplicate."
    }
  ]
}
```

Notes:
- Every candidate verdict MUST have all three clauses populated, even if the verdict is KEEP after one clause passes
- Cruft entries use `category: "cruft"` and `clauses: null`; their rationale field carries the cruft sub-category
- Protected entries use `category: "protected"`, `verdict: "KEEP"`, `clauses: null`, and a one-line rationale ("60 gsd-* protected per D-06" or the specific D-05 anchor)
- The `rationale` field for prune verdicts is short (1-2 sentences); the human reviewer in Plan 02 may rewrite it before it lands in PRUNE-LOG.md

## Asymmetric risk reminder (D-15)

False-positive prunes (skills that should have been kept) are user-facing and harder to reverse. False-negative keeps (skills that should have been pruned) are recoverable in v1.3. When uncertain, use UNCERTAIN, not PRUNE. The human reviewer will resolve UNCERTAIN cases in Plan 02.
