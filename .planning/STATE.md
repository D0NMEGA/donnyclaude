---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: milestone
status: executing
last_updated: "2026-04-13T08:00:00.000Z"
last_activity: 2026-04-13 -- Phase 01 restructured 5→3 plans (rubric deferred to v1.3)
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 3
  completed_plans: 0
  percent: 0
---

# State

## Current Position

Phase: 01 (skill-audit-prune-rc-gate) — EXECUTING (restructured to cruft-only)
Plan: 1 of 3 (cruft-only execution)
Status: Executing Phase 01 (rubric deferred to v1.3)
Progress: [▱▱▱▱▱] 0/5 phases complete
Last activity: 2026-04-13 -- Phase 01 restructured 5→3 plans after calibration gate surfaced rubric limitation
Resume file: .planning/phases/01-skill-audit-prune-rc-gate/01-CONTEXT.md (see #Corrections section dated 2026-04-13)

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-12)
See: `.planning/ROADMAP.md` (created 2026-04-12)

**Core value:** Zero to autonomous AI-assisted development in one command
**Current focus:** Phase 01 — ship cruft-only prune (107→105) as v1.2.0-rc.1; training-duplicate prune deferred to v1.3 pending rubric redesign (see `.planning/phases/01-skill-audit-prune-rc-gate/01-CONTEXT.md#Corrections` 2026-04-13)

## Performance Metrics

- Milestone: v1.2 Harness Optimization
- Phases defined: 5
- Requirements mapped: 9/9 (100% coverage)
- Phases complete: 0/5
- Plans complete: 0/0 (planning begins with Phase 1)

## Accumulated Context

- donnyclaude is brownfield being initialized into GSD tracking AFTER v1.1 release (package.json is already at `1.1.0`, npm published).
- Two prior research artifacts inform v1.2 scoping:
  - `.planning/research/DEEP-RESEARCH.md` — Claude Web Deep Research report on coding-agent harness state-of-the-art
  - `.planning/research/INVENTORY.md` — Code-level sweep of donnyclaude's actual file structure
  - `.planning/research/SUMMARY.md` — Short synthesis pointing to both
- The shipped baseline is **107 skills, 49 agents, 70 rule files, 8 hook implementations across 7 lifecycle events, 60 commands, 7 MCP servers**, all installed via `bin/donnyclaude.js:154-176` using `cpSync` with force-overwrite. No install manifest, no skill index, no progressive disclosure.
- v1.2 confirmed scope: SKILLS-01 (prune 107 → ~60, gated as v1.2.0-rc1), SKILLS-02 (install manifest), SKILLS-03 (skill index for progressive disclosure), SKILLS-04 (settings.json enable/disable), AGENTS-01 (return contracts for ~29 domain subagents), HOOKS-01 (refactor SessionStart shell one-liner), HOOKS-02 (active PreCompact backup), HOOKS-03 (SessionStart restore from backup), HOOKS-04 (Stop verification subagent).
- Stretch items #7-10 from research deferred to v1.3+ with documented reasoning in PROJECT.md Out of Scope section.
- Dependency order (hard): SKILLS-01 → SKILLS-02/03/04 → AGENTS-01 → HOOKS-01/02/03 → HOOKS-04. SKILLS-01 is the rc1 gate.
- Phase 1 has an explicit gate criterion: v1.2.0-rc1 must ship and one week of feedback must elapse without blocking issues before Phase 2 can begin.

## Decisions

- 2026-04-12: Phase 1 isolated to SKILLS-01 with rc1 gate per PROJECT.md Key Decisions; one-week feedback window is a hard gate, not a soft target.
- 2026-04-12: SKILLS-02/03/04 grouped into a single phase (Phase 2) because all three touch `bin/donnyclaude.js:154-176` and `packages/core/settings-template.json` and form a coherent install-time subsystem.
- 2026-04-12: HOOKS-01/02/03 grouped into a single phase (Phase 4) because they form a coherent backup/restore subsystem; HOOKS-01 provides the scriptable hook, HOOKS-02 provides the backup, HOOKS-03 provides the restore.
- 2026-04-12: HOOKS-04 isolated to Phase 5 so the verification subagent ships with an explicit return contract following the AGENTS-01 (Phase 3) pattern.
- **2026-04-13: Phase 1 training-duplicate rubric DEFERRED to v1.3.** The 5-skill calibration pre-flight correctly detected that the rubric's clause (c) cannot distinguish training-duplicate skills from catalog cross-links in the current codebase — all 5 calibration skills (including the "expected KEEP" anchors) have structurally identical bare-pointer referrer patterns. Phase 1 restructured from 5 plans to 3: cruft-only execution + publish + cooling-off. Partial audit artifacts preserved at `.planning/research/v1.3-seeds/`. v1.2 ships 107→105 (2 cruft removals); the broader prune becomes a v1.3 research + execution milestone. The calibration gate worked as designed and protected v1.2 from shipping 41 incorrectly-verdicted skills. Full analysis in `.planning/phases/01-skill-audit-prune-rc-gate/01-CONTEXT.md#Corrections`.

## Todos

- **Scoping-correction commit (BEFORE planning):** Update PROJECT.md + REQUIREMENTS.md + ROADMAP.md + research/SUMMARY.md + tests/install.test.js:60 to reflect the 75-85 target band and reframe gate purpose as "feedback + cooling-off." One atomic commit with subject `docs(planning): correct v1.2 prune target from ~60 to 75-85`.
- Plan Phase 1 via `/gsd-plan-phase 1` — AFTER scoping correction lands. Plan should spec audit subagent prompt (including clause-c snapshot requirement D-13), PRUNE-VERDICT.json schema, 5-skill calibration pre-flight, cooling-off obligations, RC publishing workflow.

## Blockers

None.

## Session Continuity

**Next action:** Execute new Plan 01-01 (cruft-only atomic commit). The plan authors `docs/PRUNE-LOG.md` with 2 cruft rows, `git mv`s configure-ecc + the continuous-learning loser to `packages/_archived-skills/`, writes `packages/_archived-skills/README.md` stub and `docs/CHANGELOG.md` v1.2.0 entry, updates `README.md` badges 107→105, runs `tests/install.test.js`, and lands as a single atomic commit with human verification at the checkpoint.

**State of Phase 1 execution:**
- Pre-execution scoping correction (43→41 candidate count fix) landed as commit `7ff02a0` before the rubric deferral.
- Rubric calibration pre-flight attempted and deferred; partial audit artifacts moved to `.planning/research/v1.3-seeds/` (README + subagent prompt + partial verdict JSON + reference graph snapshot).
- CONTEXT.md amended with Corrections section documenting the deferral and the calibration-gate lesson.
- Plans restructured 5→3. Old 01-01 (audit) and old 01-02 (review) deleted. Old 01-03 (atomic prune commit) replaced with new 01-01 (cruft-only). Old 01-04 renamed to new 01-02 (publish). Old 01-05 renamed to new 01-03 (cooling-off).
- Next immediate step: execute the new Plan 01-01.

---
*Last updated: 2026-04-13 after Phase 1 rubric-deferral pivot*
