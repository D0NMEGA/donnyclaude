---
name: donny-next
description: "Detects the current project state from STATE.md, ROADMAP.md, and phase directories and immediately invokes the next logical Donny step (discuss, plan, execute, verify, or complete). Use when moving fast across projects and you do not want to track which phase or step comes next."
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

<objective>
Detect the current project state and automatically invoke the next logical Donny workflow step.
No arguments needed - reads STATE.md, ROADMAP.md, and phase directories to determine what comes next.

Designed for rapid multi-project workflows where remembering which phase/step you're on is overhead.
</objective>

<execution_context>
@~/.claude/donny/workflows/next.md
</execution_context>

<process>
Execute the next workflow from @~/.claude/donny/workflows/next.md end-to-end.
</process>
