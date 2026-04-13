# Roadmap: DonnyClaude v1.2 — Harness Optimization

**Created:** 2026-04-12
**Milestone:** v1.2 Harness Optimization
**Requirements mapped:** 9/9 ✓
**Granularity:** Standard (dependency-ordered)

## Milestone Goal

Measurably reduce donnyclaude's always-loaded context overhead, harden the hook subsystem with deterministic state preservation and verification, and establish explicit return contracts on the remaining open-ended subagents — without breaking the `npx donnyclaude` install path or changing the architectural envelope that keeps donnyclaude a configuration distribution sitting on top of Claude Code's native agent loop.

## Phases

- [ ] **Phase 1: Skill Audit + Prune (RC GATE)** — Prune 107 skills to ~60 high-value skills, ship as v1.2.0-rc1, and gate the rest of v1.2 on a one-week user feedback window.
- [ ] **Phase 2: Install Manifest + Progressive Disclosure** — Install writes a manifest, builds a description-indexed skill registry, and supports enable/disable via `settings.json`.
- [ ] **Phase 3: Subagent Return Contracts** — ~29 open-ended domain subagents receive explicit "return only X" contracts matching the established GSD pattern.
- [ ] **Phase 4: Hook Backup/Restore Subsystem** — SessionStart becomes a real testable script, PreCompact actively backs up state, and SessionStart restores the most-recent backup.
- [ ] **Phase 5: Stop Verification Subagent** — Stop hook gates session close via a verification subagent that reads the original task and blocks premature "done" declarations.

## Phase Details

### Phase 1: Skill Audit + Prune (RC GATE)
**Goal**: User installs donnyclaude v1.2.0-rc1 and receives ~60 high-value skills instead of 107, with one week of real-world usage validating the prune before the rest of v1.2 lands.
**Depends on**: Nothing (first phase)
**Requirements**: SKILLS-01
**Success Criteria** (what must be TRUE):
  1. User running `npx donnyclaude@1.2.0-rc1` sees ~60 skills installed to `~/.claude/skills/` and README badges reflect the new count.
  2. User inspecting `packages/skills/` on the repo sees the pruned directory list with a documented rationale per removed skill (duplicate of training knowledge, low-signal, or superseded).
  3. User running existing tests sees all test assertions pass with the new skill count; no test relies on the previous 107 figure.
  4. v1.2.0-rc1 is published to npm with release notes explaining the prune and calling for feedback, and one full week elapses with no blocking issue filed before Phase 2 begins.
**Plans**: TBD
**Gate criterion**: v1.2.0-rc1 published; one week of user feedback elapsed; no blocking issues filed before Phase 2 begins. This is a user-confirmed decision in PROJECT.md Key Decisions.

### Phase 2: Install Manifest + Progressive Disclosure
**Goal**: User running `npx donnyclaude` install gets a manifest-tracked, progressively-disclosed skill set they can enable or disable from `settings.json` without uninstalling.
**Depends on**: Phase 1 (you index what's left after pruning)
**Requirements**: SKILLS-02, SKILLS-03, SKILLS-04
**Success Criteria** (what must be TRUE):
  1. User running a fresh install sees `~/.claude/.donnyclaude-manifest.json` created with a file list, SHA-256 checksums, and the donnyclaude version; running `donnyclaude doctor` verifies the manifest matches files on disk.
  2. User inspecting `~/.claude/skills/.index.json` after install sees every installed skill indexed with its name and description, and the index round-trips (parse → serialize → parse) without data loss.
  3. User adding a skill name to `skills.disabled[]` in `settings.json` and restarting Claude Code sees that skill excluded from the active skill set; moving it to `skills.enabled[]` re-activates it.
  4. User running `npx donnyclaude update` from v1.1 sees their existing `settings.json` skill preferences preserved across the upgrade, with the new manifest and index written without clobbering user customizations.
**Plans**: TBD

### Phase 3: Subagent Return Contracts
**Goal**: User spawning any domain subagent (architect, planner, code-reviewer, tdd-guide, refactor-cleaner, and the ~24 others) receives only a structured summary, not a full context dump, so subagents act as true context firewalls.
**Depends on**: Phase 2
**Requirements**: AGENTS-01
**Success Criteria** (what must be TRUE):
  1. User opening any of the ~29 previously-open-ended agent files in `packages/agents/` sees an explicit "Returns only X" contract line in the frontmatter or system prompt, matching the pattern already used by `gsd-doc-verifier.md` and `gsd-doc-writer.md`.
  2. User spawning a sampled subagent (e.g., `code-reviewer`) against a real task sees the returned message fit within a single short structured summary (≤500 words) rather than a full transcript.
  3. User running `grep -L "Returns only" packages/agents/*.md` against the updated repo sees no domain agent missing a return contract; only meta/utility agents without spawn semantics are exempt.
**Plans**: TBD

### Phase 4: Hook Backup/Restore Subsystem
**Goal**: User's session state survives context compaction — SessionStart is a real auditable script, PreCompact actively backs up critical state, and SessionStart restores the most-recent backup so lossy compaction becomes recoverable.
**Depends on**: Phase 3
**Requirements**: HOOKS-01, HOOKS-02, HOOKS-03
**Success Criteria** (what must be TRUE):
  1. User inspecting `packages/hooks/hooks.json` sees the SessionStart entry as a single line invoking a script file (not a 300-character inline shell one-liner), and the script at `packages/hooks/session-start.js` is unit-testable in isolation.
  2. User starting a fresh Claude Code session in a git repo sees injected context showing current branch, `git diff --stat HEAD`, detected package manager, and the path of the most-recent backup (if any).
  3. User triggering a context compaction mid-session sees a new timestamped directory appear under `.claude/backups/` containing a parseable `state.json` with current task, key decisions, file paths under edit, and last test status.
  4. User starting a session after a prior compaction sees the most-recent backup's contents injected as session-start context; user starting a session with no backups present sees the SessionStart hook proceed without error.
**Plans**: TBD

### Phase 5: Stop Verification Subagent
**Goal**: User's Stop hook refuses to close a session when the original task has not been verifiably completed, closing the "models declare done prematurely" failure mode with a verification subagent that follows the Phase 3 return-contract pattern.
**Depends on**: Phase 4 (hooks subsystem must be script-based before extension) and Phase 3 (verification subagent must follow the established return contract pattern)
**Requirements**: HOOKS-04
**Success Criteria** (what must be TRUE):
  1. User ending a session where the original task was completed sees the Stop hook allow close cleanly with a PASS verdict surfaced in the exit context.
  2. User ending a session where the original task was NOT completed (unwritten file, failing test, missing commit) sees the Stop hook block close with exit code 2 and a FAIL verdict naming what is missing.
  3. User opening the new `packages/agents/session-verifier.md` sees an explicit "Returns only PASS/FAIL + reason" contract matching the Phase 3 pattern; the verifier returns no intermediate context to the parent hook.
  4. User inspecting `packages/hooks/hooks.json` sees the new Stop entry pointing to `packages/hooks/verification-hook.js`, which spawns the session-verifier subagent and maps its structured return to the hook's exit code.
**Plans**: TBD

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Skill Audit + Prune (RC GATE) | 0/0 | Ready to plan | — |
| 2. Install Manifest + Progressive Disclosure | 0/0 | Not started | — |
| 3. Subagent Return Contracts | 0/0 | Not started | — |
| 4. Hook Backup/Restore Subsystem | 0/0 | Not started | — |
| 5. Stop Verification Subagent | 0/0 | Not started | — |

## Coverage

All 9 v1.2 requirements mapped to exactly one phase:

| Requirement | Phase |
|-------------|-------|
| SKILLS-01 | Phase 1 |
| SKILLS-02 | Phase 2 |
| SKILLS-03 | Phase 2 |
| SKILLS-04 | Phase 2 |
| AGENTS-01 | Phase 3 |
| HOOKS-01 | Phase 4 |
| HOOKS-02 | Phase 4 |
| HOOKS-03 | Phase 4 |
| HOOKS-04 | Phase 5 |

**Coverage:** 9/9 ✓
**Orphans:** 0
**Duplicates:** 0

## Dependency Graph

```
Phase 1 (SKILLS-01, RC GATE)
   └── Phase 2 (SKILLS-02, SKILLS-03, SKILLS-04)
          └── Phase 3 (AGENTS-01)
                 └── Phase 4 (HOOKS-01, HOOKS-02, HOOKS-03)
                        └── Phase 5 (HOOKS-04)
```

Phase 3 and Phase 4 could theoretically run in parallel since HOOKS-01/02/03 do not depend on AGENTS-01, but Phase 5 requires both (HOOKS-04 needs the hooks subsystem AND the return contract pattern). Sequential execution is preferred to avoid parallel workstreams competing for attention, per PROJECT.md Key Decisions.

---
*Roadmap created: 2026-04-12 by gsd-roadmapper*
*Source: REQUIREMENTS.md (9 v1.2 requirements), research/SUMMARY.md (top 6 priorities), research/INVENTORY.md (file-level gaps), PROJECT.md (key decisions + dependency order)*
