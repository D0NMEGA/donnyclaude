<purpose>
Unified capture surface for ideas, tasks, and todos that surface during a Donny session.
One command, four subcommands:

- `note` (default) - zero-friction quick note. One Write, one confirmation line, no questions.
- `todo` - structured todo captured from arguments or recent conversation, committed to git.
- `todos` - list pending todos, select one, load context, and route to an action.
- `promote` - convert a quick note into a structured todo (committed, like `todo`).

`note` and `todo`/`todos`/`promote` write to different stores but share one todo schema, so a
promoted note and a captured todo are indistinguishable to the `todos` lister.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="route_subcommand">
**Parse $ARGUMENTS to pick the subcommand.** First strip a `--global` flag from anywhere in
$ARGUMENTS (it only affects `note`/`promote` scope; remember whether it was present).

| First token (exact, case-insensitive) | Subcommand |
|----------------------------------------|------------|
| `todo`                                 | **todo** - text after `todo` is the optional description |
| `todos`                                | **todos** - text after `todos` is the optional area filter |
| `promote` followed by exactly one number `N` | **promote** - promote note N |
| `note` with no following text, or empty $ARGUMENTS | **note (list)** - list notes |
| `note <text>`                          | **note (append)** - the text is the note |
| anything else                          | **note (append)** - the whole of $ARGUMENTS is the note |

**Critical:** a subcommand keyword only routes when it is the FIRST token. `/donny-capture todo list`
is a structured todo titled "list"; `/donny-capture note todos are hard` saves the note
"todos are hard". When in doubt, the default is a quick note - never lose the capture.
</step>

<step name="note_storage_format">
**Applies to `note` and `promote`.** Notes are individual markdown files:

- **Project scope**: `.planning/notes/{YYYY-MM-DD}-{slug}.md` - when `.planning/` exists in cwd
- **Global scope**: `$HOME/.claude/notes/{YYYY-MM-DD}-{slug}.md` - when no `.planning/`, or `--global` given

Each note file:

```markdown
---
date: "YYYY-MM-DD HH:mm"
promoted: false
---

{note text verbatim}
```

Do NOT create `.planning/` if it is absent - fall back to global scope silently.
</step>

<step name="note_append">
**Subcommand: note (append) - create a timestamped note file. Runs inline: no Bash, no Task, no questions.**

1. Determine scope (project unless `--global` or no `.planning/`).
2. Ensure the notes directory exists.
3. Generate slug: first ~4 meaningful words of the note text, lowercase, hyphen-separated (drop leading articles/prepositions).
4. Filename `{YYYY-MM-DD}-{slug}.md`; if it exists, append `-2`, `-3`, ...
5. Write the file with the frontmatter and the note text VERBATIM (keep typos - never edit the text).
6. Confirm with exactly one line: `Noted ({scope}): {note text}` where scope is "project" or "global".

Timestamp: local time, `YYYY-MM-DD HH:mm` (24-hour, no seconds).
</step>

<step name="note_list">
**Subcommand: note (list) - show notes from both scopes.**

1. Glob `.planning/notes/*.md` (project) and `$HOME/.claude/notes/*.md` (global) when the directories exist.
2. Read each file's `date` and `promoted` frontmatter.
3. Number ALL active (not-yet-promoted) entries sequentially from 1; still show promoted notes, marked `[promoted]`.
4. Sort by date. If more than 20 active entries, show only the last 10 and note how many were omitted.

```
Notes:

Project (.planning/notes/):
  1. [2026-02-08 14:32] refactor the hook system to support async validators
  2. [promoted] [2026-02-08 14:40] add rate limiting to the API endpoints
  3. [2026-02-08 15:10] consider adding a --dry-run flag to build

Global ($HOME/.claude/notes/):
  4. [2026-02-08 10:00] cross-project idea about shared config

{count} active note(s). Use `/donny-capture promote <N>` to convert one to a todo.
```

If a scope has no directory or no entries, show `(no notes)`.
</step>

<step name="todo_schema">
**The unified todo schema.** Every todo written by `todo` or `promote` uses these exact fields and
sections, so `todos` can list any of them uniformly:

```markdown
---
title: "{short descriptive title}"
status: pending
priority: P2
area: {inferred area or "general"}
source: "{captured from conversation | explicit description | promoted from note}"
created: {timestamp or YYYY-MM-DD}
files:
  - {path:lines}   # optional; omit the key entirely when no files
---

## Goal

{what we want - the idea or outcome, one or two sentences}

## Context

{why this is needed, the underlying problem, technical details, and breadcrumbs - enough for
future Claude to understand weeks later. Fold any approach hints in here as "Approach: ...".}

## Acceptance Criteria

- [ ] {primary criterion}
```

Todo files live in `.planning/todos/pending/{YYYY-MM-DD}-{slug}.md`. `priority` defaults to `P2`.
</step>

<step name="todo_capture">
**Subcommand: todo - capture a structured todo (committed).**

1. Load context:
   ```bash
   INIT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" init todos)
   if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
   ```
   Extract `commit_docs`, `date`, `timestamp`, `todo_count`, `todos`, `pending_dir`. Ensure dirs:
   ```bash
   mkdir -p .planning/todos/pending .planning/todos/completed
   ```
   Note existing `area` values from the `todos` array for consistency.

2. **Extract content.** With a description after `todo`, use it as the title. Without one, analyze the
   recent conversation for the specific problem/idea/task, relevant file paths, and technical details.
   Formulate `title` (3-10 words, action verb), the Goal, the Context (problem + approach hints), and
   `files` (paths with line numbers).

3. **Infer area** from file paths:

   | Path pattern | Area |
   |--------------|------|
   | `src/api/*`, `api/*` | `api` |
   | `src/components/*`, `src/ui/*` | `ui` |
   | `src/auth/*`, `auth/*` | `auth` |
   | `src/db/*`, `database/*` | `database` |
   | `tests/*`, `__tests__/*` | `testing` |
   | `docs/*` | `docs` |
   | `.planning/*` | `planning` |
   | `scripts/*`, `bin/*` | `tooling` |
   | none or unclear | `general` |

   Reuse an existing area from step 1 when it matches.

4. **Check duplicates:**
   ```bash
   grep -l -i "[key words from title]" .planning/todos/pending/*.md 2>/dev/null || true
   ```
   If an overlapping todo exists, read it and use AskUserQuestion (header "Duplicate?"): Skip / Replace / Add anyway.

5. **Write** the todo to `.planning/todos/pending/${date}-${slug}.md` using the unified schema
   (`source: "captured from conversation"` or `"explicit description"`):
   ```bash
   slug=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" generate-slug "$title" --raw)
   ```

6. **Update STATE.md** "### Pending Todos" under "## Accumulated Context" if STATE.md exists (use `todo_count`).

7. **Commit:**
   ```bash
   node "$HOME/.claude/donny/bin/donny-tools.cjs" commit "docs: capture todo - [title]" --files .planning/todos/pending/[filename] .planning/STATE.md
   ```

8. **Confirm:**
   ```
   Todo saved: .planning/todos/pending/[filename]

     [title]
     Area: [area]
     Files: [count] referenced

   Next: keep working, `/donny-capture todo` for another, or `/donny-capture todos` to review.
   ```
</step>

<step name="todos_list_and_act">
**Subcommand: todos - list pending todos, select one, act.**

1. Load context (same `init todos` call as above). Extract `todo_count`, `todos`, `pending_dir`.
   If `todo_count` is 0:
   ```
   No pending todos.

   Capture one with `/donny-capture todo` (structured) or `/donny-capture <text>` (quick note).
   ```
   Exit.

2. **Area filter:** text after `todos` filters by `area` (e.g. `/donny-capture todos api`).

3. **List** the `todos` array (already area-filtered) as a numbered list with title, area, and relative age:
   ```
   Pending Todos:

   1. Add auth token refresh (api, 2d ago)
   2. Fix modal z-index issue (ui, 1d ago)

   Reply with a number to view details, `/donny-capture todos [area]` to filter, or `q` to exit.
   ```

4. **On selection,** read the todo file completely and display its Goal, Context, and Acceptance
   Criteria (unified schema). If `files` has entries, read and briefly summarize each.

5. **Roadmap correlation:** if `.planning/ROADMAP.md` exists, check whether the todo's area or files
   map to an upcoming phase; note any match.

6. **Offer actions** with AskUserQuestion (header "Action"):
   - If it maps to a phase: "Work on it now" / "Add to phase plan" / "Brainstorm approach" / "Put it back".
   - Otherwise: "Work on it now" / "Create a phase" / "Brainstorm approach" / "Put it back".

7. **Execute:**
   - **Work on it now:** `mv ".planning/todos/pending/[filename]" ".planning/todos/completed/"`, update STATE.md count, present the context, begin work.
   - **Add to phase plan:** record the todo reference in the phase's planning notes; keep it pending; return to the list.
   - **Create a phase:** show `/donny-phase-add [description from todo]`; keep it pending (the user runs it in a fresh context).
   - **Brainstorm approach:** keep it pending; discuss the problem and approaches.
   - **Put it back:** return to the list.

8. **Update STATE.md** and **commit** only when a todo actually moved to `completed/`:
   ```bash
   node "$HOME/.claude/donny/bin/donny-tools.cjs" commit "docs: start work on todo - [title]" --files .planning/todos/completed/[filename] .planning/STATE.md
   ```
</step>

<step name="promote">
**Subcommand: promote - convert a quick note into a structured todo (committed).**

1. Run the **note (list)** logic to build the numbered index across both scopes.
2. Resolve entry N. If N is invalid or already promoted, say so and stop.
3. **Requires `.planning/`** - if absent, warn: "Todos require a Donny project. Run `/donny-init` to initialize one." and stop.
4. Load todo context for the date/timestamp and to keep STATE.md accurate:
   ```bash
   INIT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" init todos)
   if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
   mkdir -p .planning/todos/pending .planning/todos/completed
   ```
5. Extract the note text (body after frontmatter). Generate the slug and write
   `.planning/todos/pending/${date}-${slug}.md` using the **unified todo schema**, with
   `source: "promoted from note"`, `area: general` (unless the note text clearly implies one),
   Goal = the note text, Context = "Promoted from a quick note captured on {original note date}.".
   ```bash
   slug=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" generate-slug "$NOTE_TEXT" --raw)
   ```
6. Mark the source note's frontmatter `promoted: true`.
7. **Update STATE.md** "### Pending Todos" count if STATE.md exists.
8. **Commit** (this is the fix for the old promote, which left the todo untracked):
   ```bash
   node "$HOME/.claude/donny/bin/donny-tools.cjs" commit "docs: promote note to todo - [title]" --files .planning/todos/pending/[filename] .planning/notes/[note-file] .planning/STATE.md
   ```
9. Confirm: `Promoted note {N} to todo {filename}: {note text}`
</step>

</process>

<edge_cases>
1. **Subcommand as note text:** only the FIRST token routes - `/donny-capture todo something` is a todo; `/donny-capture remember todos` is a note.
2. **No `.planning/`:** `note` falls back to global `$HOME/.claude/notes/`; `todo`/`todos`/`promote` require a project and say so.
3. **`--global` position:** stripped from anywhere; forces global note scope.
4. **Promote already-promoted:** tell the user "Note {N} is already promoted" and stop.
5. **Large note list:** show the last 10 when more than 20 active.
6. **Duplicate slug on same date:** append `-2`, `-3`, ...
</edge_cases>

<success_criteria>
- [ ] Subcommand routed correctly; unrecognized input defaults to a quick note (capture never lost)
- [ ] note (append): file written with correct frontmatter and verbatim text, one confirmation line, no questions
- [ ] note (list): both scopes shown, sequential numbering, promoted notes marked
- [ ] todo: unified schema written, area inferred, duplicates checked, STATE.md updated, committed
- [ ] todos: pending listed with area/age, selection loads full context, action executed, commit only when moved
- [ ] promote: unified-schema todo created, source note marked promoted, STATE.md updated, AND committed
- [ ] todo and promote produce byte-compatible schemas so `todos` lists them identically
</success_criteria>
