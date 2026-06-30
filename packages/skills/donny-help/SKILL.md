---
name: donny-help
description: "Shows the complete Donny command reference, grouped by task, with arguments and common workflow recipes. Use when checking which donny commands exist or how they fit together."
allowed-tools:
  - Read
---

<objective>
Display the complete Donny command reference.

Output ONLY the reference content below. Do NOT add:
- Project-specific analysis
- Git status or file context
- Next-step suggestions
- Any commentary beyond the reference
</objective>

<execution_context>
@~/.claude/donny/workflows/help.md
</execution_context>

<process>
Output the complete Donny command reference from @~/.claude/donny/workflows/help.md.
Display the reference content directly - no additions or modifications.
</process>
