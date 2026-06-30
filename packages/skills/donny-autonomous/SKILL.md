---
name: donny-autonomous
description: "Runs all remaining milestone phases end to end - discuss, plan, execute, verify per phase - pausing only for decisions or blockers, then audits, completes, and cleans up the milestone. Use when you want to advance the roadmap hands-off; scope with --from, --to, or --only N, or --interactive to answer discuss questions inline."
argument-hint: "[--from N] [--to N] [--only N] [--interactive]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Task
---

<objective>
Execute all remaining milestone phases autonomously. For each phase: discuss -> plan -> execute. Pauses only for user decisions (grey area acceptance, blockers, validation requests).

Uses ROADMAP.md phase discovery and Skill() flat invocations for each phase command. After all phases complete: milestone audit -> complete -> cleanup.

**Creates/Updates:**
- `.planning/STATE.md` - updated after each phase
- `.planning/ROADMAP.md` - progress updated after each phase
- Phase artifacts - CONTEXT.md, PLANs, SUMMARYs per phase

**After:** Milestone is complete and cleaned up.
</objective>

<execution_context>
@~/.claude/donny/workflows/autonomous.md
@~/.claude/donny/references/ui-brand.md
</execution_context>

<context>
Optional flags:
- `--from N` - start from phase N instead of the first incomplete phase.
- `--to N` - stop after phase N completes (halt instead of advancing to next phase).
- `--only N` - execute only phase N (single-phase mode).
- `--interactive` - run discuss inline with questions (not auto-answered), then dispatch plan->execute as background agents. Keeps the main context lean while preserving user input on decisions.

Project context, phase list, and state are resolved inside the workflow using init commands (`donny-tools.cjs init milestone-op`, `donny-tools.cjs roadmap analyze`). No upfront context loading needed.
</context>

<process>
Execute the autonomous workflow from @~/.claude/donny/workflows/autonomous.md end-to-end.
Preserve all workflow gates (phase discovery, per-phase execution, blocker handling, progress display).
</process>
