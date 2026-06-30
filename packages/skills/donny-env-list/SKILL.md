---
name: donny-env-list
description: "List Donny multi-repo environments (workspaces) with name, path, repo count, strategy, and project status. Use when reviewing or managing the isolated workspaces created by /donny-env-new, before switching into one or removing it."
allowed-tools:
  - Bash
  - Read
---

<objective>
Scan `~/donny-workspaces/` for workspace directories containing `WORKSPACE.md` manifests. Display a summary table with name, path, repo count, strategy, and Donny project status.
</objective>

<execution_context>
@~/.claude/donny/workflows/env-list.md
@~/.claude/donny/references/ui-brand.md
</execution_context>

<process>
Execute the workspace-listing workflow from @~/.claude/donny/workflows/env-list.md end-to-end.
</process>
