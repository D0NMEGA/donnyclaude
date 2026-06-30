---
name: donny-phase-add
description: "Adds a new phase to the current milestone's roadmap. Appends the next integer phase by default; with --after N inserts a decimal phase (N.1, N.2, ...) right after phase N for urgent mid-milestone work, without renumbering. Use to extend the roadmap with planned work, or to slot in urgent work discovered during execution. Creates the phase directory and ROADMAP.md entry; does not plan or commit."
argument-hint: "<description> [--after N]"
allowed-tools:
  - Read
  - Write
  - Bash
---

<objective>
Add a phase to the current milestone in the roadmap.

- **Append (default):** next sequential integer phase at the end of the milestone - planned work.
- **Insert (`--after N`):** decimal phase (e.g., 72.1) immediately after integer phase N - urgent work discovered mid-milestone, slotted in without renumbering the rest of the roadmap.

Both modes delegate to `donny-tools` for phase-number calculation, slug generation, directory creation, and ROADMAP.md updates, then record the change in STATE.md's Roadmap Evolution.
</objective>

<execution_context>
@~/.claude/donny/workflows/phase-add.md
</execution_context>

<context>
Arguments: $ARGUMENTS
- `<description>` - the phase description (required; all non-flag tokens).
- `--after N` - insert a decimal phase after integer phase N instead of appending.

Roadmap and state are resolved in-workflow via `init phase-op` and targeted tool calls.
</context>

<process>
Execute the phase-add workflow from @~/.claude/donny/workflows/phase-add.md end-to-end.
Preserve all gates: argument/mode parsing, integer validation for `--after`, roadmap existence check, the correct `donny-tools phase add`/`phase insert` delegation, decimal calculation, and STATE.md update.
</process>
