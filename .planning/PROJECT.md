# DonnyClaude

## What This Is

DonnyClaude is an opinionated, all-in-one power-user setup for Claude Code distributed via `npx donnyclaude`. It installs 107 skills, 49 specialized subagents, 70 coding rule files across 13 languages, the GSD (Get Shit Done) workflow engine, 8 hook implementations, 60 slash commands, and 7 pre-configured MCP servers into `~/.claude/`, then launches Claude Code itself as an interactive setup wizard for the user's project.

## Core Value

Zero to autonomous, multi-phase AI-assisted development in one command — without manually assembling skills, agents, hooks, rules, and MCP servers.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ **Single-command install** via `npx donnyclaude` — v1.0
- ✓ **107 skills** packaged and installed to `~/.claude/skills/` — v1.0
- ✓ **49 specialized subagents** packaged to `~/.claude/agents/` — v1.0
- ✓ **70 rule files** across 13 languages (common + language-specific) — v1.0
- ✓ **GSD workflow engine** bundled and installed to `~/.claude/get-shit-done/` — v1.0
- ✓ **60 slash commands** packaged to `~/.claude/commands/` — v1.0
- ✓ **8 hook implementations** binding 7 lifecycle events via `hooks.json` — v1.0
- ✓ **7 MCP servers** pre-configured (Context7, Playwright, 21st.dev, Exa, Semantic Scholar, Computer Use, Vercel) — v1.0
- ✓ **Interactive setup wizard** launched post-install via Claude Code itself — v1.0
- ✓ **doctor / update / version / help** subcommands — v1.0
- ✓ **Settings merged not clobbered**, `.bak` created automatically — v1.1
- ✓ **Detect existing config before overwriting**, safe MCP placeholders — v1.1
- ✓ **ES module support, countItems helper, path safety, 29 automated tests** — v1.1
- ✓ **npm publication** (`npx donnyclaude` works directly from registry) — v1.1
- ✓ **Security hardening, GitHub install support, eye-catching README** — v1.1

### Active

<!-- Current scope. Building toward these. -->

**Milestone v1.2 — Harness Optimization** (six core fixes, ordered by dependency):

- [ ] **SKILLS-01**: donnyclaude ships 75-85 high-value skills (pruned from 107) after audit removes duplicates of training-data knowledge. *Gated as v1.2.0-rc1; one-week feedback-plus-cooling-off window before proceeding.*
- [ ] **SKILLS-02**: `npx donnyclaude` install writes `~/.claude/.donnyclaude-manifest.json` with file list, checksums, and version
- [ ] **SKILLS-03**: install builds a description-indexed skill registry enabling progressive disclosure (avoid the ~100-tool degradation cliff)
- [ ] **SKILLS-04**: user can enable/disable individual skills via `settings.json` (`skills.enabled[]` / `skills.disabled[]`)
- [ ] **AGENTS-01**: domain subagents (architect, planner, code-reviewer, tdd-guide, refactor-cleaner, ~29 total) return only structured summaries, not full context
- [ ] **HOOKS-01**: SessionStart hook is a real testable script (not an inline 300-char shell one-liner) that injects `git branch`, `git diff --stat`, env discovery, and most-recent backup path
- [ ] **HOOKS-02**: PreCompact hook backs up state, file paths, and test status to `.claude/backups/{timestamp}/` before context summarization
- [ ] **HOOKS-03**: SessionStart hook restores the most-recent backup when one exists
- [ ] **HOOKS-04**: Stop hook spawns a verification subagent that gates session close, blocking premature task-complete declarations

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **Custom Claude Agent SDK harness wrapper** — donnyclaude is a configuration distribution, not a fork of Claude Code's agent loop. Replacing the native loop loses Anthropic's model-harness co-optimization and breaks upstream upgrades. *(Architectural-tier rec #5; deferred indefinitely.)*
- **Forking the underlying skills/agents/hooks ecosystems** — donnyclaude packages and distributes; upstream changes flow in via update.
- **Adding new languages beyond the existing 13** — current rule coverage is sufficient; bandwidth goes to optimization, not breadth.
- **Cloud / SaaS components** — the project is pure local install. No telemetry server, no cloud sync, no subscription tier.

**Deferred from v1.2 to a future milestone (v1.3+):**

- **PostToolUse verification hook on Write/Edit** *(stretch #7 in research)* — Most-cited recommendation in DEEP-RESEARCH.md, but needs project-aware linter/test detection (Python vs Node vs Rust vs mixed), a strategy for handling 2-30s test runs without injecting them into every edit, and a kill-switch for known-broken states. Bolting it onto v1.2 means shipping a hook that runs eslint on Python repos. Its own milestone.
- **Reasoning sandwich for long-running subagents** *(stretch #8)* — Depends on AGENTS-01 (return-contract enforcement) being solid first. Tuning per-agent reasoning effort before contracts are stable means you can't isolate which knob caused quality changes. Sequencing: ship contracts in v1.2, observe for a milestone, then add effort routing in v1.3.
- **Proactive 60% compaction override** *(stretch #9)* — Looks like a two-line config change but is contingent on HOOKS-02 (active PreCompact backup) actually working end-to-end first. Shipping both in v1.2 means a backup-hook bug compounds with more-frequent compaction → more-frequent state loss. Ship HOOKS-02, run for a week, then tighten the threshold.
- **Migrate top 10-15 highest-frequency rules from rule files to hooks** *(stretch #10)* — "Highest-frequency" assumes telemetry that doesn't exist yet. The honest version requires either the architectural-tier trace-based improvement loop or a 15-25h manual audit pass that's its own scope. Either way, not v1.2.

## Context

donnyclaude is a brownfield project being bootstrapped into GSD tracking AFTER its initial v1.0 / v1.1 releases. Two foundational research artifacts were produced before this bootstrap and live in `.planning/research/`:

- **DEEP-RESEARCH.md** — Claude Web Deep Research report on coding-agent harness state-of-the-art (2024-2026). Surveys 14 harnesses (Claude Code, Cursor, Cline, Aider, OpenHands, SWE-agent, Devin, Codex CLI, Roo Code, Continue, Sweep, Plandex, goose, and others) across 5 primitives (loop, tool dispatch, context, memory, verification). Cites measured results from SWE-bench Pro, Terminal Bench 2.0, Berkeley Function-Calling Leaderboard v3, RAG-MCP, SWE-Search, and 20+ academic papers. Ranks 10 incremental + 5 architectural recommendations.
- **INVENTORY.md** — Code-level sweep of donnyclaude's actual structure: confirms 107 skills (not 122), 49 agents, 70 rule files, 8 hook implementations, 60 commands, install path through `bin/donnyclaude.js:154-176` using recursive `cpSync` with force-overwrite. Identifies critical absences (no install manifest, no skill index, no progressive disclosure).

Key context for v1.2 planning:

- All 107 skills load **always-on** by Claude Code; there is no skill manifest, registry, or enable/disable mechanism. Berkeley FCL data shows measurable degradation past 10 simultaneously-exposed tools and a sharp cliff past ~100. donnyclaude sits on the wrong side of that cliff.
- The hook story is **richer than the research initially assumed**: PreCompact, SessionStart, and Stop hooks all already exist. But several are passive/observational rather than active enforcement. SessionStart is a fragile 300-character inline shell one-liner in `hooks.json:132-143`.
- ~20 of 49 subagents (the GSD subset) have explicit "return only X" contracts. The remaining ~29 (architect, planner, code-reviewer, tdd-guide, refactor-cleaner, etc.) are open-ended role prompts that dump full context back to the parent.
- 70 rule files risk over-constraining the model. HumanLayer's measured finding: more rules → 14-22% more reasoning tokens spent processing instructions, with worse outcomes.

## Constraints

- **Distribution model**: Must remain a Node-based npm package installable via `npx donnyclaude`. Cannot require additional language runtimes or system dependencies beyond Node.js 20+.
- **Tech stack**: Pure Node.js + ES modules. No build step. `bin/donnyclaude.js` is the single entry point.
- **Compatibility**: Must coexist with existing `~/.claude/` installations. Settings merge, never clobber. Backup `.bak` before any overwrite.
- **Distribution channels**: Published to npm (`donnyclaude`) and GitHub (`d0nmega/donnyclaude`). Both must stay in sync.
- **Architectural envelope**: donnyclaude sits ON TOP of Claude Code's native agent loop. We do NOT modify the loop, parse model output, or build a custom harness wrapper. All optimization happens via primitives Claude Code exposes (skills, agents, hooks, rules, commands, MCP).
- **No breaking changes for existing users**: v1.2 must remain backwards-compatible. Users on v1.1 should be able to `npx donnyclaude update` without config loss.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Distribute as a configuration package, not a forked harness | Preserves Anthropic's model-harness co-optimization; upstream improvements flow through automatically | ✓ Good |
| Use `cpSync` with force-overwrite over symlinks | Symlinks break on Windows and across volumes; copy is portable and predictable | ✓ Good |
| Bundle 7 MCP servers as defaults | Reduces friction; users get live docs, browser, search, papers out of the box | ✓ Good |
| Ship 107 skills always-loaded (no progressive disclosure) | Initial release prioritized completeness over tuning | ⚠️ Revisit — measured tool-degradation cliff at ~100 tools (RAG-MCP, BFCL v3) |
| GSD engine bundled by default | Provides phase tracking, atomic commits, verification gates that compound with other primitives | ✓ Good |
| Settings merge instead of clobber | Existing Claude Code users can install donnyclaude without losing custom hooks/permissions | ✓ Good |
| Bootstrap GSD tracking AFTER v1.1 release rather than from inception | The optimization milestone needs structured tracking; prior releases shipped without it | — Pending (v1.2 will validate) |
| Trim v1.2 to six core incremental fixes; defer stretch items #7-10 to v1.3+ | Each stretch item has a non-obvious failure mode that needs its own scoping. Bundling them blows the milestone past 95h and creates exactly the silent-drift problems the closing-loops thesis warns against. | — Pending (validates after v1.2 ship) |
| Gate SKILLS-01 (prune 107 toward the 75-85 band) as v1.2.0-rc1 with a one-week window between rc1 publish and stable promotion, providing both external feedback collection and internal cooling-off for self-review | Pruning looks reversible but isn't; users will complain about removed skills. Treating the prune as a release candidate gives a window where feedback can arrive AND the author can dogfood rc1 before promotion. The cooling-off framing keeps the gate defensible at zero external feedback. | Pending |
| Order v1.2 phases by hard dependency: SKILLS-01 → SKILLS-02/03/04 → AGENTS-01 → HOOKS-01 (independent) → HOOKS-02 → HOOKS-03 → HOOKS-04 | Coherent shipping sequence avoids parallel workstreams competing for attention. SKILLS-03 must follow SKILLS-01 (you index what's left). HOOKS-03 must follow HOOKS-02 (you restore what you backed up). | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-12 after bootstrapping GSD tracking from v1.1 baseline*
