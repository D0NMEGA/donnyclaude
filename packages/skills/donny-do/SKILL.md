---
name: donny-do
description: "Routes freeform natural-language intent to the right Donny command and invokes it, acting as a dispatcher rather than doing the work itself. Use when you know what you want done but not which /donny-* command runs it."
argument-hint: "<description of what you want to do>"
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
---

<objective>
Analyze freeform natural language input and dispatch to the most appropriate Donny command.

Acts as a smart dispatcher - never does the work itself. Matches intent to the best Donny command using routing rules, confirms the match, then hands off.

Use when you know what you want but don't know which `/donny-*` command to run.
</objective>

<execution_context>
@~/.claude/donny/workflows/do.md
@~/.claude/donny/references/ui-brand.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the do workflow from @~/.claude/donny/workflows/do.md end-to-end.
Route user intent to the best Donny command and invoke it.
</process>
