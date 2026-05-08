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

## v1.2 — Harness Optimization (CLOSED without shipping full scope)

**Status:** Closed 2026-05-08 at HEAD `bf6dd7a` without shipping the originally-scoped phases. Renumbered to v1.3 backlog (paused donnyclaude maintenance).

**What actually shipped under the v1.2 banner:** None of the planned scope. Phase 01 reached "EXECUTING" with a restructured cruft-only plan (107→105 skill prune as v1.2.0-rc1) but never landed. Pre-execution scoping correction commit `7ff02a0` (43→41 candidate count fix) was the only durable artifact.

**Why it closed:** During the AHOL (Autonomous Harness Optimization Loop) work tracked in parallel in `.planning/research/ahol/`, a methodology post-mortem revealed that the v1.2 phases — skill prune, install manifest, progressive disclosure, subagent return contracts, hook backup/restore subsystem, stop verification — are donnyclaude-package maintenance, not harness optimization in the rigorous methodology sense. The "Harness Optimization" label was wrong. See `.planning/research/ahol/AHOL-POSTMORTEM.md` for the full account.

**Where the work went:**
- v1.2 phases preserved verbatim as donnyclaude maintenance backlog in `.planning/v1.3-BACKLOG.md`. Resumes whenever a donnyclaude maintenance window opens.
- Substrate-level harness research moved to a separate `harness-lab` repo (created in Phase 2 of `harness-pivot-v1`). Plan of record: `.planning/research/ahol/MILESTONE-PLAN-harness-pivot-v1.md`. Deep research backing: `.planning/research/ahol/HARNESS-RESEARCH-2026-05-08.md`.

**v1.2 research bundle preserved:** `.planning/research/{DEEP-RESEARCH,INVENTORY,SUMMARY,v1.3-seeds}` retained as donnyclaude maintenance reference. Not reused for `harness-pivot-v1` (which has its own deep research artifact).

---

## v2.0 — Substrate migration (in `harness-lab`, not in donnyclaude)

**Status:** Active as `harness-pivot-v1` in the separate `harness-lab` repo. Phase 1 (AHOL post-mortem) shipped from donnyclaude on 2026-05-08; Phases 2-27 execute in harness-lab once Phase 2 creates that repo.

**Tracked separately:** GSD planning for v2.0 lives in `harness-lab/.planning/`, NOT in this MILESTONES.md. This entry exists only to point at the harness-lab repo for cross-reference. donnyclaude itself does not version-track v2.0.

**Pointer:** Run `/gsd-new-milestone` inside harness-lab once Phase 2 creates it. Use the three staged artifacts in donnyclaude's `.planning/research/ahol/` (post-mortem, milestone plan, deep research) as input.
