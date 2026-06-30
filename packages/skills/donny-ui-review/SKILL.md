---
name: donny-ui-review
description: "Runs a retroactive 6-pillar visual audit (copywriting, visuals, color, typography, spacing, registry and experience) of implemented frontend code and writes a scored UI-REVIEW.md with the top priority fixes. Use when grading or reviewing the visual quality of a built frontend phase, after execute-phase; works on any project, managed by donny or not."
argument-hint: "[phase]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---

<objective>
Conduct a retroactive 6-pillar visual audit. Produces UI-REVIEW.md with
graded assessment (1-4 per pillar). Works on any project.
Output: {phase_num}-UI-REVIEW.md
</objective>

<execution_context>
@~/.claude/donny/workflows/ui-review.md
@~/.claude/donny/references/ui-brand.md
</execution_context>

<context>
Phase: $ARGUMENTS - optional, defaults to last completed phase.
</context>

<process>
Execute @~/.claude/donny/workflows/ui-review.md end-to-end.
Preserve all workflow gates.
</process>
