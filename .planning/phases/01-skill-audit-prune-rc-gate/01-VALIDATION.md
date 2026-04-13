---
phase: 1
slug: skill-audit-prune-rc-gate
status: accepted
nyquist_compliant: inline
wave_0_complete: true
created: 2026-04-12
---

# Phase 1 — Validation Strategy (Inline)

No formal research was run for this phase (CONTEXT.md locks all 28 decisions). The validation surface is existing and concrete; this file points to it rather than fabricating a Validation Architecture.

## Validation Surface

| Surface | Location | What it validates |
|---------|----------|-------------------|
| **Install count test** | `tests/install.test.js:60` (floor moved to 70 in scoping-correction commit per D-02) | Skill directory count stays in the 75-85 target band with margin |
| **Audit output schema** | `CONTEXT.md` §D-18 (PRUNE-VERDICT.json locked shape) | Per-clause evidence, `reference_snapshot_sha`, and `calibration_results.agreement_count == 5` |
| **PRUNE-LOG row schema** | `CONTEXT.md` §D-26 (7-column locked shape) | Every removed skill has `name`, `category`, `clause`, `rationale`, `archive_path`, literal `restore_command`, `date_archived` |
| **Gate criteria** | `CONTEXT.md` §D-20 | Zero `prune-regression` issues over 7×24h from npm publish moment |
| **Cooling-off obligations** | `CONTEXT.md` §D-21 (a/b/c) | Day 4-5 re-read of PRUNE-LOG, fresh-machine `npx donnyclaude@rc` test, real-workflow use of a borderline survivor |

## Sampling Rate

- **After scoping-correction commit:** `node --test tests/install.test.js` exits 0 against the floor change
- **After prune-execution commit:** `node --test tests/install.test.js` exits 0 with the actual pruned count; `ls packages/skills | wc -l` yields a number in [75, 85]
- **Pre-publish:** `npm pack --dry-run` shows expected file set; PRUNE-LOG.md exists; PRUNE-VERDICT.json exists in `.planning/phases/01-.../`
- **Post-publish (gate window):** Daily glance at `gh issue list --label prune-regression`; obligations (a)/(b)/(c) executed once each

## Manual-Only Verifications

| Behavior | Why Manual | Instructions |
|----------|------------|--------------|
| PRUNE/UNCERTAIN verdict review | Asymmetric-risk direction per D-15: false-positive prunes are user-facing and harder to reverse | Human reads every PRUNE and UNCERTAIN row in PRUNE-VERDICT.json; KEEPs skimmed but not individually audited |
| Fresh-machine install test (D-21b) | Runtime regressions surface only in a clean `~/.claude/` | Container or second machine with no customizations; `npx donnyclaude@rc`; run a typical GSD session end-to-end |
| Borderline-survivor workflow test (D-21c) | Catches "protected it but it's broken" bugs | Pick one of strategic-compact / humanizer / frontend-slides and use in a real workflow during the gate week |

*Dimension 8 (Nyquist) note: this file satisfies the "validation contract exists" check by pointing to concrete pre-existing surfaces. No new formal architecture was invented.*
