<purpose>
Add a new phase to the current milestone. By default, appends to the end as the next integer phase (planned work). With `--after N`, inserts a decimal phase (N.1, N.2, ...) immediately after phase N - for urgent work discovered mid-milestone - preserving the logical sequence without renumbering the roadmap.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="parse_arguments">
Parse the command arguments into a mode, a target, and a description:

- `--after N` selects **insert** mode: a decimal phase is added after integer phase `N`. `N` must be an integer. Everything else on the line is the description.
- Without `--after`, the command is in **append** mode: all arguments are the phase description.

Examples:
- `/donny-phase-add Add authentication` -> append; description = "Add authentication"
- `/donny-phase-add --after 72 Fix critical auth bug` -> insert after 72; description = "Fix critical auth bug"

If no description is provided:

```
ERROR: Phase description required
Usage: /donny-phase-add <description>            # append to end of milestone
       /donny-phase-add --after <N> <description>  # insert decimal phase after N
Example: /donny-phase-add Add authentication system
```

Exit.

If `--after` is present but its value is not an integer:

```
ERROR: --after requires an integer phase number
Example: /donny-phase-add --after 72 Fix critical auth bug
```

Exit.
</step>

<step name="init_context">
Load phase operation context (use the target phase in insert mode, `0` in append mode):

```bash
INIT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" init phase-op "${after_phase:-0}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Check `roadmap_exists` from init JSON. If false:

```
ERROR: No roadmap found (.planning/ROADMAP.md)
Run /donny-init to initialize.
```

Exit.
</step>

<step name="apply">
**Delegate to donny-tools - append or insert depending on mode.**

**Append mode (no `--after`):**

```bash
RESULT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" phase add "${description}")
```

The CLI finds the highest existing integer phase, calculates the next number (max + 1), generates a slug, creates `.planning/phases/{NN}-{slug}/`, and inserts the ROADMAP.md entry with Goal, Depends on, and Plans sections. Extract: `phase_number`, `padded`, `name`, `slug`, `directory`.

**Insert mode (`--after N`):**

```bash
RESULT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" phase insert "${after_phase}" "${description}")
```

The CLI verifies the target phase exists in ROADMAP.md, calculates the next decimal (checking existing decimals on disk), generates a slug, creates `.planning/phases/{N.M}-{slug}/`, and inserts the ROADMAP.md entry after the target phase with an `(INSERTED)` marker. Extract: `phase_number`, `after_phase`, `name`, `slug`, `directory`.
</step>

<step name="update_project_state">
Update STATE.md to reflect the new phase. Read `.planning/STATE.md`; under "## Accumulated Context" -> "### Roadmap Evolution" add an entry:

- Append mode: `- Phase {N} added: {description}`
- Insert mode: `- Phase {decimal_phase} inserted after Phase {after_phase}: {description} (URGENT)`

If the "Roadmap Evolution" section doesn't exist, create it.
</step>

<step name="completion">
Present a completion summary for the mode that ran.

**Append:**

```
Phase {N} added to current milestone:
- Description: {description}
- Directory: .planning/phases/{phase-num}-{slug}/
- Status: Not planned yet

Roadmap updated: .planning/ROADMAP.md

---

## ▶ Next Up

**Phase {N}: {description}**

`/clear` then:

`/donny-plan-phase {N}`

---

**Also available:**
- `/donny-phase-add <description>` - add another phase
- Review roadmap

---
```

**Insert:**

```
Phase {decimal_phase} inserted after Phase {after_phase}:
- Description: {description}
- Directory: .planning/phases/{decimal-phase}-{slug}/
- Status: Not planned yet
- Marker: (INSERTED) - indicates urgent work

Roadmap updated: .planning/ROADMAP.md
Project state updated: .planning/STATE.md

---

## ▶ Next Up

**Phase {decimal_phase}: {description}** - urgent insertion

`/clear` then:

`/donny-plan-phase {decimal_phase}`

---

**Also available:**
- Review insertion impact: check if Phase {next_integer} dependencies still make sense
- Review roadmap

---
```
</step>

</process>

<anti_patterns>
- Don't renumber existing phases - append takes the next integer, insert uses a decimal.
- Don't insert before Phase 1 (decimal 0.1 makes no sense).
- Don't modify the target phase's content when inserting.
- Don't create plans yet - that's `/donny-plan-phase`.
- Don't commit changes - the user decides when to commit.
</anti_patterns>

<success_criteria>
- [ ] Mode resolved from `--after` (append vs insert); description parsed; integer target validated for insert
- [ ] Roadmap existence checked
- [ ] `donny-tools phase add` (append) or `donny-tools phase insert` (insert) executed successfully
- [ ] Phase directory created; ROADMAP.md updated (insert includes the `(INSERTED)` marker)
- [ ] STATE.md updated with the roadmap evolution note
- [ ] User informed of next steps (and dependency implications for inserts)
</success_criteria>
