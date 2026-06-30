---
name: donny-env-remove
description: "Remove a Donny multi-repo environment (workspace) and clean up its git worktrees, after typed confirmation. Refuses if any member repo has uncommitted changes. Use when deleting a workspace created by /donny-env-new once its work is merged or abandoned."
argument-hint: "<workspace-name>"
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

<context>
**Arguments:**
- `<workspace-name>` (required) - Name of the workspace to remove
</context>

<objective>
Remove a workspace directory after confirmation. For worktree strategy, runs `git worktree remove` for each member repo first. Refuses if any repo has uncommitted changes.
</objective>

<execution_context>
@~/.claude/donny/workflows/env-remove.md
@~/.claude/donny/references/ui-brand.md
</execution_context>

<process>
Execute the workspace-removal workflow from @~/.claude/donny/workflows/env-remove.md end-to-end.
</process>
