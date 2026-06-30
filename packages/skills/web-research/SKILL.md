---
name: web-research
description: Default method for ANY web search, web research, or "find the best tools/libraries/papers/prior-art" task — including Donny research phases and donny-plan-phase. Use browser-harness (real Chrome, beats blocks/logins) plus the multi-source scrapers in ~/.claude/scrapers. Prefer this over WebSearch/WebFetch for anything beyond a trivial single-fact lookup.
---

# web-research

The default research toolkit on this machine. Two tiers — use both.

## Tier 1 — Structured multi-source scrapers (fast, start here)

`~/.claude/scrapers/` has multi-source scrapers over open APIs plus a one-shot
orchestrator (async fan-out with per-source status + an on-disk HTTP cache). All output
a consistent JSON envelope into `~/.claude/scrapers/out/`; the digest `.md` opens with a
per-source status table (ok / empty / no_key + latency).

**One command for a research topic (use this for Donny research / donny-plan-phase):**
```bash
python3 ~/.claude/scrapers/research_topic.py "llm agents" --limit 12
# -> out/topic_<slug>.json  (merged data)  +  out/topic_<slug>.md  (ranked digest)
```
Reads the digest `.md` for a fast cross-source picture: top HN threads, top GitHub
repos + what's trending, recent dev.to/Medium posts, latest arXiv/OpenAlex papers,
top Hugging Face models, relevant npm packages, Lobsters.

**Single source (research.py):**
```bash
python3 ~/.claude/scrapers/research.py hn            --query "AI agents" --days 30 --limit 30 --comments 5
python3 ~/.claude/scrapers/research.py github        --query "topic:llm stars:>200" --limit 30
python3 ~/.claude/scrapers/research.py github_trending --query weekly --limit 30   # daily|weekly|monthly
python3 ~/.claude/scrapers/research.py devto         --tag ai --days 30 --limit 30
python3 ~/.claude/scrapers/research.py arxiv         --category cs.AI --limit 30
python3 ~/.claude/scrapers/research.py openalex      --query "retrieval augmented generation" --limit 30
python3 ~/.claude/scrapers/research.py huggingface   --query bert --limit 30
python3 ~/.claude/scrapers/research.py npm           --query "llm agent" --limit 30
python3 ~/.claude/scrapers/research.py stackoverflow --tag langchain --limit 30 --answers 3
python3 ~/.claude/scrapers/research.py lobsters      --limit 30
python3 ~/.claude/scrapers/research.py medium        --tag machine-learning --limit 20
```
Open-API sources (no browser): hackernews, github, github_trending, devto, arxiv,
openalex, huggingface, npm, stackoverflow, lobsters, medium.

## Tier 2 — browser-harness (blocked / logged-in / interactive sites)

Some sites 403 all server-side requests (Reddit) or gate content behind login
(X, Medium paywalls, private subs). browser-harness drives the real logged-in
Chrome over CDP, which they serve. Connection: `bh-chrome` (see [[browser-harness-setup]]).

```bash
SUB=LocalLLaMA SORT=top T=year MAX_POSTS=50 TOP_COMMENTS=8 \
  browser-harness < ~/.claude/scrapers/reddit_scrape.py     # posts + top comments -> JSON
MODE=search Q="AI agents" F=top MAX_TWEETS=40 \
  browser-harness < ~/.claude/scrapers/x_scrape.py          # tweets + engagement -> JSON
```
For arbitrary pages, drive browser-harness directly (heredoc `new_tab/js/page_info`).
Domain-skill playbooks live in `~/.claude/browser-harness/agent-workspace/domain-skills/<site>/`
(reddit, x, medium, hackernews, github, arxiv, +90 more) — read the matching dir first.

Login-gated sources need a one-time sign-in in the `~/.browser-harness-profile`
Chrome; the session then persists.

## When to use what

- **"What's the best library / prior art / state of the art for X"** → `research_topic.py "X"`, read the digest.
- **Reddit/X discussion, comments, sentiment** → browser-harness scrapers.
- **A specific page's content** → browser-harness `new_tab` + extract, or `WebFetch` for a trivial read.
- **Library API docs** → Context7 MCP (that's its job), not this.
- Fall back to `WebSearch`/`WebFetch` only for a quick single-fact lookup or when no browser is connected.
