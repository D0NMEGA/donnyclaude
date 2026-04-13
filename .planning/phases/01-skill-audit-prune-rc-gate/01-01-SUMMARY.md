---
plan: 01-01
phase: 01-skill-audit-prune-rc-gate
status: complete
completed_at: 2026-04-13
commit: 0a1a913
---

# Plan 01-01 Summary — Cruft-only atomic commit

## What shipped

Archived 2 cruft skills from `packages/skills/` to `packages/_archived-skills/` via `git mv` (reversible, per D-24). Wrote the full documentation trail per D-25/D-26/D-27/D-28 and updated README.md badges/body from 107 to 105.

## Continuous-learning winner/loser decision

- **Winner:** `continuous-learning-v2` (v2.1.0)
- **Loser:** `continuous-learning` (v1, archived)
- **Rationale:** v2.1 is a strict superset. v1 uses probabilistic Stop-hook observation (~50-80% fire rate per v1's own SKILL.md comparison section); v2 uses PreToolUse/PostToolUse hooks with 100% reliability. v2 adds atomic instinct granularity, confidence scoring (0.3-0.9), project-scoped vs global separation, six commands (`/instinct-status`, `/evolve`, `/instinct-export`, `/instinct-import`, `/promote`, `/projects`), and explicit v1 backward compatibility. v1's SKILL.md contains a "Comparison Notes" section framing v2 as the more sophisticated successor. No v1-only features are retained.

## Counts

| Metric | Pre-commit | Post-commit |
|--------|------------|-------------|
| `packages/skills/` directories | 107 | 105 |
| `packages/_archived-skills/` directories | 0 | 2 |
| `packages/_archived-skills/README.md` | missing | present |
| `docs/PRUNE-LOG.md` rows (Cruft removals) | file missing | 2 |
| `docs/CHANGELOG.md` entries | file missing | 1 (v1.2.0) |
| README.md `\b107\b` references | 6 | 0 |
| README.md `\b105\b` references | 0 | 6 |
| Cross-references to archived v1 name outside archive | 3 (broken) | 0 |

## Commit

- **SHA:** `0a1a913`
- **Subject:** `feat(skills): archive 2 cruft skills for v1.2 cruft-only prune`
- **Files changed:** 12 (63 insertions, 13 deletions)
- **Includes:**
  - 2 directory renames (configure-ecc + continuous-learning → _archived-skills/)
  - 4 file renames inside those directories (SKILL.md + config.json + evaluate-session.sh)
  - 3 new files (docs/PRUNE-LOG.md, docs/CHANGELOG.md, packages/_archived-skills/README.md)
  - 1 README.md update (6 skill-count references: 107 → 105)
  - 3 cross-reference fixes (iterative-retrieval, strategic-compact, packages/hooks/README.md — all now point at `continuous-learning-v2` instead of the archived v1 name)
  - 1 PROJECT.md retrospective (cost analysis of the calibration-gate pivot: ~40 min review + ~90 min execution vs 6-20 hour counterfactual)

## Verification results

- `ls packages/skills | wc -l` = 105 ✓
- `ls packages/_archived-skills | wc -l` = 3 (2 archived directories + README.md stub) ✓
- `test -d packages/_archived-skills/configure-ecc` ✓
- `test -d packages/_archived-skills/continuous-learning` ✓
- `test -d packages/skills/continuous-learning-v2` ✓ (winner retained)
- `node --test tests/install.test.js` = 29/29 pass ✓
- Pre-stage and post-stage tests confirmed the filesystem state is consistent through git's atomic staging ✓
- Pre-commit grep for `continuous-learning[^-]` references outside archive found 3 broken references (iterative-retrieval, strategic-compact, hooks/README.md); all fixed in-commit ✓
- Pre-commit grep for `configure-ecc|everything-claude-code` references found only legitimate ECC plugin infrastructure references (hooks.json, skill-health.md, sessions.md) — unaffected by archival ✓

## Next plan

**Plan 01-02:** version bump `package.json` from `1.1.0` to `1.2.0-rc.1`, `npm publish --tag rc`, create GitHub pre-release tag `v1.2.0-rc.1` pointing at this commit (`0a1a913`), write release notes referencing `docs/PRUNE-LOG.md` and explicitly noting the training-duplicate deferral to v1.3.

## Notes

- The training-duplicate prune originally scoped for this phase was deferred to v1.3 after the 5-skill calibration pre-flight surfaced a fundamental clause-(c) limitation in the rubric. Partial audit artifacts are preserved at `.planning/research/v1.3-seeds/` as v1.3 research seeds. See `01-CONTEXT.md#Corrections` (entry dated 2026-04-13) for the full analysis.
- The cost retrospective captured in PROJECT.md Key Decisions: the calibration gate cost ~2 hours of combined time and saved an estimated 6-20 hours of counterfactual rework. The rule-vs-gate principle is now captured durably for future phases.
