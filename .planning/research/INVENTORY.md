# DonnyClaude Inventory Sweep

Code-level inventory of donnyclaude's actual file structure as of milestone v1.2 bootstrap. Produced by the Explore subagent before the milestone was scoped, to ground recommendations against real files (not the README's described state). README claims and actual counts diverge in places; this file is the source of truth.

## 1. Actual inventory — exact counts and locations

### Skills: 107 directories (`packages/skills/`)
- Format: single-directory architecture — each skill is `packages/skills/{name}/SKILL.md`
- Structure: YAML frontmatter (name, description, origin) + markdown content
- **No `autoInvoke` metadata, no skill registry, no skill index file**
- One exception: `continuous-learning/config.json` has runtime config
- All 107 copied as-is to `~/.claude/skills/` during install via `bin/donnyclaude.js:155` (`cpSync(src, dest, { recursive: true, force: true })`)

### Slash commands: 60 files (`packages/commands/`)
- Format: `{name}.md` with YAML frontmatter (description) + markdown body
- Example: `aside.md` — simple role/instruction prose, no programmatic dispatch
- Pattern: YAML frontmatter → markdown instructions, no CLI parsing
- All copied to `~/.claude/commands/` during install

### Subagents: 49 agents (`packages/agents/`)
- Format: `{name}.md` with YAML frontmatter (name, description, tools, model, optional color)
- **Return contracts vary**:
  - **Explicit "return only" contracts**: `gsd-doc-verifier.md:20-21` ("Returns a one-line confirmation to the orchestrator only"), `gsd-doc-writer.md:24` ("Returns confirmation only")
  - **Role-prompt style (open-ended)**: most others — `architect.md`, `loop-operator.md`, `planner.md`, `code-reviewer.md`, `tdd-guide.md`, `chief-of-staff.md`, etc.
  - **No return-contract enforcement outside the GSD domain**. GSD agents (~20 agents) explicitly constrain returns; domain agents (reviewers, builders, architects) return full results.
- Tools declared per-agent in frontmatter (e.g., `tools: Read, Write, Bash, Grep, Glob, mcp__context7__*`)
- All copied to `~/.claude/agents/` during install

### Rules: 70 files (`packages/rules/`)
- **Languages covered**: 14 directories (common + 13 language-specific)
  - Language dirs: `python`, `golang`, `perl`, `typescript`, `rust`, `java`, `kotlin`, `php`, `cpp`, `swift`, `csharp`, `cobol`
  - `common/` has 9 files: agents, coding-style, development-workflow, git-workflow, hooks, patterns, performance, security, testing
  - Each language dir: ~5 files (coding-style, hooks, patterns, security, testing)
- Total expected: 9 common + (13 × 5) = 74; **actual count is 70** (some languages omit a file)
- Cross-references: e.g., `typescript/coding-style.md:1` → "extends [common/coding-style.md](../common/coding-style.md)"
- All copied to `~/.claude/rules/` during install

### Hooks: 8 hook files (`packages/hooks/`)
- **JavaScript hook implementations: 6 files**
  - `gsd-check-update.js` — UpdateCheck (session monitoring)
  - `gsd-context-monitor.js` — Context-aware warning injection (PostToolUse, ACTIVE)
  - `gsd-prompt-guard.js` — Prompt injection guard (PreToolUse, ACTIVE)
  - `gsd-read-guard.js` — File access guard (PreToolUse, ACTIVE)
  - `gsd-statusline.js` — Context display + bridge file (PostToolUse, PASSIVE)
  - `gsd-workflow-guard.js` — Workflow state validation (PreToolUse, ACTIVE)
- **Configuration: `hooks.json` (321 lines) — full lifecycle registry**
- **Lifecycle events bound: 7 events** (PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, SessionStart, SessionEnd, Stop)

## 2. Packaging / distribution

**Entry point:** `bin/donnyclaude.js` (379 lines)

**Install mechanism (`bin/donnyclaude.js:154-176`):**
- `cpSync(src, dest, { recursive: true, force: true })` — recursive copy with force overwrite
- Does NOT use symlinks or rsync
- Copies 6 component trees:
  1. `skills` → `~/.claude/skills`
  2. `agents` → `~/.claude/agents`
  3. `rules` → `~/.claude/rules`
  4. `gsd` → `~/.claude/get-shit-done`
  5. `hooks` → `~/.claude/hooks`
  6. `commands` → `~/.claude/commands`

**Manifest file: NONE** — no `.donnyclaude-manifest`, no file inventory, no checksums, no version pinning of distributed files

**Existing-file handling (`bin/donnyclaude.js:147-150`, `194-227`):**
- Warns if `~/.claude/` already exists (non-blocking)
- Backs up `settings.json` → `settings.json.bak` before merge
- **Merges** hooks section: adds template hooks only if event key doesn't exist (line 216)
- **Preserves** user permissions (line 208)
- **No detection** of conflicting user skills/agents/rules

**Setup wizard (`bin/donnyclaude.js:232-257`):**
- Launches Claude Code with `--append-system-prompt` template (`templates/setup-prompt.md`)
- Interactive — Claude walks user through project scaffold and MCP config

## 3. Progressive disclosure state — skills loading

**CRITICAL FINDING: All-on-load architecture**
- Skills are copied to `~/.claude/skills/` and loaded **always-on** by Claude Code
- **No skill manifest, index file, or lazy-load registry**
- **No `autoInvoke` metadata**, no description-based RAG matching
- Each skill is a self-contained directory with `SKILL.md`; Claude Code reads all of them and exposes them as `/skillname` commands
- **All 107 skills are in context from session start; no on-demand loading or conditional activation**

## 4. Hook activity level

| Lifecycle event | Count | Classification | Purpose |
|---|---|---|---|
| **PreToolUse** | 11 hooks | **ACTIVE** | Block unsafe operations (`git --no-verify`, config edits); inject reminders (tmux, git-push); context-aware guards |
| **PostToolUse** | 9 hooks | **MIXED** | Statusline (passive); quality gates (active); governance capture (active); MCP health check (active) |
| **PostToolUseFailure** | 1 hook | **ACTIVE** | MCP recovery: track unhealthy servers |
| **PreCompact** | 1 hook | **PASSIVE** | Saves state notes before context reduction (observational only — does NOT back up file paths or test status) |
| **SessionStart** | 1 hook | **ACTIVE** | Loads previous session context; detects package manager. **Implementation is a 300+ char inline shell one-liner in `hooks.json:132-143` — fragile, not testable** |
| **SessionEnd** | 1 hook | **PASSIVE** | Lifecycle marker |
| **Stop** | 5 hooks | **MIXED** | console.log audit (active), session end (passive), cost tracker (passive), desktop notify (passive), evaluate session (passive) |

**Active vs passive totals:**
- **ACTIVE: ~15 entries** — block tool execution, modify input, inject context, enforce guards
- **PASSIVE: ~6 entries** — observe, log, display status, evaluate without blocking

## 5. Subagent return contracts (sample of 10)

| Agent | Return contract | Type |
|---|---|---|
| `gsd-doc-verifier` | "Returns a one-line confirmation to the orchestrator only" | Explicit constraint |
| `gsd-doc-writer` | "Returns confirmation only — do not return doc content" | Explicit constraint |
| `gsd-executor` | Implicit (executes atomically, commits per-task) | GSD domain, structured |
| `gsd-debugger` | Open-ended (returns findings/fixes) | Role-prompt |
| `architect` | Open-ended (returns design proposal) | Role-prompt |
| `planner` | Open-ended (returns PLAN.md) | Role-prompt |
| `code-reviewer` | Open-ended (returns review findings) | Role-prompt |
| `chief-of-staff` | Open-ended (returns triage + drafts) | Role-prompt |
| `loop-operator` | Open-ended (monitoring/intervention) | Role-prompt |
| `tdd-guide` | Open-ended (guidance + code) | Role-prompt |

**Finding:** GSD orchestrated agents (~20 of 49) spawned by `/gsd-*` commands have explicit "return only X" contracts. Domain agents (reviewers, builders, architects, ~29 of 49) are role-prompt style with open-ended returns.

## 6. Notable gaps

**Critical absences:**

1. **No skill manifest** — no registry, index, or versioning of skills; no way to selectively load/disable skills
2. **No verification hook on Stop** — no post-session fact-check or state-validation hook
3. **No state-backup mechanism** — PreCompact hook saves notes but no explicit backup-on-exit; relies on implicit SessionStart recovery
4. **No trace/telemetry capture** — no request ID propagation, no call graph logging, no audit trail of which skill/agent was invoked when
5. **No SessionStart context-injection script** — context loading is a complex 300+ char shell one-liner inside `hooks.json:132-143`, not a declarative hook
6. **No skill description-based matching** — no RAG or relevance scoring; skills discovered by filename only
7. **No conflict detection** — no warning if user has a skill named `/api-design` that conflicts with installed donnyclaude `/api-design`
8. **No installation manifest** — no record of what was installed, no uninstall capability, no version pinning

## 7. Quick-win candidates

**High-impact single-file edits:**

1. **`bin/donnyclaude.js:154-176`** — install manifest logic
   - Add: write installed file list to `~/.claude/.donnyclaude-manifest.json` with checksums and versions
   - Impact: enables selective updates, uninstall, conflict detection, offline audit

2. **`packages/core/settings-template.json`** (current ~41 lines)
   - Add: skill enable/disable registry under `skills: { enabled: [...], disabled: [...] }`
   - Add: hook registry entry for `Stop` verification (none exists currently)
   - Impact: progressive disclosure; users can disable 107 → N skills without editing `~/.claude/`

3. **`packages/hooks/hooks.json:132-143`** (SessionStart)
   - Replace: current 300+ char shell one-liner with declarative hook command pointing to a script
   - Impact: auditable, debuggable, testable SessionStart context injection

4. **Add: `packages/hooks/skill-index.js`**
   - Scans `~/.claude/skills/*/SKILL.md`, builds symbol table, emits index
   - Hook: PreCompact or SessionEnd
   - Impact: enables RAG-over-skills, on-demand loading, skill-discovery API

5. **Add: `packages/hooks/verification-hook.js`**
   - On Stop: verify all written files exist, all commits made, session state saved
   - Hook: Stop lifecycle
   - Impact: guarantees session-closure invariants

## Summary table

| Category | Count | Format | Location | Always-loaded | Manifest |
|---|---|---|---|---|---|
| Skills | 107 | `SKILL.md` (md + frontmatter) | `packages/skills/` | ✓ Yes | ✗ None |
| Slash commands | 60 | `.md` (md + frontmatter) | `packages/commands/` | ✓ Yes | ✗ None |
| Subagents | 49 | `.md` (md + frontmatter) | `packages/agents/` | ✗ On-demand | ✗ None |
| Rule files | 70 | `.md` across 14 dirs | `packages/rules/` | ✗ On-demand | ✗ None |
| Hook implementations | 6 JS + 1 registry | `.js` + `hooks.json` | `packages/hooks/` | ✓ Yes (via settings) | ✓ `hooks.json` |
| Lifecycle events | 7 | `hooks.json` entries | `hooks.json` | ✓ Yes | ✓ `hooks.json` |

**README claims vs actual:** README claims 122 skills, 60 commands, 49 agents, 6 hooks, 65 rule files. **Actual: 107 skills, 60 commands, 49 agents, 6 hook implementations + 8 hook files, 70 rule files.** README needs updating.
