# AHOL Reality Check: GEPA + Anthropic Managed Agents

Generated: 2026-04-23 UTC
Gate: Task 1 of the post-research Group A. Verdicts here gate Group A Tasks 2, 3, 5, 7, 8 and the revised build hours in COST-MODEL.md.
Methodology: 90-minute cap. Fetched primary sources live (GEPA repo README, optimize_anything blog 2026-02-18, gskill Claude Code skill case study 2026-02-18, ICLR 2026 Oral arxiv paper 2507.19457, two independent Managed Agents post-launch fine-print writeups). The full Anthropic Managed Agents docs page was not directly accessible in this session; capability claims are cross-referenced from two secondary sources. Flag for explicit verification before Group D when bespoke-Docker decisions become irreversible.
Hard constraint: no em dashes anywhere in this document.

## Summary of verdicts

| Component | Research summary claim | Verdict | Reason |
|---|---|---|---|
| GEPA optimize_anything as D2 + D4 replacement | Adopt, 35h to 8h build | **HYBRID** | Adopt for skill-only variants (direct Bleve analog); hand-code D2 for non-skill mutations (add_hook, remove_hook, modify_compaction_threshold, etc.) |
| Anthropic Managed Agents as D3 runtime | Adopt, 20h to 4h build | **BUILD (bespoke Docker)** | No Docker-in-session, no scheduled execution, no trace export, 4h session cap, restricted parallel fan-out |

## GEPA investigation

### Facts verified against primary sources

| Claim in research summary | Verified? | Source |
|---|---|---|
| GEPA is an ICLR 2026 Oral | YES | arxiv 2507.19457 cover page reads "Accepted at ICLR 2026 (Oral)"; iclr.cc virtual oral page 10009494 confirms |
| optimize_anything API exists at github.com/gepa-ai/gepa | YES | repo README + blog post 2026-02-18 |
| gskill produces Claude Code skill files, Bleve results Haiku 4.5 79.3% to 100% and Sonnet 4.5 94.8% to 100%, 47% duration reduction | YES | gepa-ai.github.io/gepa/blog/2026/02/18/automatically-learning-skills-for-coding-agents |
| Simple-agent Bleve resolve rate 24% to 93% from gskill-learned skills | YES | same case study page |

### Capabilities confirmed

1. `optimize_anything(seed_candidate, evaluator, dataset?, valset?, objective?, background?, config?) -> GEPAResult`. Accepts either `(seed_candidate + evaluator)` or `(evaluator + objective)`; optional dataset / valset enables multi-task search and generalization modes.
2. Evaluator is an arbitrary Python callable returning `float` OR `(float, dict)` OR `(float, dict_with_Image)`. Structured dict is the "Actionable Side Information" (ASI) that feeds back into the reflective proposer.
3. Pareto-efficient candidate selection within a single optimization run. Reflective text evolution (natural-language diagnosis of traces) instead of scalar policy gradients.
4. gskill is the skill-specific wrapper over optimize_anything that mutates `SKILL.md` files through reflective proposal. Uses GEPA's candidate-selection strategies.
5. Python package `gepa` on PyPI; DSPy integration; `uv` for dependency management.

### Gaps relative to AHOL's design

1. **Mutation taxonomy mismatch.** AHOL's Q2 scoping lists 10 discrete mutation types: add_hook, remove_hook, modify_hook_config, add_rule_to_agent_prompt, remove_rule_from_agent_prompt, add_rule_file, remove_rule_file, modify_skill_frontmatter, modify_compaction_threshold, modify_reasoning_effort. GEPA's case studies all operate on single text artifacts (a whole prompt, a whole code file, a whole agent config). Discrete structural mutations like "add hook X to hooks.json at path Y" are not demonstrated. GEPA could in principle encode these as text-diff edits to hooks.json, but the reflective proposer is not trained or validated on structural-config mutation. This is plausible-but-unvalidated usage.
2. **No tournament mode.** GEPA's Pareto selection operates within one optimization run over one artifact. AHOL's variant matrix (V0 through V7 in the spec) compares independent candidate pools against a shared benchmark. GEPA does not provide this outer-loop orchestration; it remains in scope for AHOL D4.
3. **Docker / sandbox integration undocumented.** ARC-AGI case study mentions "sandboxes the agent code" but implementation is opaque. AHOL needs per-task Docker images (SWE-Bench Pro, AHOL-Proxy-30). GEPA does not ship Docker infrastructure; the evaluator callable is user-provided.
4. **Rollout-count variance is wide.** CloudCast uses 100, blackbox examples use 2,000 to 8,000. gskill's `~300 rollouts` for Mini-SWE-Agent is referenced but learning-time token budget is not reported. AHOL needs predictable per-round cost; this gap is load-bearing for COST-MODEL.md accuracy.
5. **gskill open-source status unclear.** GEPA proper is MIT on GitHub. Whether the gskill pipeline (as distinct from optimize_anything) is published is not confirmed. If closed or gated, the "adopt" leg of the hybrid breaks.

### Verdict: HYBRID

Adopt GEPA for the skill-mutation branch of D2 and for the reflective-proposer component of D4's within-variant scoring. The Bleve case study is a near-exact analog to one AHOL use case (learning Claude Code skills for a specific repo), and the measured results (79.3 to 100, 94.8 to 100, 47% faster) are strong direct evidence.

Do NOT adopt GEPA for:
- Hook-file mutations (add_hook, remove_hook, modify_hook_config)
- Rule-file mutations (add_rule_file, remove_rule_file)
- Harness-config mutations (modify_compaction_threshold, modify_reasoning_effort)
- Outer-loop variant tournament across V0 through V7

Rationale: GEPA's examples are all single-text-artifact optimization; mutating the broader harness requires discrete structural edits that the reflective proposer has not been shown to handle. For those branches, hand-code D2 using a curated mutation schema and apply GEPA only to the skill-specific sub-pool.

### Build-hour impact

| Deliverable | Before (hand-coded) | After hybrid |
|---|---:|---:|
| D2 variant generator (skill mutations) | ~15h | ~3h (gskill wrapper integration) |
| D2 variant generator (non-skill mutations) | ~12h | ~10h (still hand-coded) |
| D4 aggregator + reflective proposer | ~8h | ~5h (GEPA contributes reflective component; AHOL orchestrates tournament) |
| Gating / integration overhead | ~0 | ~3h (handling two mutation pipelines in one round) |
| **Subtotal D2 + D4** | **~35h** | **~21h** |

Savings: ~14h on D2 + D4, not the 27h assumed if GEPA replaced both end-to-end.

## Anthropic Managed Agents investigation

### Facts verified against primary sources

| Claim in research summary | Verified? | Source |
|---|---|---|
| Launched April 8, 2026 | YES | Two independent article datelines |
| Public beta, $0.08 per session-hour active runtime | YES | aiproductivity.ai news summary; idle time free, billed to millisecond |
| Beta header `managed-agents-2026-04-01` | YES | aiproductivity.ai news summary |
| Provides sandboxing, state management, credential handling, tool execution | YES | unite.ai launch coverage |
| Session tracing via Claude Console | YES | Medium fine-print article |

The Anthropic docs page itself was not directly accessible in the 90-minute window (one source returned HTTP 403, the other two sources are secondary summaries). Capabilities below are drawn from the two secondary sources that appeared to be reading the same docs; any discrepancy between them is noted inline.

### Capabilities confirmed

1. Built-in tool orchestration and automatic error recovery. Tool-call errors trigger harness-level retry by spinning up a fresh tool instance.
2. Durable event log. Sessions survive disconnection; state persists across client reconnects.
3. SDK pattern: `sessions.run()` and `tasks.get()` (sample code in Medium article).
4. Max session duration: **4 hours** (per the fine-print article, `"max_duration_hours": 4` appears in sample code).
5. Multi-agent coordination: research preview, requires separate access.

### Gaps relative to AHOL's design

1. **No Docker-in-session.** "Sandboxed environment" language in Anthropic coverage refers to Anthropic-managed isolation of Claude's generated code, not user-supplied containers. AHOL-Proxy-30 (10 HAL SWE-bench Verified Mini + 15 Terminal-Bench-Core v0.1.1 + 5 BigCodeBench-Hard) requires the user to supply per-task Docker images with pinned dependencies. Managed Agents does not document a way to pull or run those images inside a session. Hard blocker for D3 adoption.
2. **No scheduled execution.** Fine-print article explicitly contrasts Managed Agents with Cabinet ("scheduled cron jobs run recurring tasks 24/7") and notes Managed Agents is on-demand only. D5 calendar scheduler still required.
3. **No trace export, only Claude Console inspect.** AHOL's architecture writes task results to a local SQLite for aggregation across 240 task-runners (8 variants x 30 tasks). Inspect-only via Console is incompatible: the orchestrator needs machine-readable return-contract JSON, not a human-readable console UI.
4. **4-hour session cap is tight.** AHOL-Proxy-30 at 30 tasks and projected 2 to 4 hours per run borderline-fits a single session but leaves no headroom. V4 (full donnyclaude harness) under the 2.66M-token smoke's cost profile could exceed 4h easily.
5. **Parallel fan-out restricted.** Multi-agent coordination is research-preview gated. AHOL needs 8 variant-runners in parallel, plus 30 task-runners per variant. The restricted-access model is not suitable for this fan-out pattern.

### Verdict: BUILD (bespoke Docker orchestration)

Reject Managed Agents for D3. Five distinct gaps map to hard blockers; any one of them alone would justify bespoke Docker, and together they rule out hybrid.

Keep bespoke Docker orchestration in scope for D3. Use Claude Code CLI subprocess execution inside per-variant Docker containers with per-task isolation, results written to a shared SQLite database via bind-mount.

### Managed Agents may still matter for one narrow use case

Not AHOL D3, but possibly relevant for D5 or for one-off validation runs after AHOL ships: if a user wants to kick off a benchmark run from Anthropic's cloud rather than their laptop (because Docker setup is local-specific), Managed Agents could wrap the full AHOL-Proxy-30 as one session. This is a post-V1 optimization, not a D3 replacement. Log as a future consideration; do not architect around it now.

### Build-hour impact

| Deliverable | Before (bespoke) | After Managed Agents verdict |
|---|---:|---:|
| D3 parallel runner (Docker orchestration) | ~20h | **~20h unchanged** |
| D3 state management (bind-mount SQLite, container lifecycle) | ~6h | **~6h unchanged** |
| D3 integration with Managed Agents | 0 | 0 (rejected) |

Savings: 0h. The 16-hour savings assumed in the research summary's Finding D are not realizable.

## Revised build hours (update to COST-MODEL.md)

Baseline from COST-MODEL.md: 98 to 163 hours, midpoint 130 hours.

Adjustments:
- D2 + D4 hybrid (GEPA for skills): save ~14h. New range 84 to 149 hours.
- D3 bespoke (Managed Agents rejected): no change.
- D1 benchmark swap (SWE-Bench Pro + SWE-bench-Live + AHOL-Proxy-30 instead of SWE-bench Lite): ~8 to 12h additional for onboarding three datasets instead of one, offset by ~4h saved on simpler per-task cost projections. Net +4 to +8h. New range 88 to 157 hours.
- D5 local ccusage parser (per research Finding F, OAuth usage endpoint blocked April 4, 2026): ~4 to 8h. Within existing D5 estimate.
- D6 manual merge gate: unchanged.

**Revised total: 88 to 157 hours, midpoint ~122 hours.**

This is higher than the research summary's Finding G ("30 to 50 hours"), which assumed both GEPA full-adopt AND Managed Agents full-adopt. My verdict is GEPA hybrid (partial adopt) + Managed Agents rejected. The asymmetry lands closer to the original 130h baseline than to the optimistic 30-50h.

The research summary was correct that AHOL is not a 130h monolith to be built from scratch. It was wrong about the achievable savings without independent capability verification. The 90-minute reality check was necessary.

## Implications for V0 vs V4 spike (Group C, future)

Most of this does not affect the V0 vs V4 spike. That spike runs a minimal CLI wrapper and a 30-task adapter. It does not require D2, D4, D5, or D6. D3 (Docker orchestration) is needed for the spike but only in its simplest form: 2 variants x 30 tasks, sequential or lightly parallelized.

Estimated spike-only infra: 10 to 15 hours to stand up from current state. Much less than full AHOL build. Consistent with the user's Group-C gating policy.

## Recommended next action

Approve this verdict set, then proceed to Group A Tasks 2, 3, 5, 7, 8 as scoped. Task 2 (Q1b verbatim template) currently cannot be satisfied from anything in the repo; the verbatim template lives only in the original Claude web research transcript which is not present in `~/Downloads/ahol-deep-research-20260423-0308.zip` (that zip contains the input package sent TO Claude web, not the output). Options for Task 2:
1. Paste the full research transcript into a file under `.planning/research/ahol/` so Task 2 can extract verbatim.
2. Paste only the Q1b section containing the template.
3. Accept an equivalent reconstructed template sourced directly from Anthropic's January 2025 SWE-bench submission prompt + Claude Code 2.1.117 flag semantics, and run V0 with that reconstruction. Clearly not verbatim; would break the user's "do not modify or paraphrase" constraint unless authorized.

Flag for user decision before Task 2 starts.

## Post-Task-9 Correction (appended 2026-04-23)

Task 9 re-verification fetched Anthropic's Managed Agents primary documentation directly (platform.claude.com/docs/en/managed-agents/overview, .../sessions, .../environments, release-notes overview). Findings correct several blocker claims above that were originally sourced from secondary writeups (unite.ai, aiproductivity.ai, a Medium fine-print article). Full re-verification trail in MANAGED-AGENTS-PRIMARY-VERIFY.md.

### Blocker-by-blocker corrections

- **Blocker 1 (no Docker-in-session)**: CONFIRMED ABSOLUTELY by primary docs. The Environments API accepts only `type: "cloud"` with package manifests (apt, cargo, gem, go, npm, pip) on Anthropic's base containers. No `base_image`, no `Dockerfile`, no OCI registry reference. Benchmark leaderboard comparability requires user-supplied pinned images, which Managed Agents cannot provide. Cite: `platform.claude.com/docs/en/managed-agents/environments`.
- **Blocker 2 (no scheduled execution)**: CONFIRMED. D5 calendar scheduler still required.
- **Blocker 3 (no trace export, Console inspect only)**: MISSTATED. Managed Agents exposes SSE streaming at `/v1/sessions/{id}/stream` plus server-side event history retrieval via the Sessions API. Programmatic machine-readable access is available. Cite: `platform.claude.com/docs/en/managed-agents/sessions`.
- **Blocker 4 (4h session cap)**: UNCONFIRMED. The Medium article's `max_duration_hours: 4` figure does not appear in primary Sessions API docs. No `max_duration_hours` parameter or explicit cap is documented. Moot for D3 decision because blocker 1 alone rejected Managed Agents adoption.
- **Blocker 5 (parallel fan-out research-preview-gated)**: MISSTATED. The research-preview gate applies only to `multiagent` (parent-child orchestration). Independent parallel sessions are rate-limited (60/min create, 600/min read) but otherwise unrestricted. Cite: `platform.claude.com/docs/en/managed-agents/overview`.

### Net

Original BUILD verdict stands on blocker 1 alone. Blockers 3 and 5 remain relevant for non-benchmark donnyclaude use cases where Managed Agents might be viable (long-running user agents with SSE observability, parallel independent sessions for multi-user orchestration). If a future phase considers Managed Agents for something other than benchmark running, re-read MANAGED-AGENTS-PRIMARY-VERIFY.md and treat blockers 3 and 5 as inapplicable.

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
