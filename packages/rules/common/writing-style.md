# Writing Style (prose: docs, comments, commits, PRs)

> Extends [git-workflow.md](./git-workflow.md) (commit/PR mechanics) with how to WRITE the prose so it reads like a careful senior engineer, not generated text. Applies to READMEs, code comments, docstrings, commit bodies, PR/issue descriptions, and design notes.

Goal: clear, specific, professional writing. The reader should never be distracted by "this looks AI-generated."

## Universal style rules

Punctuation and symbols (keyboard-only):
- NO em dashes (the long dash) in prose. Use a comma, parentheses, a colon, or two sentences. (Em-dash overuse is the single most-cited AI tell.)
- Straight quotes and apostrophes only ("x", 'x'), never curly/smart quotes.
- ASCII only. No arrows, bullets, check/cross marks, or other glyphs not on a standard US keyboard. Use a hyphen "-" for raw-text list markers.
- NO emoji anywhere (code, comments, commits, READMEs, PRs), unless the project already uses them and the task asks for it.

Structure and formatting:
- Sentence case for headings ("Error handling"), not Title Case ("Error Handling").
- Use bold sparingly. Do NOT default to a "**Bold label:** description" bullet for every list item; that pattern is a strong AI tell. Prefer plain prose or simple lists.
- Vary sentence length and structure. Do not turn every list into a parallel triple ("fast, simple, and reliable").

Word choice and tone:
- Be specific. State the exact fact, number, or name instead of generic importance ("handles 10k req/s on one core", not "delivers powerful performance"). Generic, inflated claims are the core tell.
- Cut puffery: avoid boasts, vibrant, rich, robust, powerful, seamless, elegant, comprehensive, groundbreaking, cutting-edge, revolutionary, game-changing, renowned, "commitment to", "in the heart of", "diverse array".
- Cut editorial hedging: avoid "it is important to note", "it is worth noting", "needless to say".
- Cut filler closers: no "In summary" / "In conclusion" / "Overall" paragraph that restates what was just said.
- Avoid the "not just X, but Y" and "it is not A, it is B" antithesis template.
- Plain verbs: use (not utilize or leverage), help (not facilitate), about (not regarding).
- State uncertainty plainly: "I have not tested the streaming path" beats "this should work seamlessly."

## READMEs

Top-level README.md. Include only the sections that apply; short beats padded:
- Project name plus one concrete sentence on what it does and for whom.
- Why it exists / the problem it solves (one short paragraph, only if not obvious).
- Install: exact commands that work from a clean checkout.
- Usage: the smallest real, runnable example, showing input and output.
- Configuration: the env vars / flags a user actually sets.
- Development / tests: how to run them.
- Contributing and License: brief, or link out.

Lead with what the reader needs first. No marketing intro, no emoji headers, no badge wall unless the badges are meaningful.

## Code comments and docstrings

- Comment WHY, not WHAT. The code says what it does; explain intent, invariants, trade-offs, and non-obvious reasons ("retry 3x: the upstream rate-limits bursts").
- Delete comments that restate the line ("// increment i").
- Docstrings state the contract: what it does, params, return, raises, and edge cases callers must know.
- Record real caveats and TODOs honestly: `TODO(name): what and why`. Flag known shortcuts.
- Keep comments in sync with the code. A wrong comment is worse than none.

## Commits and pull requests

Format and workflow: see [git-workflow.md](./git-workflow.md). Prose style:
- Subject: imperative mood, stands alone, concise ("Fix race in cache eviction", not "Fixed"/"Fixing"). Aim for under ~50 chars; no trailing period.
- Body: explain what changed and WHY. The diff shows what; the message gives the why and the context not visible in code. Wrap at ~72 columns.
- PR description: one-line summary, then what plus why, the approach and any known shortcomings, a test plan, and links to issues. Write it for a reviewer reading it a year from now.
- Keep PRs small and reviewable. Do not pad the description with a restatement of the diff.

## Quick self-check before posting

- [ ] No em/en dashes, smart quotes, emoji, or non-keyboard glyphs
- [ ] Headings sentence case; bold is rare and purposeful
- [ ] Every claim is specific; no puffery or hedging filler
- [ ] Comments explain why; none merely restate code
- [ ] Commit/PR body gives the why, not just the what
