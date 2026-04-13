# Milestones

## v1.0 — Initial Release

**Shipped:** Initial git commit `72423ce` — "feat: initial DonnyClaude release"

**Delivered:**
- `npx donnyclaude` single-command installer (`bin/donnyclaude.js`, 379 lines)
- 107 skills packaged to `packages/skills/` and installed to `~/.claude/skills/`
- 49 specialized subagents (~20 with explicit return contracts under the GSD subset; remainder open-ended role prompts)
- 70 rule files across 13 languages (`packages/rules/`: common + python, typescript, golang, rust, java, kotlin, php, swift, cpp, perl, csharp, cobol)
- GSD (Get Shit Done) workflow engine bundled, installed to `~/.claude/get-shit-done/`
- 8 hook implementations in `packages/hooks/` plus `hooks.json` registry binding 7 lifecycle events (PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, SessionStart, SessionEnd, Stop)
- 60 slash commands in `packages/commands/`
- 7 MCP servers pre-configured (Context7, Playwright, 21st.dev Magic, Exa, Semantic Scholar, Computer Use, Vercel)
- Interactive Claude-driven setup wizard launched post-install
- `doctor` / `update` / `version` / `help` subcommands

**How it shipped:** Direct release without GSD phase tracking (predates GSD adoption for this project).

## v1.1 — Hardening + Distribution

**Shipped:** Commits `d28d512`, `286aff0`, `3bd4904`, `937bf09`

**Delivered:**
- ES module support, `countItems` helper, path safety
- 29 automated tests (`tests/`)
- Security hardening, eye-catching README, GitHub install support
- Detect existing config before overwriting; safe MCP placeholders
- Settings merge with automatic `.bak` backup before any overwrite
- npm publication — `npx donnyclaude` works directly from the registry
- README updated to use `npx donnyclaude`
- package.json bumped to `1.1.0`

**How it shipped:** Direct commits without GSD phase tracking.

## v1.2 — Harness Optimization (defining)

**Status:** Currently being scoped via `/gsd-new-milestone`.

**Source of truth:** See `.planning/PROJECT.md` Current Milestone section once defined, plus:
- `.planning/research/DEEP-RESEARCH.md` — Claude Web Deep Research on coding-agent harnesses (state-of-the-art 2024-2026)
- `.planning/research/INVENTORY.md` — Code-level sweep of current donnyclaude structure
- `.planning/research/SUMMARY.md` — Synthesis pointing to the above with top priorities

**Driving thesis:** donnyclaude is one of the largest harness configurations deployed on Claude Code. Measured evidence (SWE-bench Pro, Terminal Bench 2.0, BFCL v3, RAG-MCP) shows the 107-skills-always-loaded posture sits past the tool-count degradation cliff. Six high-leverage incremental fixes (progressive disclosure, verification hooks, active PreCompact, skill prune, return-contract enforcement, refactored SessionStart) plus deferred architectural work (multi-candidate patch pipeline, sandboxed execution, trace-based improvement loop) form the candidate scope.
