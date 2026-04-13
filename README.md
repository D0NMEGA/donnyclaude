<p align="center">
  <img src="https://img.shields.io/badge/skills-105-ff3333?style=for-the-badge" alt="105 Skills">
  <img src="https://img.shields.io/badge/agents-49-ff3333?style=for-the-badge" alt="49 Agents">
  <img src="https://img.shields.io/badge/languages-13-ff3333?style=for-the-badge" alt="13 Languages">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT License">
</p>

# DonnyClaude

**Your Claude Code just got superpowers.**

DonnyClaude is an opinionated, all-in-one power-user setup for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). One command installs 105 skills, 49 specialized agents, coding rules for 13 languages, a full project workflow engine, and 7 pre-configured MCP servers. Then Claude itself walks you through setting up your project.

> *"I went from a fresh Claude Code install to autonomous multi-phase project execution in under 2 minutes."*

---

## Quick Start

```bash
# Install directly from GitHub
npx donnyclaude
```

That's it. DonnyClaude checks your prerequisites, installs the full toolkit to `~/.claude/`, then launches Claude Code as an interactive setup wizard to configure your project.

<details>
<summary><b>Alternative install methods</b></summary>

```bash
# Clone and run locally
git clone https://github.com/d0nmega/donnyclaude.git
cd donnyclaude
node bin/donnyclaude.js

# Or install globally
npm install -g donnyclaude
donnyclaude
```

</details>

---

## What's Inside

| | Component | Count | What It Does |
|---|-----------|-------|-------------|
| **Skills** | GSD workflow, Superpowers, ECC quality, language patterns | 105 | Slash commands for every dev workflow |
| **Agents** | Executor, verifier, planner, reviewer, debugger... | 49 | Specialized AI agents for each task type |
| **Rules** | TypeScript, Python, Rust, Go, C++, Kotlin, Java, Swift, PHP, Perl, C#, COBOL | 70 files | Coding standards enforced automatically |
| **GSD Engine** | Get Shit Done workflow | 1 | Plan -> Execute -> Verify -> Ship |
| **Hooks** | Format, guard, context monitor | 8 | Automatic quality gates on every edit |
| **Commands** | Slash commands | 60 | `/gsd:plan-phase`, `/code-review`, `/tdd`... |
| **MCP Servers** | Context7, Playwright, 21st.dev, Exa, Semantic Scholar, Computer Use, Vercel | 7 | Live docs, browser automation, UI generation |

---

## Installation

### Prerequisites

- **Node.js 20+** -- [nodejs.org](https://nodejs.org/)
- **Anthropic API key** -- [console.anthropic.com](https://console.anthropic.com/)

### macOS

```bash
brew install node    # if needed
npx donnyclaude
```

### Windows

```powershell
# Install Node.js from https://nodejs.org/ (LTS recommended)
# Then open PowerShell or Command Prompt:
npx donnyclaude
```

<details>
<summary>Alternative: WSL2</summary>

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
npx donnyclaude
```

</details>

### Linux

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Fedora
sudo dnf install nodejs

# Arch
sudo pacman -S nodejs npm

# Then:
npx donnyclaude
```

---

## How It Works

### Phase 1: Preflight

DonnyClaude checks for Node.js, npm, and Claude Code CLI. Installs Claude Code automatically if missing.

```
Checking prerequisites...
  ✓ Node.js v24.1.0
  ✓ npm 11.0.0
  ✓ Claude Code 2.1.97
```

### Phase 2: Install Toolkit

Copies all 105 skills, 49 agents, rules, hooks, GSD engine, and commands to `~/.claude/`. If you already have Claude Code customizations, they're preserved -- DonnyClaude merges, never clobbers.

```
Installing DonnyClaude toolkit...
  ✓ 105 skills installed
  ✓ 49 agents installed
  ✓ Rules installed (common + language-specific)
  ✓ GSD workflow engine installed
  ✓ Hooks installed
  ✓ Commands installed
  ✓ Settings merged (existing config preserved)
```

### Phase 3: Interactive Setup (Claude is the wizard)

Claude Code launches and walks you through project configuration:

1. **Stack detection** -- reads package.json / pyproject.toml / Cargo.toml
2. **CLAUDE.md generation** -- project instructions tailored to your stack
3. **Planning scaffold** -- `.planning/` directory with PROJECT.md, ROADMAP.md, STATE.md
4. **MCP server config** -- `.mcp.json` with 7 servers, prompts for API keys (skip any you don't have)

---

## The GSD Workflow

DonnyClaude is built around **Get Shit Done (GSD)** -- an autonomous project execution engine:

```
/gsd:new-project       Start a new project with deep context gathering
/gsd:plan-phase N      Plan a phase before any code is written
/gsd:execute-phase N   Execute with parallel subagents
/gsd:verify-work       Verify every phase before moving on
/gsd:progress          See where you are
/gsd:autonomous        Run ALL phases back-to-back, hands-free
```

**The loop:** Brainstorm -> Plan -> Test -> Build -> Review -> Verify -> Ship

Every phase gets planned before execution. Tests are written before code. Code is reviewed before merge. Nothing ships without verification.

---

## Supported Stacks

| Stack | Template | Extra Tools |
|-------|----------|-------------|
| **Python** (FastAPI, Django, Flask) | `python-fastapi.md` | python-review, python-testing, pytest patterns |
| **TypeScript** (Next.js, Node, React) | `nextjs-typescript.md` | 21st.dev Magic, Playwright, shadcn/ui |
| **Rust** | `rust.md` | rust-review, rust-build, cargo-llvm-cov |
| **Go** | `go.md` | go-review, go-build, table-driven tests |
| **Other** | `generic.md` | All base tools, universal rules |

---

## MCP Servers

Every project gets its own `.mcp.json` with 7 servers pre-configured:

| Server | API Key? | What It Does |
|--------|----------|-------------|
| [Context7](https://context7.com) | No | Live library documentation -- never use stale APIs again |
| [Playwright](https://playwright.dev) | No | Browser automation, visual QA, E2E testing |
| [21st.dev Magic](https://21st.dev) | Yes | Generate, refine, and browse UI components |
| [Exa](https://exa.ai) | Yes | Web search with code-aware results |
| [Semantic Scholar](https://semanticscholar.org) | No | Academic paper search and citation graphs |
| Computer Use | No | Control your desktop -- screenshots, clicks, typing |
| [Vercel](https://vercel.com) | OAuth | Deploy, manage env vars, check status |

---

## Commands

```bash
npx donnyclaude            # Install + setup wizard
npx donnyclaude doctor     # Health check
npx donnyclaude update     # Update to latest
npx donnyclaude version    # Show version
npx donnyclaude help       # Show help
```

---

## What Gets Created

**In your project:**

```
your-project/
  CLAUDE.md              # AI instructions tailored to your stack
  .mcp.json              # 7 MCP servers, ready to go
  .planning/
    PROJECT.md           # Vision and constraints
    REQUIREMENTS.md      # Tracked requirements
    ROADMAP.md           # Phase-based execution plan
    STATE.md             # Current progress tracker
    config.json          # Workflow config (models, toggles)
```

**Globally (`~/.claude/`):**

```
~/.claude/
  skills/        105 skills (GSD, Superpowers, ECC, language-specific — cruft removed in v1.2, see docs/PRUNE-LOG.md)
  agents/        49 specialized agents
  rules/         Coding standards for 13 languages
  get-shit-done/ GSD workflow engine
  hooks/         Auto-formatting and guard rails
  commands/      60 slash commands
  settings.json  Permissions and hook config
```

---

## Customizing

**Add skills:** Drop a `SKILL.md` into `~/.claude/skills/your-skill/`

**Add rules:** Copy and customize: `cp -r ~/.claude/rules/typescript ~/.claude/rules/your-lang`

**Tune GSD:** Edit `.planning/config.json` to change models, parallelization, and workflow toggles

**Power users:** Set `"defaultMode": "bypassPermissions"` in `~/.claude/settings.json` for fully autonomous operation (DonnyClaude defaults to `acceptEdits` for safety)

---

## Existing Claude Code Users

Already have a `~/.claude/` directory? DonnyClaude is safe to run:

- **Settings:** Merged, never overwritten. Your permissions, existing hooks, and custom config are preserved. A backup is created at `settings.json.bak` before any merge.
- **Skills/agents/rules:** Added alongside your existing ones. If you've customized a file with the same name, it will be overwritten -- back up any custom modifications first.
- **Doctor:** Run `donnyclaude doctor` to verify everything is healthy after install.

---

## Uninstall

To remove DonnyClaude's tools from your system:

```bash
# Remove global tools
rm -rf ~/.claude/skills ~/.claude/agents ~/.claude/rules
rm -rf ~/.claude/get-shit-done ~/.claude/hooks ~/.claude/commands

# Restore settings backup (if you had pre-existing settings)
cp ~/.claude/settings.json.bak ~/.claude/settings.json

# Remove project-local files (per project)
rm CLAUDE.md .mcp.json
rm -rf .planning/
```

---

## Credits

Built by [Donovan Santine](https://github.com/d0nmega) (D0NMEGA) -- BME Honors at UT Austin, building [MoltGrid](https://moltgrid.net).

Powered by:
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) by Anthropic
- [GSD](https://discord.gg/gsd) workflow engine
- [Everything Claude Code](https://github.com/anthropics/claude-code) skill ecosystem
- [Context7](https://context7.com) live documentation

---

## License

MIT -- use it, fork it, ship it.
