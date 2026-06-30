---
name: donny-health
description: "Validate .planning/ directory structural integrity (missing files, bad config, orphaned phase dirs, state drift) and optionally auto-repair fixable issues. Use when commands behave oddly, after a crash, or to check planning health; pass --repair to fix repairable problems."
argument-hint: "[--repair]"
allowed-tools:
  - Read
  - Bash
  - Write
  - AskUserQuestion
---

<objective>
Validate `.planning/` directory integrity and report actionable issues. Checks for missing files, invalid configurations, inconsistent state, and orphaned plans.
</objective>

<execution_context>
@~/.claude/donny/workflows/health.md
</execution_context>

<process>
Execute the health workflow from @~/.claude/donny/workflows/health.md end-to-end.
Parse --repair flag from arguments and pass to workflow.
</process>
