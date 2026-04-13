# Changelog

All notable changes to donnyclaude are recorded here. Releases before v1.2.0 predate this changelog; see `git log --oneline` for history.

## [1.2.0] - 2026-04-13

### Removed
- **configure-ecc** — installer for an unrelated project (`everything-claude-code`). Its Step 0 `git clone`s a different repo into `/tmp`. Archived to `packages/_archived-skills/`.
- **continuous-learning** — version-superseded duplicate of `continuous-learning-v2` (v2.1.0 is a strict superset with 100% reliable hook observation, atomic instincts with confidence scoring, project scoping, and six commands). Archived to `packages/_archived-skills/`.

Skill count: 107 → 105.

### Deferred
- The broader training-duplicate prune originally scoped for v1.2 (20-30 language-pattern and methodology skills) is deferred to v1.3 pending rubric redesign. The initial rubric's calibration pre-flight surfaced that clause (c) cannot reliably distinguish training-duplicate skills from catalog cross-links in the current distribution — every candidate skill has the same bare-pointer referrer pattern as the skills the plan explicitly protected (tdd-workflow, e2e-testing). See [`docs/PRUNE-LOG.md`](PRUNE-LOG.md) and `.planning/phases/01-skill-audit-prune-rc-gate/01-CONTEXT.md#Corrections` for the full analysis. Partial audit artifacts preserved at `.planning/research/v1.3-seeds/` as v1.3 research inputs.

See [`docs/PRUNE-LOG.md`](PRUNE-LOG.md) for per-skill rationale and restore commands.
