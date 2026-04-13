# Research Summary — Harness Optimization (v1.2)

This file is the synthesis pointer for milestone v1.2 planning. It points to the two foundational artifacts in this directory and summarizes the highest-leverage findings so downstream phases (requirements, roadmap, plan) don't have to re-read the full report.

## Source artifacts

- **[DEEP-RESEARCH.md](./DEEP-RESEARCH.md)** — Claude Web Deep Research report on coding-agent harness state-of-the-art (2024-2026). Surveys 14 harnesses across 5 primitives. Cites measured benchmark results from SWE-bench Pro, Terminal Bench 2.0, BFCL v3, RAG-MCP, SWE-Search, and 20+ academic papers. Ranks 10 incremental + 5 architectural recommendations.
- **[INVENTORY.md](./INVENTORY.md)** — Code-level sweep of donnyclaude's actual file structure produced by the Explore subagent. Confirms exact counts (107 skills, 49 agents, 70 rule files, 8 hook implementations, 60 commands), maps install path through `bin/donnyclaude.js:154-176`, and identifies critical gaps.

---

## Validated theses (top 5 from DEEP-RESEARCH.md)

1. **Harness > model.** The same model swings 4-10 points on SWE-bench Pro across scaffolds. LangChain moved from rank 30 to rank 5 on Terminal Bench 2.0 (52.8% → 66.5%) by changing scaffolding alone — same model. Claude Opus 4.5 scores 45.9% under standardized scaffold but 50.2-55.4% with custom scaffolding.
2. **Tool-count degradation is real and measurable.** Berkeley Function-Calling Leaderboard v3: every model performs worse past 1 tool. RAG-MCP (arXiv: 2505.03275): 3x tool selection accuracy with retrieval over baseline (43.13% vs 13.62%); sharp cliff past ~100 tools even with RAG. donnyclaude ships 107 always-loaded skills.
3. **"Closing loops" — deterministic enforcement via hooks, not probabilistic guidance via rules — is the dominant moat for current-generation models.** Validated independently by Anthropic's hook architecture, LangChain's "boosting for agents" methodology (+13.7 pts), Datadog's verification pipeline, Thoughtworks/Martin Fowler's harness writing, and Blake Crosley's 95-hook practitioner report. Critical insight: "The gap between 'usually' (rule) and 'always' (hook) is where production systems fail."
4. **Subagents are context firewalls, not just parallelism.** Each subagent's fresh context window is the primary defense against long-horizon degradation. TaskWeaver/LORE: accuracy approaches zero past ~120 sequential steps. The cost multiplier (4-7x more tokens) is the price of coherence preservation.
5. **Multi-candidate patch sampling with test-based selection captures most of MCTS's 23% relative improvement (SWE-Search) within Claude Code's existing primitives** — without needing to fork the agent loop. The fully realized version is architectural-tier; a simplified version is incremental.

## Critical donnyclaude gaps (from INVENTORY.md, cross-referenced with DEEP-RESEARCH.md)

- **Zero progressive disclosure**: All 107 skills always-loaded by Claude Code. No skill manifest, no index, no enable/disable registry, no description-based matching, no autoInvoke metadata.
- **No install manifest**: No `~/.claude/.donnyclaude-manifest.json`. No checksums, no version pinning, no uninstall capability, no conflict detection.
- **PreCompact hook is passive/observational** — not active backup. State that gets summarized cannot be restored.
- **SessionStart hook is a fragile 300-character inline shell one-liner** in `hooks.json:132-143`. Not auditable, not testable, not debuggable.
- **No Stop verification hook** — no post-session fact-check or work-against-spec gate before session close.
- **~29 of 49 subagents are open-ended role prompts** without explicit return contracts. Architect, planner, code-reviewer, tdd-guide, refactor-cleaner all return full context to the parent. The GSD subset (~20 agents) already has explicit "return only X" contracts — extend that pattern to domain agents.
- **70 rule files risk over-constraining**. HumanLayer measured: more rules → 14-22% more reasoning tokens spent processing instructions, with worse outcomes. donnyclaude is past this threshold.
- **No trace/telemetry capture**: no request ID propagation, no call graph logging, no audit trail of which skill/agent fired when. Blocks LangChain-style trace-based harness improvement.

## Top 6 incremental priorities (mapped to real files)

Ordered by leverage × cheapness, each evidence-cited:

1. **Skill manifest + progressive disclosure** — `bin/donnyclaude.js:154-176`, `packages/core/settings-template.json`, new `packages/hooks/skill-index.js`. Address the ~100-tool cliff. Evidence: RAG-MCP, BFCL v3, HumanLayer. *Effort: 8-16h. Impact: High — could free 30-50K tokens per session.*
2. **PostToolUse verification hook on Write/Edit** — run linter + test suite after every file change, inject results back as context. Closes the "usually vs always" gap. Evidence: LangChain PreCompletionChecklistMiddleware (major contributor to +13.7 pts), SWE-agent linter-gated edits. *Effort: 4-8h. Impact: High.*
3. **Upgrade PreCompact from passive to active backup** — checkpoint state, file paths, test status to `.claude/backups/` with timestamp before context summarization. SessionStart hook restores most recent. Evidence: claudefa.st pattern, Morph LLM analysis. *Effort: 4-6h. Impact: High.*
4. **Skill audit + prune (107 toward the 75-85 band)**. Remove duplicates of training-data knowledge. Evidence: HumanLayer (14-22% token savings), Multi-Instance Processing degradation. *Effort: 12-20h. Impact: High.*
5. **Reasoning sandwich for long-running subagents** — `effort: xhigh` for plan/verify, `effort: high` for impl. Evidence: LangChain Terminal Bench (xhigh-only timeouts vs sandwich at 66.5%). *Effort: 2-4h. Impact: Medium-high.*
6. **Refactor SessionStart shell one-liner into a real hook script** — replace `hooks.json:132-143` with a proper script that injects `git branch --show-current`, `git diff --stat HEAD`, env discovery, most-recent-backup path. Evidence: LangChain LocalContextMiddleware, revfactory's +60% structured pre-config result. *Effort: 4-8h. Impact: Medium-high.*

Plus four more from the report (recs 7-10):
- 7. Stop verification subagent before declaring task complete
- 8. Migrate high-frequency rules to PreToolUse/PostToolUse hooks
- 9. MCP-based tree-sitter code search server (Aider repo-map equivalent)
- 10. Proactive 60% compaction override

## Deferred architectural-tier candidates (later milestones)

1. **Multi-candidate patch pipeline subagent system** — Agentless-style N-patch generation + test-based selection. Evidence: Agentless (~28% relative headroom), S\*, AIDE. *Effort: 40-80h. Impact: Very high.*
2. **Sandboxed execution wrapper via Docker MCP server** — every competitive SWE-bench harness uses container isolation. *Effort: 40-60h. Impact: High.*
3. **Hierarchical search-indexed skill graph** — two-tier system: lightweight always-on skill index + on-demand full-skill loading. *Effort: 30-50h. Impact: High.*
4. **Trace-based harness improvement loop** — instrument sessions, capture structured traces in SQLite, run automated trace analyzer to surface failure patterns. Implements LangChain "boosting for agents" methodology. *Effort: 60-100h. Impact: Very high (long-term).*
5. **Claude Agent SDK wrapper for SDK-only primitives** — only if specific capabilities truly impossible in the native loop justify the maintenance cost. *Effort: 80-160h. Impact: Risky.*

## v1.2 scope guidance

The cheapest 6-8 incremental priorities form a coherent milestone (~40-70 hours of effort). The architectural tier should be deferred to v1.3+ (each is a milestone of its own). v1.2's success criterion is: **measurable reduction in always-loaded context overhead, deterministic enforcement of the highest-frequency rules, and a working install manifest** — without breaking the existing `npx donnyclaude` install path or changing the architectural envelope.
