---
name: donny-ui-phase
description: "Generates a UI design contract (UI-SPEC.md) that locks spacing, typography, color, copywriting, and component-registry decisions before a frontend phase is planned. Use when starting a UI-heavy or frontend phase, after discuss-phase and before plan-phase, to give the planner a fixed visual contract instead of leaving styling to executor discretion."
argument-hint: "[phase]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
  - WebFetch
  - AskUserQuestion
  - mcp__context7__*
---

<objective>
Create a UI design contract (UI-SPEC.md) for a frontend phase.
Orchestrates donny-ui-researcher and donny-ui-checker.
Flow: Validate -> Research UI -> Verify UI-SPEC -> Done
</objective>

<execution_context>
@~/.claude/donny/workflows/ui-phase.md
@~/.claude/donny/references/ui-brand.md
</execution_context>

<context>
Phase number: $ARGUMENTS - optional, auto-detects next unplanned phase if omitted.
</context>

<process>
Execute @~/.claude/donny/workflows/ui-phase.md end-to-end.
Preserve all workflow gates.
</process>
