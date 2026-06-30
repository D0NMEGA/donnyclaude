---
name: donny-audit-milestone
description: "Audit a milestone against its definition of done before archiving: aggregate per-phase VERIFICATION results, cross-check requirements coverage from three sources, spawn an integration checker for cross-phase wiring, and emit a structured audit report. Use when wrapping up a milestone, before /donny-complete-milestone, to confirm nothing was missed."
argument-hint: "[version]"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Task
  - Write
---

<objective>
Verify milestone achieved its definition of done. Check requirements coverage, cross-phase integration, and end-to-end flows.

**This command IS the orchestrator.** Reads existing VERIFICATION.md files (phases already verified during execute-phase), aggregates tech debt and deferred gaps, then spawns integration checker for cross-phase wiring.
</objective>

<execution_context>
@~/.claude/donny/workflows/audit-milestone.md
</execution_context>

<context>
Version: $ARGUMENTS (optional - defaults to current milestone)

Core planning files are resolved in-workflow (`init milestone-op`) and loaded only as needed.

**Completed Work:**
Glob: .planning/phases/*/*-SUMMARY.md
Glob: .planning/phases/*/*-VERIFICATION.md
</context>

<process>
Execute the audit-milestone workflow from @~/.claude/donny/workflows/audit-milestone.md end-to-end.
Preserve all workflow gates (scope determination, verification reading, integration check, requirements coverage, routing).
</process>
