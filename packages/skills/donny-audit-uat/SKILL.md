---
name: donny-audit-uat
description: "Scans every phase for outstanding UAT and verification items (pending, skipped, blocked, human-needed), cross-references the codebase to flag stale entries, and produces a prioritized human test plan. Use to find all manual testing still owed across the project."
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
---

<objective>
Scan all phases for pending, skipped, blocked, and human_needed UAT items. Cross-reference against codebase to detect stale documentation. Produce prioritized human test plan.
</objective>

<execution_context>
@~/.claude/donny/workflows/audit-uat.md
</execution_context>

<context>
Core planning files are loaded in-workflow via CLI.

**Scope:**
Glob: .planning/phases/*/*-UAT.md
Glob: .planning/phases/*/*-VERIFICATION.md
</context>
