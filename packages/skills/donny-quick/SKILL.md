---
name: donny-quick
description: "Executes a small ad-hoc task with Donny guarantees (atomic commit, STATE.md tracking) without a full roadmap phase. Triages automatically: runs inline for a trivial one-liner, or spawns a planner plus executor for a real change. Use when you have a one-off task to track outside the phase workflow; add --discuss, --research, --validate, or --full to layer on quality stages."
argument-hint: "[--full] [--validate] [--discuss] [--research] [task]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Task
  - AskUserQuestion
---

<objective>
Execute small, ad-hoc tasks with Donny guarantees (atomic commits, STATE.md tracking) outside the ROADMAP phase flow.

Quick triages the task and takes the lightest path that fits - no flag required:
- **Trivial one-liner** (typo, config value, missing import, version bump, forgotten commit): runs INLINE in this context - no subagents, no PLAN.md - stages only the touched files, commits, and logs to STATE.md.
- **Real change:** spawns donny-planner (quick mode) + donny-executor(s), tracks the task in `.planning/quick/` (separate from planned phases), and updates STATE.md's "Quick Tasks Completed" table (NOT ROADMAP.md).

The judgment is automatic. Passing any quality flag forces the full pipeline:

**`--discuss` flag:** Lightweight discussion phase before planning. Surfaces assumptions, clarifies gray areas, captures decisions in CONTEXT.md. Use when the task has ambiguity worth resolving upfront.

**`--research` flag:** Spawns a focused research agent before planning. Investigates implementation approaches, library options, and pitfalls for the task. Use when you're unsure of the best approach.

**`--validate` flag:** Enables plan-checking (max 2 iterations) and post-execution verification only. Use when you want quality guarantees without discussion or research.

**`--full` flag:** Enables the complete quality pipeline - discussion + research + plan-checking + verification. One flag for everything.

Granular flags are composable: `--discuss --research --validate` gives the same result as `--full`.
</objective>

<execution_context>
@~/.claude/donny/workflows/quick.md
</execution_context>

<context>
$ARGUMENTS

Context files are resolved inside the workflow (`init quick`) and delegated via `<files_to_read>` blocks.
</context>

<process>
Execute the quick workflow from @~/.claude/donny/workflows/quick.md end-to-end.
Preserve all workflow gates (validation, task description, planning, execution, state updates, commits).
</process>
