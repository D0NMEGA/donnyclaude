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

**donnyclaude is in maintenance mode as of 2026-05-08.** Active substrate-research work moved to the separate `harness-lab` repo as milestone `harness-pivot-v1`. See `.planning/research/ahol/MILESTONE-PLAN-harness-pivot-v1.md` for the full plan and `.planning/research/ahol/AHOL-POSTMORTEM.md` for the methodology errors that motivated the migration.

No active scope on donnyclaude itself this cycle. The former v1.2 "Harness Optimization" milestone closed without shipping its full scope; its work has been preserved as v1.3 backlog (see below).

### v1.3 Backlog (paused; resumes when donnyclaude maintenance window opens)

Former v1.2 phases renumbered as donnyclaude maintenance backlog. Full detail in `.planning/v1.3-BACKLOG.md`. Summary:

- Skill audit + prune rubric redesign (Phase 1)
- Install manifest + progressive disclosure (Phase 2)
- Subagent return contracts (Phase 3)
- Hook backup/restore subsystem (Phase 4)
- Stop verification subagent (Phase 5)

Not gated on `harness-pivot-v1` succeeding or failing. Resumes whenever the user opens a donnyclaude maintenance window.

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **Custom Claude Agent SDK harness wrapper** — donnyclaude is a configuration distribution, not a fork of Claude Code's agent loop. Replacing the native loop loses Anthropic's model-harness co-optimization and breaks upstream upgrades. *(Architectural-tier rec #5; deferred indefinitely.)*
- **Forking the underlying skills/agents/hooks ecosystems** — donnyclaude packages and distributes; upstream changes flow in via update.
- **Adding new languages beyond the existing 13** — current rule coverage is sufficient; bandwidth goes to optimization, not breadth.
- **Cloud / SaaS components** — the project is pure local install. No telemetry server, no cloud sync, no subscription tier.

**Moved to v1.3 backlog on 2026-05-08:**

All deferred-from-v1.2 items, plus the originally-active v1.2 scope, have been consolidated into `.planning/v1.3-BACKLOG.md` as donnyclaude maintenance backlog. v1.2 closed without shipping its full scope; the work itself remains valuable but is renumbered as donnyclaude maintenance, not as research milestone scope.

**Architectural decisions that remain out of scope indefinitely:**

- **Forking Claude Code's agent loop, tool plumbing, or sampling layer from inside donnyclaude.** donnyclaude is a configuration distribution. Substrate-level harness research happens in the separate `harness-lab` repo (see `harness-pivot-v1`).

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
| **2026-04-13 — v1.2 Phase 1 training-duplicate rubric deferred to v1.3; ship cruft-only prune (107→105) in v1.2.** The 5-skill calibration pre-flight added during context-gathering fired on its first attempt and correctly detected that the rubric's clause (c) could not distinguish training-duplicate skills from catalog cross-links in the current codebase — every calibration anchor (expected KEEP and expected PRUNE) has structurally identical bare-pointer referrer patterns from reviewer agents, rule files, and commands. | Adding the calibration-before-full-pass gate during context-gathering was the specific move that prevented v1.2 from shipping 41 incorrectly-verdicted skills. The asymmetric-risk framing in D-15 ("false-positive prunes are user-facing and harder to reverse even with git mv") held under stress. The gate working as designed — catching a planning defect before the full audit ran — validates the calibration-before-full-pass protocol for any future audit-subagent work in donnyclaude, and suggests this pattern should be carried forward as the default for rubric-based decisions in catalog-linked codebases. Partial audit artifacts preserved at `.planning/research/v1.3-seeds/` feed v1.3 rubric redesign. **Cost retrospective:** Total pivot cost was ~40 min of Donovan's review time + ~90 min of Claude's planning/execution. The counterfactual (no calibration gate): 20 min of Claude running 41 bad verdicts → hours of Donovan's human review pass catching them one by one → post-mortem on what went wrong → v1.2 either shipping broken or getting pulled in an emergency. Estimated savings: **6-20 hours** depending on how late the defect would have been caught. **Durable principle:** rules are probabilistic (can be skipped or forgotten); deterministic gates fire every time. The rule "check every PRUNE verdict before committing" is probabilistic and eventually misses some. The gate "block the full pass if calibration isn't 5/5" is deterministic and fires every time. When a future phase considers rubric-based decisions in a catalog-linked codebase, point at this session as evidence that the calibration step pays for itself within a single run. | ✓ Good (gate worked; lesson captured; v1.2 ships honestly; cost retrospective validates the gate pattern) |

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

## Active Substrate Research

**`harness-pivot-v1`** — substrate migration to mini-SWE-agent for real harness optimization. Lives in the separate `harness-lab` repo (created in Phase 2 of that milestone). donnyclaude itself is paused for the duration.

- **Plan of record:** `.planning/research/ahol/MILESTONE-PLAN-harness-pivot-v1.md` (27-phase roadmap with bets, exit criteria, dependencies)
- **Deep research backing:** `.planning/research/ahol/HARNESS-RESEARCH-2026-05-08.md` (20-layer harness taxonomy, frontier architecture survey, model landscape, 4-week plan)
- **Why this is happening:** `.planning/research/ahol/AHOL-POSTMORTEM.md` (methodology errors that retired the AHOL approach)
- **GSD planning home:** harness-lab repo, NOT donnyclaude. Run `/gsd-new-milestone` inside harness-lab once Phase 2 creates that repo.

---
*Last updated: 2026-05-08 — v1.2 closed without full scope; renumbered to v1.3 backlog. donnyclaude paused; substrate research migrated to harness-lab as `harness-pivot-v1`.*
