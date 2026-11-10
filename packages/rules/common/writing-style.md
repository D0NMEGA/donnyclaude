# Writing style (prose: docs, comments, commits, PRs)

Goal: clear, specific, professional writing that reads like a careful senior engineer wrote it.
Applies to READMEs, code comments, docstrings, commit bodies, PR and issue descriptions, and
design notes.

## Style rules

Punctuation and symbols (keyboard only):
- Use a comma, parentheses, a colon or two sentences where an em dash would go.
- Straight quotes and apostrophes ("x", 'x').
- ASCII only: a hyphen "-" for raw-text list markers, words instead of arrows or check marks.
- No emoji, unless the project already uses them and the task asks for it.

Structure and formatting:
- Sentence case for headings ("Error handling").
- Bold is rare and purposeful. Write list items as plain prose, without a bold label in front.
- Vary sentence length and structure.

Word choice and tone:
- State the exact fact, number or name ("handles 10k req/s on one core").
- Leave out puffery (robust, powerful, seamless, elegant, comprehensive, cutting-edge) and
  editorial hedging ("it is worth noting").
- End when the content ends; no closing paragraph that restates what was just said.
- Plain verbs: use, help, about.
- State uncertainty plainly: "I have not tested the streaming path".

## READMEs

Lead with one concrete sentence on what the project does and for whom, then install commands
that work from a clean checkout and the smallest real usage example. Include only the sections
that apply.

## Code comments and docstrings

- Comment why: intent, invariants, trade-offs and non-obvious reasons ("retry 3x: the upstream
  rate-limits bursts"). Delete comments that restate the line.
- Docstrings state the contract: what it does, params, return, raises, and edge cases callers
  must know.
- Record real caveats honestly: `TODO(name): what and why`.
- Keep comments in sync with the code.

## Commits and pull requests

Format and workflow: see [git-workflow.md](./git-workflow.md).
- Subject: imperative mood, stands alone, under about 50 characters, no trailing period.
- Body: what changed and why, with the context the diff does not show. Wrap at about 72 columns.
- PR description: one-line summary, then what and why, the approach and known shortcomings, a
  test plan, and links to issues. Keep PRs small and reviewable.

Rationale and sources: vault `Practices/Professional-Writing-Style`.
