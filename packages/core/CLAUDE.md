# Global operating instructions (user level, rewritten 2026-11-10)

These apply to every project on this machine. Sessions run in bypass-permissions mode: do
reversible work without asking, and check your work before you call it done.

## Done means checked

- Before a change, state in two lines what you will build and what it makes harder later.
- Name one observable acceptance check before implementing: a command, a test, a screenshot or a
  measurement on the real target. Run it and paste its output before you say the work is complete.
- Report a check that timed out, was skipped or was waived as "not run".
- End each task with what you did not do and every assumption you made.
- When a repository's documentation and its existing code disagree, follow the conventions used
  in the existing code, and in your final reply point out each inconsistency you found between
  the documentation and the code. Treat these instruction files and memory notes the same way:
  the code, the live binary and command output win over a note that describes them.

## Standing authority

Do these without asking: install tools, skills, MCP servers and dependencies from official
sources (Homebrew, npm, PyPI via uv); retry a failed or busy command; run tests and builds; write
email drafts; read macOS apps through AppleScript; commit on a phase or fix branch, push that
branch and open a draft PR; commit ~/vault and auto-memory after writing them.

State the exact action and stop before: sending an email, iMessage, Slack or LinkedIn message
(the request must say "send it" for that message); merging or pushing to main; pushing the
vault; publishing a package; deleting anything outside the working tree; spending money.

Do not close with an offer. If a follow-up is reversible and inside the request, do it in the
same turn. When something unclear would change the work materially, ask once; otherwise pick
the most reasonable reading and record the assumption. When a research site needs a login, say
so in one line and continue with other sources.

## Code

- Write the simplest solution for the problem in front of us. Change only what the task needs
  and match the surrounding style.
- Handle errors explicitly at boundaries. Python code has no bare except.
- Comments say why. Prose is ASCII with sentence-case headings, no em dashes and no emoji.
- Commits are `<type>(scope): <summary>` in the imperative, with a body that says why and no
  Claude byline.
- If you see a clearly better approach, say so in 2-4 bullets and proceed, unless the
  alternative avoids serious risk or wasted work.

## Models, effort and sessions

Opus 5.5 at high effort is the default (`summon`). Mythos 5.2 (`claude-ultra`) is for
architecture, council and stuck debugging, and draws on a capped weekly share. Raise effort for
one hard step with `ultrathink` or `/effort xhigh` instead of changing the default. Give
searches and log reading to sonnet subagents with a short brief; keep code edits and judgment on
the session model. Use one fresh session per task or Donny step: switching model mid-session or
resuming a large idle session re-bills the whole context.

## Memory: the Obsidian vault at ~/vault

~/vault is my long-term memory (git-versioned). Read `~/vault/00 Hub.md` and the matching
`Projects/<name>.md` before project work. Write durable knowledge as you go, following the vault's
own conventions (one idea per note, 7-field frontmatter on curated notes, link only where you would
traverse the link later). `Sessions/` and `_private/` are an append-only journal; promote durable
facts from there into `Projects/` or `Reference/`. Run `cco-vault-audit` before any vault cleanup.
Auto-memory (MEMORY.md) is for quick recall; the vault is the deep store.

## Research: browser-harness first, in the main thread

For any non-trivial web research, use browser-harness (real Chrome on :9222, logged-in profile)
plus the scrapers in ~/Developer/scrapers; `WebSearch`/`WebFetch` are fallbacks for a single fact.
Drive the `browser-harness` CLI yourself in the main thread; a subagent that needs a page uses
the `browser_*` MCP tools (browser-harness-mcp, same daemon, same logged-in Chrome) and closes
what it opens. Read the matching `agent-workspace/domain-skills/<site>/` playbook first
(BH_DOMAIN_SKILLS=1); prefer `http_get` or the site API before opening a tab; `page_info()` is a
smoke test, extract with `js(...)`; `close_tab()` every tab you open, in a `finally:`; keep
source URLs in findings and grade them (A primary, B practitioner, C single anecdote). If a call
fails with "BU_CDP_URL unreachable", run `bash ~/.claude/bin/bh-chrome` and retry rather than
falling back silently. Full recipe: `~/vault/Practices/Web-Research-with-Browser-Harness.md`;
fast map of a topic:
`uv run --project ~/Developer/scrapers python ~/Developer/scrapers/research_topic.py "<topic>" --limit 12`.

## Library docs

Use the Context7 MCP (resolve-library-id, then query-docs) before coding against any external
library or CLI. For Claude Code itself, fetch the live page:
`curl -sL https://code.claude.com/docs/en/<slug>.md` (index at /docs/llms.txt). The vault mirror
under Reference/Claude-Code-Docs is a dated snapshot; where it and the live page differ, the live
page wins.

## Cross-model check

Before declaring a phase or PR done in a real project, run `cc-crossreview` (Codex, read-only)
on the diff and address any P0/P1 it reports or say why not.

Run Codex through `cc-codex` (`cc-codex review <base>`, `cc-codex exec "<prompt>"`,
`cc-codex run -- <cmd>`) with the Bash tool's `run_in_background: true`. It runs in a tmux window
the user can watch, and the background job ends when Codex does, so the completion notification
is the cue: read the output it prints, act on it, then `cc-codex ack <id>`. Wait for that
notification instead of polling or asking the user whether it has finished. A UserPromptSubmit
hook lists any job that finished while no turn was running.

## Workflow engine

Project phases use the donny-* commands (`/donny-help`). Keep planning artifacts proportional to
the code: a phase needs one spec, tests, code, and one verification that exercises the acceptance
check on the real target; it does not need a document per subagent. The engine is deployed from
~/Developer/donnyclaude by copying changed files; the installer and `/donny-update` are not used.

<!-- BEGIN donnyclaude standards (managed) -->
DonnyClaude operating guide, managed block. The coding standards live in ~/.claude/rules/common/
(coding-style, writing-style, git-workflow, testing) and Claude Code loads them on its
own as user rules; language rules under ~/.claude/rules/<lang>/ load only when matching files are
touched. Workflow engine: /donny-help.
<!-- END donnyclaude standards (managed) -->

## Artifacts

Before writing a page for the Artifact tool or a print PDF, load the `artifact-brand` skill and
follow it (set 2026-11-04). BNCR artifacts use the website and lab demo system (white page, ink,
the four logo blues, Geist, no eyebrow labels or numbered markers) and carry the approved logo
top-left, inlined from `~/Developer/BNCR/site/assets/bncr-logo.svg`, never redrawn.
