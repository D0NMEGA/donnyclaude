# v1.3 Research Seeds — Skill Prune Rubric

This directory preserves the partial audit work from v1.2 Phase 1 that surfaced — and was halted by — a fundamental issue with the training-duplicate prune rubric. These artifacts feed v1.3 planning when the rubric is redesigned.

## Why these artifacts exist here, not in Phase 1

v1.2 Phase 1 was originally scoped to prune 20-30 training-duplicate skills from `packages/skills/` to land the final count in a [75, 85] target band. The phase's audit protocol included a 5-skill calibration pre-flight (`python-patterns`, `golang-patterns`, `tdd-workflow`, `e2e-testing`, `eval-harness`) that the subagent had to pass 5/5 before being allowed to run the full 41-candidate pass.

The calibration gate fired correctly on the first attempt — `agreement_count` landed at 2/5 — and that's when we discovered the rubric's clause (c) cannot distinguish training-duplicate skills from legitimate skills in this codebase, because **every skill reference in donnyclaude's distribution is a bare pointer or catalog entry, not a semantic dependency.**

## What the evidence showed

Clause (c) of the rubric asked: "does anything else in donnyclaude's distribution reference this skill by name?" The planner's implicit assumption was that:

- `python-patterns` would have zero referrers → PRUNE
- `golang-patterns` would have zero referrers → PRUNE
- `tdd-workflow` would have 7 referrers from agents/commands/rules → KEEP
- `e2e-testing` would have 2 referrers → KEEP
- `eval-harness` would have zero referrers → PRUNE

Actual grep results against the frozen reference snapshot (SHA `8d7ef909312fcb8544eebb469f515da965c9b1c3`):

| Skill             | Non-cruft referrers | Type breakdown                                |
|-------------------|---------------------|-----------------------------------------------|
| python-patterns   | 5                   | 3 bare-pointers, 1 catalog, 1 example-mention |
| golang-patterns   | 6                   | 4 bare-pointers, 2 catalog                    |
| tdd-workflow      | 9                   | 4 bare-pointers, 5 catalog                    |
| e2e-testing       | 2                   | 2 bare-pointers                               |
| eval-harness      | 0                   | (1 cruft-only referrer from configure-ecc)    |

The tdd-workflow referrer in `strategic-compact/SKILL.md` that looked like it might be a semantic dependency turned out to be documentation inside a "Trigger-Table Lazy Loading" section that describes a general pattern. Two of the three example skills in that table (`security-review`, `deployment-patterns`) don't exist in the distribution, and the `suggest-compact.sh` hook script contains zero references to any of the skill names in the table. It's pure documentation.

**Conclusion:** There is no structural difference between tdd-workflow and python-patterns in the current codebase. Both have the same reviewer-agent / command / rule-file pointer pattern. The rubric treats them identically (all KEEP), and there's no "semantic dependency" pattern to carve a refined rubric around because no skill in the distribution has semantic dependencies — they're all catalog entries and cross-links.

## What v1.2 shipped instead

v1.2 Phase 1 was restructured to ship a **cruft-only prune**:

1. `configure-ecc` — installer for a different project (everything-claude-code), `git clone`s an unrelated repo into `/tmp`. Removed as cruft per D-08.
2. `continuous-learning` loser (winner TBD at execution time per D-09) — version-superseded duplicate.

Final count: 107 − 2 = **105 skills**. Target band revised from [75, 85] to exactly 105.

The aggressive training-duplicate prune is deferred to v1.3 pending rubric redesign.

## What v1.3 needs to figure out

The open research question for v1.3 is: **what does "semantic dependency" mean in a distribution where every skill reference is a catalog-linked pointer?**

Possible angles:

1. **Runtime loading signal.** Donnyclaude's progressive disclosure (v1.2 Phase 2, SKILLS-03) will build a skill index that loads skills on-demand when keyword triggers fire. After progressive disclosure ships, a skill's "usage" is the set of contexts where it's actually loaded, not the set of files that mention its name. Runtime load logs could drive a usage-based prune decision.

2. **Agent system prompt embedding.** Some agents may inline a skill's content directly into their system prompt (rather than pointing at it with "see skill: X"). Those are true dependencies. A grep for skill content fragments inside agent prompt files — rather than skill names — would surface these.

3. **MCP tool search changes.** Donnyclaude's research (`.planning/research/DEEP-RESEARCH.md`) mentions experimental MCP tool search as an alternative to skill-index-based loading. If MCP tool search becomes the canonical retrieval mechanism, the prune question reframes: which skills are discoverable via semantic tool search vs which are dead weight?

4. **Training-data duplication, measured differently.** Rather than using internal referrers as a proxy for "worth keeping," directly measure training-data overlap: score each skill's content against its frequency in training corpus. Skills with high training-data coverage AND no donnyclaude-specific content are candidates regardless of referrer count.

5. **Category-based prune rather than per-skill rubric.** The planner's instinct to group candidates by category (language-patterns, testing-frameworks, verification-loops) was right. A category-level decision ("prune all language-pattern skills for popular languages") may be more defensible than a per-skill rubric that every calibration candidate passes identically.

v1.3 planning should start from these angles, not from rewriting clause (c) in isolation.

## Files in this directory

### `audit-subagent-prompt-v1.md`

The full v1.2 Phase 1 audit subagent prompt as authored during execution. Includes:
- Locked reference SHA (`8d7ef909312fcb8544eebb469f515da965c9b1c3`)
- Frozen-snapshot discipline for clause (c) (D-13)
- Protected list (64 skills: 60 gsd-* + 4 non-gsd from D-04/05/06)
- Cruft determinations (D-08/09)
- Pass 1 cruft filter + Pass 2 three-clause training-duplicate rubric (D-11/12)
- 5-skill calibration set and expected verdicts (D-16)
- PRUNE-VERDICT.json output schema (D-18)

This prompt is **functionally correct given its premises**, but the premises (specifically the expected calibration verdicts) were based on incorrect spot-checks. Preserve as the v1.3 starting point for what a rubric looks like, then replace clause (c) with whatever semantic-dependency test v1.3 settles on.

### `PRUNE-VERDICT-partial-v1.json`

Partial audit output: calibration_results block (agreement_count=2, proceed=false) plus full verdicts[] entries for all 5 calibration skills with per-clause evidence and referrer classification.

The `referrer_lines[]` arrays inside each clause-(c) entry classify each referrer by type (`bare-pointer`, `catalog-entry`, `example-mention`, `cruft-catalog`, `self-section-link`, `semantic-dependency`). This is the concrete evidence that collapsed the tdd-workflow-vs-python-patterns distinction.

v1.3 rubric redesign should start by reading this file and asking: "given this classification, what test would have produced a 5/5 calibration on a differently-pinned set?"

### `reference-graph-snapshot-5skill-sample.txt`

Raw grep output for the 5 calibration skills against the frozen SHA reference graph (agents, hooks, commands, skills, rules). 42 total referrer lines across the 5 skills. Used as the input to clause (c) evaluation for the calibration pass.

Not sufficient for the full 41-candidate audit — that would require a grep covering all 41 names. v1.3 should re-snapshot against whatever pre-prune SHA is in effect then.

## Durable lesson

The calibration gate worked as designed. The reason the 5-skill pre-flight step was added during Phase 1 context-gathering was precisely so that a misconceived rubric would fail at calibration rather than producing 41 bad verdicts. It caught a real problem before the full pass ran. This validates the calibration-before-full-pass protocol for any future audit-subagent work.

---

**Generated:** 2026-04-13
**v1.2 milestone:** Ships cruft-only prune (107→105)
**v1.3 milestone:** Rubric redesign + aggressive prune attempt
