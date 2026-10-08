---
name: cc-docs
description: Authoritative, current facts about Claude Code itself and the Claude Agent SDK — hook events, settings.json keys, environment variables, CLI flags, slash commands, subagents, MCP configuration, output styles, permissions, checkpointing, worktrees, memory. Use whenever a task needs an exact Claude Code detail (a hook event name, a settings key, an env var, an SDK signature, a CLI flag) instead of relying on training data, which lags releases. Reads the local 221-page docs mirror (refreshed 2026-10-07) at ~/vault/Reference/Claude-Code-Docs/.
allowed-tools: Read, Grep, Glob
---

> **Mirror refreshed 2026-10-07** (221 live pages via `cc-docs-refresh`; 9 removed pages marked archived). Re-run `cc-docs-refresh` monthly. Earlier notice: the mirror was a June 2026 snapshot (159 pages vs 221 live; 83 live pages missing, 51 releases behind). For any fact that could have changed, fetch the live page first: `curl -sL https://code.claude.com/docs/en/<slug>.md` (page index: `curl -sL https://code.claude.com/docs/llms.txt`). Prefer the live page over the mirror when they disagree, and say which one you used.

# Claude Code docs (local mirror)

A verbatim, version-pinned mirror of the official Claude Code docs lives at
`~/vault/Reference/Claude-Code-Docs/` — 148 page notes (`confidence: A`, each with a
`source_url`), 10 section MOCs, one hub. Prefer it over memory for any
Claude-Code-specific fact.

## Navigate
1. Hub: `~/vault/Reference/Claude-Code-Docs/Claude-Code-Docs.md` — links the 10 section MOCs.
2. Section MOC (e.g. `MOC-Configuration.md`) — lists that section's pages with one-line descriptions.
3. Grep/read the page note(s). Filenames are the doc slugs.

## Topic → file
- Hooks, hook events, exit codes, JSON I/O → `hooks.md`, `hooks-guide.md`
- `settings.json` keys → `settings.md`
- Environment variables → `env-vars.md`
- CLI flags/commands → `cli-reference.md`
- Built-in tools → `tools-reference.md`
- MCP config, tool search → `mcp.md`, `mcp-quickstart.md`, `managed-mcp.md`
- Subagents → `sub-agents.md` · Skills & slash commands → `skills.md`, `commands.md`
- Output styles → `output-styles.md` · Statusline → `statusline.md`
- Permissions & modes → `permissions.md`, `permission-modes.md`
- Memory, CLAUDE.md, auto-memory → `memory.md`
- Checkpointing / rewind → `checkpointing.md` · Worktrees → `worktrees.md`
- Sandboxing → `sandboxing.md`, `sandbox-environments.md`
- Agent SDK (Python/TS, hooks, MCP, sessions, tool search, …) → `agent-sdk/<topic>.md`
- Plugins → `plugins.md`, `plugins-reference.md`, `plugin-marketplaces.md`
- Recent changes → `changelog.md`, `whats-new/`

## Grep recipes
- Hook events: `grep -nE 'PreToolUse|PostToolUse|hookEventName|^#{2,3} ' ~/vault/Reference/Claude-Code-Docs/hooks.md`
- A settings key: `grep -n '"<key>"' ~/vault/Reference/Claude-Code-Docs/settings.md`
- An env var: `grep -nE 'CLAUDE_CODE_|ANTHROPIC_' ~/vault/Reference/Claude-Code-Docs/env-vars.md`
- An SDK symbol: `grep -rn '<Symbol>' ~/vault/Reference/Claude-Code-Docs/agent-sdk/`

## Rules
- Quote the note and cite its `source_url`. Don't paraphrase Claude Code specifics from memory.
- The mirror is pinned to the fetch date in frontmatter; for "did this change," check `changelog.md` / `whats-new/`.
- Refresh: `python3 ~/Desktop/claudecodedocs/tools/ccdocs/build.py --all && python3 ~/Desktop/claudecodedocs/tools/ccdocs/verify.py`
