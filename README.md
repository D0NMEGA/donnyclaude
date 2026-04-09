# DonnyClaude

**Opinionated, all-in-one Claude Code power-user setup.** Zero to production-grade AI-assisted development in one command.

107 skills. 49 agents. 12 language rulesets. GSD workflow engine. MCP server configs. All pre-wired and ready to go.

## Quick Start

```bash
npx donnyclaude
```

That's it. DonnyClaude checks your prerequisites, installs the full toolkit, then launches Claude Code as an interactive setup wizard to configure your project.

## What You Get

| Component | Count | What It Does |
|-----------|-------|--------------|
| Skills | 107 | GSD workflow, Superpowers, ECC quality tools, language patterns |
| Agents | 49 | Executor, verifier, planner, reviewer, debugger, and more |
| Rules | 65 files | Coding standards for 12 languages (TypeScript, Python, Rust, Go, C++, Kotlin, Java, Swift, PHP, Perl, C#) |
| GSD Engine | 1 | Full workflow: plan -> execute -> verify -> next |
| Hooks | 8 | Auto-formatting, guard rails, context monitoring |
| Commands | 60 | Slash commands for every workflow step |
| MCP Servers | 7 | Context7, Playwright, 21st.dev, Exa, Semantic Scholar, Computer Use, Vercel |

## Installation

### Prerequisites

- **Node.js 20+** -- [Download](https://nodejs.org/)
- **Anthropic API key** -- [Get one](https://console.anthropic.com/)

### macOS

```bash
# Install Node.js (if needed)
brew install node

# Run DonnyClaude
npx donnyclaude
```

### Windows

```powershell
# Install Node.js from https://nodejs.org/ (LTS recommended)
# Then open PowerShell or Command Prompt:
npx donnyclaude
```

**Alternative: WSL2** (if you prefer a Linux environment)

```bash
# Inside WSL2 terminal
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

npx donnyclaude
```

### Linux

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Fedora/RHEL
sudo dnf install nodejs

# Arch
sudo pacman -S nodejs npm

# Then:
npx donnyclaude
```

## What Happens When You Run It

### Phase 1: Prerequisites
DonnyClaude checks for Node.js, npm, and Claude Code CLI. Installs Claude Code if missing.

### Phase 2: Install Global Tools
Copies 107 skills, 49 agents, rules, hooks, GSD engine, and commands to `~/.claude/`. Merges with your existing settings without overwriting.

### Phase 3: Interactive Setup (inside Claude Code)
Claude Code launches and walks you through:

1. **Stack detection** -- reads your package.json/pyproject.toml/Cargo.toml
2. **CLAUDE.md generation** -- project instructions tailored to your stack
3. **Planning scaffold** -- `.planning/` directory with PROJECT.md, ROADMAP.md, etc.
4. **MCP server config** -- `.mcp.json` with 7 servers, prompts for API keys

## Commands After Setup

```bash
npx donnyclaude update    # Update to latest version
npx donnyclaude doctor    # Check installation health
npx donnyclaude help      # Show help
```

## The GSD Workflow

DonnyClaude is built around the **Get Shit Done (GSD)** workflow:

```
/gsd:new-project       Initialize project structure
/gsd:plan-phase N      Plan a phase before execution
/gsd:execute-phase N   Execute with fresh subagent contexts
/gsd:verify-work       Verify after phase completion
/gsd:progress          Check project status
/gsd:autonomous        Run all phases back-to-back
```

## Supported Stacks

| Stack | Template | Language Rules | Extra Tools |
|-------|----------|---------------|-------------|
| Python + FastAPI | `python-fastapi.md` | Python rules | python-review, python-testing |
| Next.js + TypeScript | `nextjs-typescript.md` | TypeScript rules | 21st.dev Magic, Playwright |
| Rust | `rust.md` | Rust rules | rust-review, rust-build |
| Go | `go.md` | Go rules | go-review, go-build |
| Other | `generic.md` | Common rules | All base tools |

## MCP Servers

| Server | Needs API Key | Purpose |
|--------|--------------|---------|
| [Context7](https://context7.com) | No | Live library documentation |
| [Playwright](https://playwright.dev) | No | Browser automation + visual QA |
| [21st.dev Magic](https://21st.dev) | Yes | UI component generation |
| [Exa](https://exa.ai) | Yes | Web search + code context |
| [Semantic Scholar](https://semanticscholar.org) | No | Academic paper search |
| Computer Use | No | Desktop control |
| [Vercel](https://vercel.com) | OAuth | Deployment + env vars |

## File Structure

After setup, your project has:

```
your-project/
  CLAUDE.md                 # Project instructions (stack-specific)
  .mcp.json                 # MCP server connections
  .planning/
    PROJECT.md              # Vision, principles, constraints
    REQUIREMENTS.md         # Requirement tracking
    ROADMAP.md              # Phase-based roadmap
    STATE.md                # Current progress
    config.json             # Workflow configuration
```

And globally in `~/.claude/`:

```
~/.claude/
  skills/                   # 107 skills
  agents/                   # 49 agents
  rules/                    # Coding standards (common + 12 languages)
  get-shit-done/            # GSD workflow engine
  hooks/                    # Auto-formatting, guards
  commands/                 # Slash commands
  settings.json             # Permissions + hooks
```

## Customizing

### Add your own skills
Drop `.md` files into `~/.claude/skills/your-skill/SKILL.md`

### Add language rules
Copy a language directory and customize: `cp -r ~/.claude/rules/typescript ~/.claude/rules/your-lang`

### Change GSD config
Edit `.planning/config.json` in your project to adjust models, parallelization, and workflow toggles.

## Credits

Built by [Donovan Santine](https://github.com/d0nmega) (D0NMEGA).

Powered by:
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) by Anthropic
- [GSD (Get Shit Done)](https://github.com/d0nmega/donnyclaude) workflow engine
- [Everything Claude Code](https://github.com/anthropics/claude-code) skills
- [Context7](https://context7.com) live documentation

## License

MIT
