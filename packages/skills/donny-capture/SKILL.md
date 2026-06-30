---
name: donny-capture
description: "Capture and triage ideas, tasks, and todos during a session. Subcommands: note (default, zero-friction quick note), todo (structured todo committed to git), todos (list and act on pending todos), promote (turn a note into a todo). Use when an idea or follow-up surfaces mid-work and should be saved without losing focus, or to review and pick up captured todos."
argument-hint: "[note|todo|todos|promote] [text|area|N] [--global]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---


<objective>
One capture surface for the whole "thought -> capture -> continue" loop, with four subcommands:

- **note** (default) - zero-friction quick note, written inline with one confirmation line.
- **todo** - structured todo from arguments or recent conversation, committed to git.
- **todos** - list pending todos, load full context for one, and route it to an action.
- **promote** - convert a saved note into a structured todo (committed, same schema as todo).

The default with no recognized subcommand is a quick note, so a stray capture is never lost.
`todo` and `promote` share one todo schema, so the `todos` lister treats them identically.
</objective>

<execution_context>
@~/.claude/donny/workflows/capture.md
</execution_context>

<context>
Arguments: $ARGUMENTS - optional subcommand, then text (note/todo), area (todos), or number (promote).
`--global` forces global note scope. Todo state is resolved in-workflow via `init todos`.
</context>

<process>
Execute the capture workflow from @~/.claude/donny/workflows/capture.md end-to-end.
Route on the first token of $ARGUMENTS (note/todo/todos/promote), defaulting to a quick note.
</process>
