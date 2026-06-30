---
name: donny-env-new
description: "Create an isolated multi-repo environment: a workspace directory of git worktrees or clones, each with its own independent .planning/. Use when running parallel Donny sessions across several repos, or isolating a feature on a worktree with separate planning state. Distinct from /donny-workstreams (logical concurrency inside one project)."
argument-hint: "--name <name> [--repos repo1,repo2] [--path /target] [--strategy worktree|clone] [--branch name] [--auto]"
allowed-tools:
  - Read
  - Bash
  - Write
  - AskUserQuestion
---

<context>
**Flags:**
- `--name` (required) - Workspace name
- `--repos` - Comma-separated repo paths or names. If omitted, interactive selection from child git repos in cwd
- `--path` - Target directory. Defaults to `~/donny-workspaces/<name>`
- `--strategy` - `worktree` (default, lightweight) or `clone` (fully independent)
- `--branch` - Branch to checkout. Defaults to `workspace/<name>`
- `--auto` - Skip interactive questions, use defaults
</context>

<objective>
Create a physical workspace directory containing copies of specified git repos (as worktrees or clones) with an independent `.planning/` directory for isolated Donny sessions.

**Use cases:**
- Multi-repo orchestration: work on a subset of repos in parallel with isolated Donny state
- Feature branch isolation: create a worktree of the current repo with its own `.planning/`

**Creates:**
- `<path>/WORKSPACE.md` - workspace manifest
- `<path>/.planning/` - independent planning directory
- `<path>/<repo>/` - git worktree or clone for each specified repo

**After this command:** `cd` into the workspace and run `/donny-init` to initialize Donny.
</objective>

<execution_context>
@~/.claude/donny/workflows/env-new.md
@~/.claude/donny/references/ui-brand.md
</execution_context>

<process>
Execute the workspace-creation workflow from @~/.claude/donny/workflows/env-new.md end-to-end.
Preserve all workflow gates (validation, approvals, commits, routing).
</process>
