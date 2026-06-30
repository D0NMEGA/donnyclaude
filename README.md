<p align="center">
  <img src="https://raw.githubusercontent.com/d0nmega/donnyclaude/main/assets/banner.png" alt="DonnyClaude" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/skills-94-ff3333?style=for-the-badge" alt="94 Skills">
  <img src="https://img.shields.io/badge/agents-48-ff3333?style=for-the-badge" alt="48 Agents">
  <img src="https://img.shields.io/badge/engine-Donny-ff3333?style=for-the-badge" alt="Donny engine">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT License">
</p>

# DonnyClaude

**Prompt, context, harness, and loop engineering for Claude Code - in one config.**

The four disciplines that decide whether an AI coding setup is a toy or a tool
usually live in scattered blog posts and private dotfiles. DonnyClaude assembles
all four into one installable config: carefully engineered agent prompts, a
context layer that survives `/clear`, a deterministic harness that drives the
models, and a verification loop that refuses to mark unfinished work as done.

```bash
npx donnyclaude
```

One command installs the [Donny](#the-donny-engine) workflow engine, 94 skills,
48 specialized agents, coding rules for 13 languages, project hooks, and a curated
MCP setup - then Claude itself walks you through your first project.

---

## The four pillars

### Prompt engineering
48 agents and 94 slash-command skills, each a deliberately engineered prompt with
a single responsibility and a minimal tool grant. Reviewers, build-fixers,
researchers, planners, and verifiers - named and scoped so the right prompt runs
for the right job instead of one overloaded system prompt trying to do everything.

### Context engineering
Every non-trivial task writes its state to disk under `.planning/` - requirements,
roadmap, per-phase plans, summaries, and verification reports - so context
survives `/clear` and new sessions. Subagents each get a curated, isolated slice
of that context rather than the whole transcript. The Context7 MCP supplies live
library docs so the model codes against current APIs, not stale training data.

### Harness engineering
Under the agents sits the Donny engine: a deterministic Node CLI that the
workflows call for the things a language model should not guess at - plan
dependency-graph validation, frontmatter schemas, requirement coverage, secret
scanning, phase completion. Model-tiered subagents (Opus for planning and
verification, lighter tiers for mechanical work) keep cost proportional to the
task. Hooks enforce formatting, guards, and state integrity on every turn.

### Loop engineering
The unit of work is a loop: discover the next phase, plan it, execute it with
wave-parallel subagents, verify it, ship it, repeat. The generator never grades
its own work - a separate skeptical verifier checks goal achievement by running
code, and beneath even that sits a deterministic engine gate so the verdict
cannot drift from the truth. Run a single phase by hand, or hand the whole
roadmap to autonomous mode and let it advance unattended.

---

## The Donny engine

Donny is the workflow engine at the core - a planning-and-execution loop that
turns an idea into shipped, verified code through explicit phases. Its signature
is **deterministic verification**: where most agent workflows let an LLM declare
"looks good," Donny backs every gate with engine-enforced checks.

- `verify phase-verified` - a phase ships only when its verification status is
  actually `passed`, parsed from disk, never an LLM's say-so.
- `verify milestone-coverage` - requirement coverage computed across plans,
  summaries, and verifications, not hand-tallied.
- `verify threats-clear` / `security scan-secrets` - open threats and leaked
  credentials block the commit deterministically.
- `phase defer` - a skipped phase is recorded honestly as deferred, never
  silently marked complete.

The result is a loop you can leave running: it tells you the truth about what is
done, and stops cold when something is not.

## What gets installed

| Component | Count | What it is |
|-----------|-------|------------|
| Skills    | 94    | Slash commands - the Donny workflow plus utilities and language packs |
| Agents    | 48    | Specialized subagents - planners, reviewers, verifiers, build-fixers |
| Rules     | 14    | Coding standards, common + per-language |
| Hooks     | 29    | Format, guard, and state-integrity hooks that run on each turn |
| MCP       | 2     | context7 (live docs) and playwright (browser), registered at user scope |
| Engine    | 1     | The Donny CLI and workflow library |

Everything lands in `~/.claude/`. Existing settings are preserved, not clobbered.

## Quickstart

```bash
npx donnyclaude                 # install, then the setup wizard

# then, in Claude Code:
/donny-init                     # research -> requirements -> roadmap
/donny-plan-phase 1             # plan a phase (with dependency + requirement gates)
/donny-execute-phase 1          # build it (wave-parallel subagents, atomic commits)
/donny-verify-work 1            # conversational UAT
/donny-ship                     # open a PR once verification passes
```

Use `/donny-progress` any time to see where you are and what is next, or
`/donny-autonomous` to advance the whole roadmap hands-off. `/donny-help` lists
every command.

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (the installer
  installs it if missing)
- Node.js >= 20
- `uv` for the bundled research scrapers (optional; self-bootstraps on first run)

## Optional tools

- **Research scrapers** (bundled) - a multi-source HTTP research digest. See
  [docs/research-tools.md](docs/research-tools.md).
- **Obsidian** - a vault as durable memory. The installer offers to install it.
  See [docs/obsidian-memory.md](docs/obsidian-memory.md).
- **browser-harness** - optional, for login-gated research. Installed separately;
  see [docs/research-tools.md](docs/research-tools.md).

## Credits and license

DonnyClaude is MIT licensed. The Donny engine began as a fork of the GSD workflow
engine and has since diverged substantially - rebuilt around deterministic
verification gates, model-tiered subagents, and a subagent-safe research path.

The optional `browser-harness` integration references
[browser-use/browser-harness](https://github.com/browser-use/browser-harness)
(MIT, Copyright (c) 2026 Browser Use); it is not bundled, and all credit for that
project belongs to its authors.
