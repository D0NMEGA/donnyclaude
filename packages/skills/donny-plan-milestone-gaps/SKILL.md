---
name: donny-plan-milestone-gaps
description: "Create every fix phase needed to close the gaps a milestone audit found, in one pass instead of manual /donny-phase-add calls. Reads the latest MILESTONE-AUDIT.md, groups gaps into logical phases, and updates ROADMAP.md and the requirements traceability table. Use after /donny-audit-milestone reports gaps."
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

<objective>
Create all phases necessary to close gaps identified by `/donny-audit-milestone`.

Reads MILESTONE-AUDIT.md, groups gaps into logical phases, creates phase entries in ROADMAP.md, and offers to plan each phase.

One command creates all fix phases - no manual `/donny-phase-add` per gap.
</objective>

<execution_context>
@~/.claude/donny/workflows/plan-milestone-gaps.md
</execution_context>

<context>
**Audit results:**
Glob: .planning/v*-MILESTONE-AUDIT.md (use most recent)

Original intent and current planning state are loaded on demand inside the workflow.
</context>

<process>
Execute the plan-milestone-gaps workflow from @~/.claude/donny/workflows/plan-milestone-gaps.md end-to-end.
Preserve all workflow gates (audit loading, prioritization, phase grouping, user confirmation, roadmap updates).
</process>
