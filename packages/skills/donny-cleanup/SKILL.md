---
name: donny-cleanup
description: "Archive phase directories from completed milestones into .planning/milestones/v{X.Y}-phases/ so orphaned dirs stop confusing milestone-aware commands. Use when .planning/phases/ has accumulated dirs from past milestones; pass --dry-run to preview without moving anything."
argument-hint: "[--dry-run]"
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

<objective>
Archive phase directories from completed milestones into `.planning/milestones/v{X.Y}-phases/`.

Use when `.planning/phases/` has accumulated directories from past milestones.
</objective>

<execution_context>
@~/.claude/donny/workflows/cleanup.md
</execution_context>

<process>
Follow the cleanup workflow at @~/.claude/donny/workflows/cleanup.md.
Identify completed milestones, show a dry-run summary, and archive on confirmation.
</process>
