---
name: donny-progress
description: "Reports project progress with inline statistics (phase, plan, and requirement counts, git metrics, timeline) and routes to the next action. Use when checking where a project stands, what was recently done, and whether to execute an existing plan or plan the next phase."
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

<objective>
Check project progress, show the numeric statistics dashboard inline (phases, plans, requirements, git metrics, timeline), summarize recent work and what's ahead, then intelligently route to the next action - either executing an existing plan or creating the next one.

Provides situational awareness before continuing work. The statistics are always shown inline; there is no separate stats command.
</objective>

<execution_context>
@~/.claude/donny/workflows/progress.md
</execution_context>

<process>
Execute the progress workflow from @~/.claude/donny/workflows/progress.md end-to-end.
Preserve all routing logic (Routes A through F), the inline statistics dashboard, and edge case handling.
</process>
