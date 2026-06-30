<!-- Donny:project-start source:PROJECT.md -->
## Project

**Multi-Source Research Scraper**

A personal command-line research tool (`~/.claude/scrapers`) that, given a topic, queries many sources and emits one ranked, de-duplicated digest (JSON + markdown). It is the engine behind the `web-research` skill and Donny research phases. This project is a **quality overhaul**: today the tool returns largely irrelevant results because roughly half its sources structurally ignore the query (feed/tag/recency endpoints) and the digest sorts non-comparable raw scores with no relevance signal. The goal is a tool whose ranked top-10 is genuinely on-topic for **both** developer/academic queries **and** consumer/opinion queries.

**Core Value:** Given any topic, the digest's ranked top-10 is actually relevant — the tool answers *the question asked*, not "here is the globally popular content this week."

### Constraints

- **Tech stack**: Python 3.12+, now embracing a real dependency stack under `uv` (httpx, bm25s, datasketch, hishel, a rate-limiter) — a deliberate move away from stdlib-only.
- **Runtime**: Must run as a plain CLI *and* inside Donny subagents → HTTP-only core; browser sources stay optional/out-of-core.
- **Keys/Budget**: Free-tier API keys only (Brave free credit, Reddit OAuth, Semantic Scholar, GitHub token, YouTube quota); graceful degradation when a key is missing; no required paid tier.
- **Compliance**: Honor robots/ToS and documented rate limits; drop disallowed scrapes (Lobsters search, GitHub Trending HTML); no logged-in X scraping in-core.
- **Volatility**: API limits/prices move fast (Brave retired its free tier Feb 2026; Bing shut down Aug 2025) — never hard-code quotas/prices as permanent; verify at integration time.
<!-- Donny:project-end -->

<!-- Donny:stack-start source:research/STACK.md -->
## Technology Stack

## Runtime
- **Python 3.12+**, managed under **`uv`** (venv + lockfile). Deliberate move off stdlib-only.
- Must run as a plain CLI **and** inside Donny/HTTP subagents → **HTTP-only core**; browser sources stay out-of-core.
## Core dependencies (adopt)
| Lib | Role | Why this one | Confidence |
|-----|------|--------------|------------|
| `httpx` | Async HTTP client | First-class async, HTTP/2, connection pooling; pairs with hishel/aiometer | High |
| `bm25s` (`xhluca/bm25s`) | Lexical relevance | Numpy/Numba BM25, far faster than `rank_bm25`; the missing relevance signal | High |
| `datasketch` (`ekzhu/datasketch`) | Near-dup detection | MinHash/LSH for fuzzy title dedup across sources | High |
| `hishel` (`karpetrosyan/hishel`) | HTTP caching | RFC 9111 caching for httpx; file/SQLite backends, per-source TTL | High |
| `aiometer` *or* `PyrateLimiter` | Rate limiting | Per-host throttle (arXiv 1/3s, GitHub 30/min) while fanning out | High |
## API sources (keys all free-tier; graceful no-key fallback)
| Source | Endpoint / path | Key | Notes |
|--------|-----------------|-----|-------|
| Brave Search | Web Search API | Free credit (~1k/mo) | **New always-on web source.** Independent 30B index |
| Reddit | official OAuth Data API `/search`, `/r/{sub}/search` | OAuth app (free, non-commercial) | 100 QPM; HTTP → **subagent-safe** |
| Hacker News | Algolia `/search` (relevance) | none | already correct; add `points>N` floor |
| GitHub | `/search/repositories` | token (30/min) | always send token; drop forced `sort` for relevance |
| Stack Exchange | `/2.3/search/advanced?q=` | key (10k/day) | switch off tag-only; honor `backoff` |
| arXiv | `export.arxiv.org/api/query` | none | `ti:/abs:/cat:` + `sortBy=relevance` |
| OpenAlex | `/works?search=` | `mailto` (polite pool) | drop citation sort; `per_page=200` |
| Semantic Scholar | `/graph/v1/paper/search` | key (1 req/s) | trim stopwords; restrict fields |
| YouTube | Data API v3 search | key (10k units/day) | consumer tier |
| News | NewsAPI or GDELT | free tier | consumer/time-sensitive tier |
| npm | `/-/v1/search` | none | software-topic tier only |
| Hugging Face | `/api/models?search=` | none | ML-topic tier only |
## Drop / do NOT use
- **GitHub Trending HTML scrape** — no official API, fragile, topic-blind. Use `/search/repositories` by recent stars.
- **Lobsters `hottest.json`** — topic-blind; official search is HTML + ROBOTS_DISALLOWED. Web-search-wrap via `site:lobste.rs` or drop.
- **dev.to tag-stuffing** / **Medium feed-as-search** — no free-text search APIs. Web-search-wrap (`site:dev.to`, `site:medium.com`) or drop.
- **Bing Web Search API** — retired Aug 2025 (HTTP 410). Do not build on it.
- **Logged-in X scraping** — ToS/legal/ban risk. Out of core.
- **LLM-agent "deep research" frameworks** (GPT-Researcher-class) — wrong shape: heavy, LLM-orchestrated, not subagent-safe.
## Optional (opt-in flag, deferred)
- Cross-encoder rerank (`bge-reranker-v2-m3` / Jina v2 / Cohere) over top ~50 merged candidates — precision boost when it matters, not the default.
<!-- Donny:stack-end -->

<!-- Donny:conventions-start source:CONVENTIONS.md -->
## Conventions

### Running the tool (always under `uv`)

This project uses a `uv`-managed dependency stack (httpx, hishel, bm25s, datasketch,
model2vec, aiolimiter, …). **Always run it inside the uv env** — a bare system `python3`
(e.g. invoked from another project's CWD) lacks these and dies with
`ModuleNotFoundError: No module named 'hishel'`.

```bash
# Topic research (the main entry point):
uv run python research_topic.py "<topic>" --limit 12          # from this repo
uv run --project ~/.claude/scrapers python ~/.claude/scrapers/research_topic.py "<topic>"  # from anywhere
# Tests / eval / guards:
uv run pytest -q
uv run python tools/check_runner_imports.py
```

- `python` is **not** on PATH on this machine — use `uv run python` / `uv run pytest`, never bare `python`/`python3`.
- **Safety net:** `research_topic.py` self-bootstraps — a bare `python3 .../research_topic.py …`
  auto-re-execs under `uv run --project <dir>` when a core dep is missing, so the documented
  command works from any CWD. The explicit `uv run` form is still preferred (skips the re-exec).
  This guards the recurring slip-up of invoking the scraper with a bare interpreter.
<!-- Donny:conventions-end -->

<!-- Donny:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- Donny:architecture-end -->

<!-- Donny:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- Donny:skills-end -->

<!-- Donny:workflow-start source:Donny defaults -->
## Donny Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a Donny command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/donny-quick` for small fixes, doc updates, and ad-hoc tasks
- `/donny-debug` for investigation and bug fixing
- `/donny-execute-phase` for planned phase work

Do not make direct repo edits outside a Donny workflow unless the user explicitly asks to bypass it.
<!-- Donny:workflow-end -->



<!-- Donny:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/donny-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- Donny:profile-end -->
