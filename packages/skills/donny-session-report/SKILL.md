---
name: donny-session-report
description: "Generate a SESSION_REPORT.md summarizing work performed, outcomes, files changed, and context usage read from the live statusline bridge when available. Use at the end of a work session to produce a shareable record of what happened."
allowed-tools:
  - Read
  - Bash
  - Write
---

<objective>
Generate a structured SESSION_REPORT.md document capturing session outcomes, work performed, and resource usage (actual context consumption from the statusline bridge when available, estimates otherwise). Provides a shareable artifact for post-session review.
</objective>

<execution_context>
@~/.claude/donny/workflows/session-report.md
</execution_context>

<process>
Execute the session-report workflow from @~/.claude/donny/workflows/session-report.md end-to-end.
</process>
