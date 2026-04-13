# Prune Log — v1.2.0

This document records every skill archived from `packages/skills/` during the v1.2 prune pass. Each row carries the skill name, the category that triggered removal, the literal rationale, the archive path, a copy-pasteable restore command, and the archive date.

**Scope for v1.2:** cruft-only. The training-duplicate rubric was attempted during Phase 1 planning and deferred to v1.3 after the 5-skill calibration pre-flight surfaced that clause (c) could not distinguish training-duplicate skills from catalog cross-links in the current codebase. See `.planning/phases/01-skill-audit-prune-rc-gate/01-CONTEXT.md#Corrections` (entry dated 2026-04-13) and `.planning/research/v1.3-seeds/` for the full analysis.

## Cruft removals

| name | category | clause | rationale | archive_path | restore_command | date_archived |
|------|----------|--------|-----------|--------------|-----------------|---------------|
| configure-ecc | cruft:unrelated-project-installer | (d) positive test failed | Step 0 of configure-ecc/SKILL.md `git clone`s `https://github.com/affaan-m/everything-claude-code.git` into `/tmp`. It is an installer for a different project (ECC), not donnyclaude infrastructure. Not meaningfully tied to donnyclaude's supported tooling. | `packages/_archived-skills/configure-ecc/` | `git mv packages/_archived-skills/configure-ecc packages/skills/configure-ecc` | 2026-04-13 |
| continuous-learning | cruft:version-superseded | (d) positive test failed | Superseded by `continuous-learning-v2` (v2.1.0). v2.1 is a strict superset: 100% reliable PreToolUse/PostToolUse hook observation (v1 uses probabilistic Stop-hook per its own SKILL.md comparison), atomic instinct granularity with 0.3-0.9 confidence scoring, project-scoped + global separation, six commands (`/instinct-status`, `/evolve`, `/instinct-export`, `/instinct-import`, `/promote`, `/projects`), and explicit v1 backward compatibility. v1's own SKILL.md frames v2 as the more sophisticated successor. No v1-only features are retained. | `packages/_archived-skills/continuous-learning/` | `git mv packages/_archived-skills/continuous-learning packages/skills/continuous-learning` | 2026-04-13 |

## Training-duplicate removals

*No training-duplicate removals in v1.2.*

The training-duplicate prune originally scoped for v1.2 was deferred to v1.3 after the 5-skill calibration pre-flight surfaced that the rubric's clause (c) cannot distinguish training-duplicate skills from catalog cross-links in the current codebase. Every candidate skill has the same bare-pointer referrer pattern (reviewer agents, rule files, and commands all use `see skill: X` catalog entries rather than semantic dependencies). The rubric as written keeps all of them; a rubric that excludes bare pointers would prune all of them including skills the plan explicitly protected (tdd-workflow and e2e-testing in D-14).

See:
- `.planning/phases/01-skill-audit-prune-rc-gate/01-CONTEXT.md#Corrections` (entry dated 2026-04-13) — full analysis and option tree
- `.planning/research/v1.3-seeds/README.md` — v1.3 research questions
- `.planning/research/v1.3-seeds/PRUNE-VERDICT-partial-v1.json` — the 5-skill calibration evidence with per-referrer type classification

## Restoration

Every row in the Cruft removals table above includes a literal `restore_command` — a copy-pasteable shell command. If you need a removed skill, copy-paste the `restore_command` cell value, no translation required. The removal uses `git mv`, so restoration preserves full file history (run `git log --follow` to walk the original history).

If restoration is needed post-release: file an issue labeled `prune-regression` against this repo with the skill name and the use case that required it, then run the corresponding `restore_command` locally.
