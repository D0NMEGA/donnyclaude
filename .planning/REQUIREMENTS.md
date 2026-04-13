# Requirements: DonnyClaude

**Defined:** 2026-04-12
**Core Value:** Zero to autonomous, multi-phase AI-assisted development in one command — without manually assembling skills, agents, hooks, rules, and MCP servers.

## v1.2 Requirements — Harness Optimization

Six core incremental fixes from `.planning/research/SUMMARY.md`, ordered by hard dependency. Each requirement is atomic, user-centric, and testable. Cross-references to `bin/donnyclaude.js`, `packages/`, and `.planning/research/` are explicit so plan-phase has the file paths it needs.

### Skills

- [ ] **SKILLS-01**: User receives 75-85 high-value skills (pruned from 107) after pruning duplicates of training-data knowledge. Pruned set ships as v1.2.0-rc1 with a one-week feedback-plus-cooling-off window before SKILLS-02 onward proceed.
  - *Touches:* `packages/skills/` (git mv ~22-32 directories to `packages/_archived-skills/`), `README.md` (update count badges + table), `tests/install.test.js:60` (count floor moves from 100 to 70 in the scoping-correction commit).
  - *Evidence:* HumanLayer (14-22% reasoning token savings); Berkeley FCL v3; RAG-MCP arXiv:2505.03275.
  - *Verification:* skill count lands within the 75-85 band; release candidate published via `npm publish --tag rc`; one-week window elapses with zero `prune-regression`-labeled issues AND three cooling-off obligations completed (day 4-5 PRUNE-LOG.md re-read, fresh-machine install, real-workflow use of a borderline survivor).

- [ ] **SKILLS-02**: User's `~/.claude/.donnyclaude-manifest.json` is written by `npx donnyclaude` install with file list, SHA-256 checksums, and donnyclaude version. Enables uninstall, conflict detection, and offline audit.
  - *Touches:* `bin/donnyclaude.js:154-176` (install logic), new manifest writer module.
  - *Evidence:* `INVENTORY.md` gap #8; practitioner consensus on manifest-driven distribution.
  - *Verification:* fresh install creates the manifest; manifest file list matches actual installed files; checksums verify.

- [ ] **SKILLS-03**: User's installed skill set is indexed at install time with description-based metadata, enabling Claude Code to discover skills by relevance rather than loading all of them always-on.
  - *Touches:* new `packages/hooks/skill-index.js`, `bin/donnyclaude.js` (call indexer post-copy), index output written to `~/.claude/skills/.index.json`.
  - *Evidence:* RAG-MCP arXiv:2505.03275 (3x tool selection accuracy with retrieval); Multi-Instance Processing arXiv:2603.22608 (item count degrades performance faster than token count).
  - *Verification:* install produces `.index.json`; index contains every skill with its description; index round-trips correctly.

- [ ] **SKILLS-04**: User can enable or disable individual skills via `settings.json` keys `skills.enabled[]` and `skills.disabled[]`, with disabled skills excluded from the active skill set without uninstalling them.
  - *Touches:* `packages/core/settings-template.json`, `bin/donnyclaude.js` install merge logic.
  - *Evidence:* `INVENTORY.md` gap #1 (no enable/disable mechanism); HumanLayer over-steering data.
  - *Verification:* user disables a skill → it does not load; user re-enables → it loads again; disable persists across `npx donnyclaude update`.

### Agents

- [ ] **AGENTS-01**: User-spawned domain subagents (architect, planner, code-reviewer, tdd-guide, refactor-cleaner, and the ~24 other open-ended role-prompt agents) return only structured summaries to the parent, not full intermediate context. Pattern matches the existing GSD subset (gsd-doc-verifier, gsd-doc-writer).
  - *Touches:* `packages/agents/{architect,planner,code-reviewer,tdd-guide,refactor-cleaner,...}.md` — frontmatter and system-prompt edits per agent.
  - *Evidence:* HumanLayer "subagents are context firewalls"; LangChain trace analysis; existing GSD pattern in `packages/agents/gsd-doc-verifier.md:20-21`.
  - *Verification:* sample 5 modified agents; each has explicit "Returns only X" line in its system prompt; sample subagent runs return ≤500 words to parent.

### Hooks

- [ ] **HOOKS-01**: User's SessionStart hook is implemented as a real testable script (not the current 300-character inline shell one-liner in `hooks.json:132-143`) that injects `git branch --show-current`, `git diff --stat HEAD`, package-manager detection, and the most-recent backup path as structured additional context.
  - *Touches:* new `packages/hooks/session-start.js` (or `.sh`), `packages/hooks/hooks.json:132-143` (replace inline command with script reference).
  - *Evidence:* `INVENTORY.md` gap #5; LangChain LocalContextMiddleware; revfactory +60% pre-config result.
  - *Verification:* SessionStart hook is a single line in hooks.json calling the script; script is unit-testable; injected context appears in fresh sessions.

- [ ] **HOOKS-02**: User's PreCompact hook backs up critical state (current task, key decisions, file paths under edit, last test status) to `.claude/backups/{ISO-timestamp}/state.json` BEFORE Claude Code summarizes the conversation. Upgrades the existing passive PreCompact hook to active enforcement.
  - *Touches:* `packages/hooks/precompact-backup.js`, `packages/hooks/hooks.json` (PreCompact entry), backup directory creation logic.
  - *Evidence:* claudefa.st PreCompact backup pattern; Morph LLM "by the time compaction triggers, the damage is done"; `INVENTORY.md` hook activity table.
  - *Verification:* triggering compaction creates a backup directory; backup contains parseable JSON; backup is timestamped and unique per compaction event.

- [ ] **HOOKS-03**: User's SessionStart hook (HOOKS-01) automatically restores the most-recent backup written by HOOKS-02 when one exists, surfacing it as session-start context so the user can recover from lossy compaction.
  - *Touches:* `packages/hooks/session-start.js` (extend with backup-discovery logic).
  - *Evidence:* claudefa.st pattern; Morph LLM analysis of post-compaction degradation.
  - *Verification:* with a backup present, fresh session injects backup contents as context; with no backup, SessionStart proceeds without error.
  - *Depends on:* HOOKS-01 (script must exist), HOOKS-02 (backups must exist to restore).

- [ ] **HOOKS-04**: User's Stop hook spawns a verification subagent that gates session close — the agent reads the original task and verifies completion against it, blocking session close (exit code 2) if verification fails. Closes the "models declare done prematurely" failure mode.
  - *Touches:* new `packages/hooks/verification-hook.js`, `packages/hooks/hooks.json` (Stop entry), new `packages/agents/session-verifier.md` subagent.
  - *Evidence:* LangChain "self-verification was the single biggest contributor to their improvement"; NL2Repo-Bench arXiv:2512.12730; "models naturally declare tasks complete without proper validation".
  - *Verification:* known-incomplete session → Stop hook blocks with verification failure; known-complete session → Stop hook allows close; verification subagent has explicit "return only PASS/FAIL + reason" contract per AGENTS-01.
  - *Depends on:* AGENTS-01 (so session-verifier follows the established return-contract pattern).

## v1.3+ Requirements (deferred from v1.2 stretch)

The four research recommendations (#7-10) that were explicitly deferred during v1.2 scoping. Each lives here so they are not forgotten and so future milestones can pick them up with the documented reasoning intact. See PROJECT.md "Deferred from v1.2" section for full reasoning.

### Verification

- **VERIFY-01**: PostToolUse verification hook on Write/Edit operations runs project-aware linter and test suite, injecting results back as context. *(Stretch #7 — needs project-aware detection, 2-30s test handling, kill-switch for known-broken states. Its own milestone.)*

### Performance

- **PERF-01**: Long-running subagents use a "reasoning sandwich" — `effort: xhigh` for plan/verify, `effort: high` for impl. *(Stretch #8 — depends on AGENTS-01 being solid first to isolate effects.)*
- **PERF-02**: Proactive 60% compaction override via `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. *(Stretch #9 — depends on HOOKS-02 being proven stable in production for one milestone.)*

### Rules

- **RULES-01**: Migrate the 10-15 highest-frequency rule files from `packages/rules/` to PreToolUse/PostToolUse hooks. *(Stretch #10 — "highest-frequency" requires telemetry that doesn't exist; needs trace-based improvement loop or 15-25h manual audit.)*

### Architectural tier (later milestones, each its own scope)

- **ARCH-01**: Multi-candidate patch pipeline subagent system (Agentless-style N-patch generation with test-based selection). 40-80h. v1.3+.
- **ARCH-02**: Sandboxed execution wrapper via Docker MCP server. 40-60h. v1.3+.
- **ARCH-03**: Hierarchical, search-indexed skill graph (two-tier: lightweight always-on index + on-demand full content). 30-50h. v1.4+.
- **ARCH-04**: Trace-based harness improvement loop with SQLite telemetry and automated trace analyzer. 60-100h. v1.5+.
- **ARCH-05**: Claude Agent SDK wrapper for SDK-only primitives (only if specific capabilities truly justify it). 80-160h. Indefinite — currently Out of Scope.

## Out of Scope

Explicitly excluded from v1.2. See PROJECT.md Out of Scope section for the full list and reasoning.

| Feature | Reason |
|---------|--------|
| Custom Claude Agent SDK harness wrapper | Configuration distribution, not a fork. Loses model-harness co-optimization. |
| Forking underlying skills/agents/hooks ecosystems | We package and distribute; upstream changes flow through. |
| New languages beyond the existing 13 | Bandwidth goes to optimization, not breadth. |
| Cloud / SaaS components | Pure local install. No telemetry server, no cloud sync. |
| Breaking changes for v1.1 users | `npx donnyclaude update` v1.1 → v1.2 must preserve customizations. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SKILLS-01 | Phase 1 — Skill Audit + Prune (RC GATE) | Pending |
| SKILLS-02 | Phase 2 — Install Manifest + Progressive Disclosure | Pending |
| SKILLS-03 | Phase 2 — Install Manifest + Progressive Disclosure | Pending |
| SKILLS-04 | Phase 2 — Install Manifest + Progressive Disclosure | Pending |
| AGENTS-01 | Phase 3 — Subagent Return Contracts | Pending |
| HOOKS-01 | Phase 4 — Hook Backup/Restore Subsystem | Pending |
| HOOKS-02 | Phase 4 — Hook Backup/Restore Subsystem | Pending |
| HOOKS-03 | Phase 4 — Hook Backup/Restore Subsystem | Pending |
| HOOKS-04 | Phase 5 — Stop Verification Subagent | Pending |

**Coverage:**
- v1.2 requirements: 9 total
- Mapped to phases: 9 ✓
- Unmapped: 0

---
*Requirements defined: 2026-04-12*
*Last updated: 2026-04-12 after ROADMAP.md creation — traceability populated*
