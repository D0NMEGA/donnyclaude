---
name: donny-ship
description: "Ships a verified phase or milestone to a pull request: pushes the branch, builds a clean PR history that drops .planning commits by default, opens the PR with an auto-generated body, and offers review. Use when verification passes and you are ready for code review and merge."
argument-hint: "[phase number or milestone, e.g., '4' or 'v1.0']"
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - Write
  - AskUserQuestion
---

<objective>
Bridge local completion -> merged PR. After /donny-verify-work passes, ship the work: push branch, create PR with auto-generated body, optionally trigger review, and track the merge.

By default the PR gets a clean history - commits touching only `.planning/` are filtered out and planning files are stripped from mixed commits, so reviewers see code, not Donny artifacts. Pass `--include-planning` to ship the branch as-is.

Closes the plan -> execute -> verify -> ship loop.
</objective>

<execution_context>
@~/.claude/donny/workflows/ship.md
</execution_context>

Execute the ship workflow from @~/.claude/donny/workflows/ship.md end-to-end.
