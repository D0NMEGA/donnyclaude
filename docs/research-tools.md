# Research tools

DonnyClaude ships two research tools the agents reach for during planning and
discovery. Both are optional - every workflow degrades gracefully without them
(it falls back to WebSearch/WebFetch and the Context7 MCP).

## scrapers (bundled)

A multi-source HTTP research digest. `research_topic.py` fans out across Hacker
News, GitHub (and trending), dev.to, arXiv, OpenAlex, Hugging Face, npm,
Lobsters, Stack Overflow, and Medium, then merges and ranks the results into one
markdown digest.

The installer copies it to `~/.claude/scrapers`. It self-bootstraps under `uv`
on first run, so no manual setup is required:

```bash
uv run --project ~/.claude/scrapers python ~/.claude/scrapers/research_topic.py "<topic>" --limit 12
# digest written to ~/.claude/scrapers/out/topic_<slug>.md
```

API keys are all optional - copy `~/.claude/scrapers/.env.example` to `.env` and
fill in only the sources you want (each source degrades to "no_key" when absent).

## browser-harness (optional, install separately)

For login-gated or JS-challenged sources (Reddit, X) the agents can use
[browser-harness](https://github.com/browser-use/browser-harness), a CDP-driven
browser controller. It is **not bundled** - it is a separate project with its own
runtime. Install it from source if you want that capability:

```bash
git clone https://github.com/browser-use/browser-harness ~/.claude/browser-harness
# follow its install.md, then put `browser-harness` on your PATH
```

browser-harness is MIT licensed, Copyright (c) 2026 Browser Use. DonnyClaude's
agents only reference it by name; all credit for the harness belongs to its
authors. The subagent-safe research path (above) never needs it - browser-harness
is a main-thread-only tool by design.
