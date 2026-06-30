<purpose>
Remove an unstarted future phase from the project roadmap, delete its directory, renumber all subsequent phases to maintain a clean linear sequence, and commit the change. The git commit serves as the historical record of removal.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="parse_arguments">
Parse the command arguments:
- The phase number to remove (integer or decimal) is the first non-flag token
- `--dry-run` (anywhere in the arguments) sets `DRY_RUN=true` - preview the removal and renumbering, change nothing
- Example: `/donny-remove-phase 17` -> phase = 17, DRY_RUN=false
- Example: `/donny-remove-phase 16.1 --dry-run` -> phase = 16.1, DRY_RUN=true

If no phase number provided:

```
ERROR: Phase number required
Usage: /donny-remove-phase <phase-number> [--dry-run]
Example: /donny-remove-phase 17
```

Exit.
</step>

<step name="init_context">
Load phase operation context:

```bash
INIT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" init phase-op "${target}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Extract: `phase_found`, `phase_dir`, `phase_number`, `commit_docs`, `roadmap_exists`.

Also read STATE.md and ROADMAP.md content for parsing current position.
</step>

<step name="validate_future_phase">
Verify the phase is a future phase (not started):

1. Compare target phase to current phase from STATE.md
2. Target must be > current phase number

If target <= current phase:

```
ERROR: Cannot remove Phase {target}

Only future phases can be removed:
- Current phase: {current}
- Phase {target} is current or completed

To abandon current work, use /donny-pause-work instead.
```

Exit.
</step>

<step name="dry_run_preview">
**Only if `DRY_RUN` is true.** Show exactly what a real removal would do, then stop without touching anything.

1. From ROADMAP.md and `.planning/phases/`, collect the target phase and every phase ordered after it.
2. Build the renumber map: the target is deleted; each subsequent integer phase `N` becomes `N-1` (decimal phases under the target are removed with it; decimals under later integer phases shift with their parent).
3. Print the plan:

```
DONNY ► REMOVE PHASE {target} - DRY RUN (no changes made)

Would delete:
- .planning/phases/{target}-{slug}/

Would renumber:
- Phase {N}   -> Phase {N-1}   ({name})
- Phase {N+1} -> Phase {N}     ({name})
  ... (every subsequent phase)

Would update: ROADMAP.md, STATE.md
Would commit:  chore: remove phase {target} ({name})

Re-run without --dry-run to apply.
```

Exit the workflow. Do not delegate to donny-tools, do not commit.
</step>

<step name="confirm_removal">
Present removal summary and confirm:

```
Removing Phase {target}: {Name}

This will:
- Delete: .planning/phases/{target}-{slug}/
- Renumber all subsequent phases
- Update: ROADMAP.md, STATE.md

Proceed? (y/n)
```

Wait for confirmation.
</step>

<step name="execute_removal">
**Delegate the entire removal operation to donny-tools:**

```bash
RESULT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" phase remove "${target}")
```

If the phase has executed plans (SUMMARY.md files), donny-tools will error. Use `--force` only if the user confirms:

```bash
RESULT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" phase remove "${target}" --force)
```

The CLI handles:
- Deleting the phase directory
- Renumbering all subsequent directories (in reverse order to avoid conflicts)
- Renaming all files inside renumbered directories (PLAN.md, SUMMARY.md, etc.)
- Updating ROADMAP.md (removing section, renumbering all phase references, updating dependencies)
- Updating STATE.md (decrementing phase count)

Extract from result: `removed`, `directory_deleted`, `renamed_directories`, `renamed_files`, `roadmap_updated`, `state_updated`.
</step>

<step name="commit">
Stage and commit the removal:

```bash
node "$HOME/.claude/donny/bin/donny-tools.cjs" commit "chore: remove phase {target} ({original-phase-name})" --files .planning/
```

The commit message preserves the historical record of what was removed.
</step>

<step name="completion">
Present completion summary:

```
Phase {target} ({original-name}) removed.

Changes:
- Deleted: .planning/phases/{target}-{slug}/
- Renumbered: {N} directories and {M} files
- Updated: ROADMAP.md, STATE.md
- Committed: chore: remove phase {target} ({original-name})

---

## What's Next

Would you like to:
- `/donny-progress` - see updated roadmap status
- Continue with current phase
- Review roadmap

---
```
</step>

</process>

<anti_patterns>

- Don't remove completed phases (have SUMMARY.md files) without --force
- Don't remove current or past phases
- Don't manually renumber - use `donny-tools phase remove` which handles all renumbering
- Don't add "removed phase" notes to STATE.md - git commit is the record
- Don't modify completed phase directories
</anti_patterns>

<success_criteria>
Phase removal is complete when:

- [ ] Target phase validated as future/unstarted
- [ ] If `--dry-run`: removal/renumber plan previewed, workflow exited with no changes or commit
- [ ] `donny-tools phase remove` executed successfully
- [ ] Changes committed with descriptive message
- [ ] User informed of changes
</success_criteria>
