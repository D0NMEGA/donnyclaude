# DonnyClaude operating guide

Global operating instructions installed by DonnyClaude. They apply across every
project. Edit this file freely. Re-running the installer only refreshes the
managed standards block at the bottom; it never touches anything you add above
it.

## Standing authority: install what you need

Install tools, skills, MCP servers, and dependencies when they help the task,
preferring official sources (Homebrew, npm, PyPI via uv). After installing
something notable, say so and note any one-time setup it needs (an API key, a
restart). Keep additions global when it makes sense so they persist across
projects.

## Persistent memory

If you keep a notes vault, treat it as durable memory: read it for context
before related work, and write decisions, lessons, and open questions back to it
as you go. This is optional and nothing breaks without it. For the convention
DonnyClaude assumes, see ~/.claude/docs/obsidian-memory.md.

## Web research

For research beyond a single-fact lookup, prefer the bundled scrapers over a
bare web search. They merge Hacker News, GitHub, dev.to, arXiv, OpenAlex,
Hugging Face, npm, Lobsters, and Stack Overflow into one ranked digest:

    uv run --project ~/.claude/scrapers python ~/.claude/scrapers/research_topic.py "<topic>" --limit 12

For login-gated sources, browser-harness is an optional add-on and runs on the
main thread only, never inside a subagent. See ~/.claude/docs/research-tools.md.

## Standards

The block below auto-loads DonnyClaude's coding and writing rules every session,
so generated code and prose follow them instead of leaving the files unused on
disk. Trim the list if you want a lighter context.

<!-- BEGIN donnyclaude standards (managed) -->
@~/.claude/rules/common/coding-style.md
@~/.claude/rules/common/writing-style.md
@~/.claude/rules/common/git-workflow.md
@~/.claude/rules/common/testing.md
@~/.claude/rules/common/security.md
@~/.claude/rules/common/patterns.md
@~/.claude/rules/common/performance.md
@~/.claude/rules/common/development-workflow.md
@~/.claude/rules/common/agents.md
@~/.claude/rules/common/hooks.md
<!-- END donnyclaude standards (managed) -->
