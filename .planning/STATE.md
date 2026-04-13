# State

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining REQUIREMENTS.md and ROADMAP.md for milestone v1.2 (Harness Optimization)
Last activity: 2026-04-12 — Confirmed milestone scope (six core fixes, dependency-ordered, SKILLS-01 gated as v1.2.0-rc1)

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-12)

**Core value:** Zero to autonomous AI-assisted development in one command
**Current focus:** Defining v1.2 harness-optimization milestone

## Accumulated Context

- donnyclaude is brownfield being initialized into GSD tracking AFTER v1.1 release (package.json is already at `1.1.0`, npm published).
- Two prior research artifacts inform v1.2 scoping:
  - `.planning/research/DEEP-RESEARCH.md` — Claude Web Deep Research report on coding-agent harness state-of-the-art
  - `.planning/research/INVENTORY.md` — Code-level sweep of donnyclaude's actual file structure
  - `.planning/research/SUMMARY.md` — Short synthesis pointing to both
- The shipped baseline is **107 skills, 49 agents, 70 rule files, 8 hook implementations across 7 lifecycle events, 60 commands, 7 MCP servers**, all installed via `bin/donnyclaude.js:154-176` using `cpSync` with force-overwrite. No install manifest, no skill index, no progressive disclosure.
- The research surfaced six high-leverage incremental priorities and five deferred architectural-tier candidates. Not all fit a single milestone — v1.2 focuses on the cheapest, highest-evidence wins.
- v1.2 confirmed scope: SKILLS-01 (prune 107 → ~60, gated as v1.2.0-rc1), SKILLS-02 (install manifest), SKILLS-03 (skill index for progressive disclosure), SKILLS-04 (settings.json enable/disable), AGENTS-01 (return contracts for ~29 domain subagents), HOOKS-01 (refactor SessionStart shell one-liner), HOOKS-02 (active PreCompact backup), HOOKS-03 (SessionStart restore from backup), HOOKS-04 (Stop verification subagent).
- Stretch items #7-10 from research deferred to v1.3+ with documented reasoning in PROJECT.md Out of Scope section. Each has a non-obvious failure mode that warrants its own scoping.
- Dependency order (hard): SKILLS-01 → SKILLS-02/03/04 → AGENTS-01 → HOOKS-01 (independent) → HOOKS-02 → HOOKS-03 → HOOKS-04. SKILLS-01 is the rc1 gate.
