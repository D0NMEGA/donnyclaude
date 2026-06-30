---
name: donny-update
description: "Updates the installed Donny toolkit from the local source repo using a git-tag version check (no npm), then always reapplies local patches atomically. Use to sync ~/.claude with the donny repo after it advances, or to restore local modifications the redeploy overwrote. Modifies the global install, so it does not auto-run inside donny-autonomous."
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---


<objective>
Sync the installed Donny toolkit in `~/.claude/` with the local donny source repo, then restore any
local modifications the redeploy overwrote - in one atomic command.

This is a private fork: the npm self-update cord is cut. The version check is LOCAL and git-based
(the repo's git tag / HEAD versus what was last deployed). On a redeploy, the workflow ALWAYS
reapplies local patches at the end (the former reapply-patches step, folded in) so there is never a
separate reminder to run.

Routes to the update workflow which handles:
- Locating the source repo and reading the installed vs repo version (git-tag check, no npm)
- Showing the commit changelog since the last deploy and confirming
- Redeploying via the repo installer (node install.mjs)
- Reapplying local patches with three-way merge, automatically and atomically
- Recording the new install ref
</objective>

<execution_context>
@~/.claude/donny/workflows/update.md
</execution_context>

<process>
**Follow the update workflow** from `@~/.claude/donny/workflows/update.md` end-to-end.
Never call npm; the check and the changelog come from the local git repo. After any redeploy,
reapply local patches inline before reporting - do not defer it to a separate command.
</process>
