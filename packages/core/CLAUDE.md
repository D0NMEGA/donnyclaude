# Global operating instructions (user level, rewritten 2026-10-07)

These apply to every project on this machine. I run Claude Code in bypass-permissions mode with
effort max on purpose: act decisively, verify before claiming done, and keep the diff small.

## The bar for "done"

- Before you start a change, state in two lines what you will build and what it makes harder later.
- Define one observable acceptance check before implementing (a command, a test, a screenshot, a
  measurement on the real target). Run it before saying the work is complete, and paste the output.
- If a check timed out, was skipped, or was waived, say so. "Not run" is a result; "green" is not a
  synonym for "works".
- Finish every task by listing what you did NOT do and any assumption you made while unattended.
- When something unclear would change the work materially, ask; when running unattended, pick the
  most reasonable reading, proceed, and record the assumption.

## Code

- Simplest solution that solves the problem in front of us; no abstractions for hypothetical needs.
- Do not touch unrelated code. Match the surrounding style; no drive-by reformatting.
- Immutable data by default; explicit error handling at boundaries; never a bare except in Python.
- Comment WHY, not what. ASCII only in prose, no em dashes, sentence-case headings, no emoji.
- Commits: `<type>: <description>`, imperative subject, body says why. Never add a Claude byline.
- If you see a clearly better approach, say so in 2-4 bullets before implementing; proceed unless
  the alternative avoids serious risk or wasted work.

## Standing authority

You may install tools, skills, MCP servers and dependencies without asking when they help the task.
Prefer official sources (Homebrew, npm, PyPI via uv). Mention anything notable you installed.

## Memory: the Obsidian vault at ~/vault

~/vault is my long-term memory (git-versioned). Read `~/vault/00 Hub.md` and the matching
`Projects/<name>.md` before project work. Write durable knowledge as you go, following the vault's
own conventions (one idea per note, 7-field frontmatter on curated notes, link only where you would
traverse the link later). `Sessions/` and `_private/` are an append-only journal; promote durable
facts from there into `Projects/` or `Reference/`. Run `~/.claude/bin/cco-vault-audit` before any
vault cleanup. Auto-memory (MEMORY.md) is for quick recall; the vault is the deep store.

## Research: browser-harness first, in the main thread

For any non-trivial web research, use browser-harness (real Chrome on :9222, logged-in profile)
plus the scrapers in ~/Developer/scrapers; `WebSearch`/`WebFetch` are fallbacks for a single fact.
Rules: drive the `browser-harness` CLI yourself in the main thread, never in a subagent; a
subagent that needs a page uses the `browser_*` MCP tools (browser-harness-mcp, same daemon,
same logged-in Chrome) and closes what it opens; read the matching
`agent-workspace/domain-skills/<site>/` playbook first (BH_DOMAIN_SKILLS=1); prefer `http_get` or
the site API before opening a tab; `page_info()` is a smoke test, extract with `js(...)`;
`close_tab()` every tab you open, in a `finally:`; keep source URLs in findings and grade them
(A primary, B practitioner, C single anecdote). If a call fails with "BU_CDP_URL unreachable", run
`bash ~/.claude/bin/bh-chrome` and retry; do not silently fall back. Full recipe:
`~/vault/Practices/Web-Research-with-Browser-Harness.md`; fast map of a topic:
`uv run --project ~/Developer/scrapers python ~/Developer/scrapers/research_topic.py "<topic>" --limit 12`.

## Library docs

Use the Context7 MCP (resolve-library-id, then query-docs) before coding against any external
library or CLI. For Claude Code itself, fetch the live page:
`curl -sL https://code.claude.com/docs/en/<slug>.md` (index at /docs/llms.txt). The vault mirror
under Reference/Claude-Code-Docs is a June 2026 snapshot and is not authoritative.

## Cross-model check

Before declaring a phase or PR done in a real project, run `cc-crossreview` (Codex gpt-6-astra,
read-only) on the diff and address any P0/P1 it reports or say why not.

Run Codex only through `cc-codex` (`cc-codex review <base>`, `cc-codex exec "<prompt>"`,
`cc-codex run -- <cmd>`) with the Bash tool's `run_in_background: true`. It runs in a tmux window
the user can watch, and the background job ends when Codex does, so the completion notification
is the cue: read the output it prints, act on it, then `cc-codex ack <id>`. Never poll for it,
never run Codex in a bare tmux window, never ask the user whether it has finished. A
UserPromptSubmit hook lists any job that finished while no turn was running.

## Workflow engine

Project phases use the donny-* commands (`/donny-help`). Keep planning artifacts proportional to
the code: a phase needs one spec, tests, code, and one verification that exercises the acceptance
check on the real target; it does not need a document per subagent.

<!-- BEGIN donnyclaude standards (managed) -->
DonnyClaude operating guide, managed block. The coding standards live in ~/.claude/rules/common/
(coding-style, writing-style, git-workflow, testing, performance) and Claude Code loads them on its
own as user rules; language rules under ~/.claude/rules/<lang>/ load only when matching files are
touched. Workflow engine: /donny-help. Update this toolkit with: npx donnyclaude update.
<!-- END donnyclaude standards (managed) -->
