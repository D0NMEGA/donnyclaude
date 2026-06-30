---
name: donny-remove-phase
description: "Removes an unstarted future phase from the roadmap and renumbers every subsequent phase for a clean linear sequence. Use to drop planned work that is no longer needed. Refuses started or completed phases. --dry-run previews the deletion and renumbering without changing anything."
argument-hint: "<phase-number> [--dry-run]"
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
---

<objective>
Remove an unstarted future phase from the roadmap and renumber all subsequent phases to maintain a clean, linear sequence.

Purpose: Clean removal of work that is no longer needed, without polluting context with cancelled/deferred markers.
Output: Phase deleted, all subsequent phases renumbered, git commit as historical record.
</objective>

<execution_context>
@~/.claude/donny/workflows/remove-phase.md
</execution_context>

<context>
Phase: $ARGUMENTS - phase number to remove, plus optional `--dry-run`.
- `--dry-run` - preview the deletion and renumbering, then exit without changing or committing anything.

Roadmap and state are resolved in-workflow via `init phase-op` and targeted reads.
</context>

<process>
Execute the remove-phase workflow from @~/.claude/donny/workflows/remove-phase.md end-to-end.
Preserve all validation gates (future phase check, work check), the `--dry-run` preview gate, renumbering logic, and commit.
</process>
