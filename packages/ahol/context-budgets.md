# AHOL Context Budgets

> **Architectural correction**: Tier 1 (orchestrator) and Tier 2 (variant-runner) are Python processes, not Claude Code subagents. They do NOT consume LLM context. The original three-tier context budget schema was based on an earlier assumption that all tiers were Claude Code subagents. The 40K and 30K numbers in the original table no longer apply. Only Tier 3 (per-task `claude --print` invocation) has an LLM context budget, which remains 15K tokens.

Per-tier scope and the Tier 3 LLM context budget for AHOL's tiered runner hierarchy.

## Per-Tier Scope

| Tier | Role | Implementation | LLM context budget |
|------|------|----------------|--------------------|
| Tier 1 Orchestrator | Reads config, spawns variant-runners, runs champion-promotion logic, writes CHAMPION.md, never reads raw task output or patch diffs | Python process (`ahol.py`) | Not applicable; no LLM in the loop |
| Tier 2 Variant-runner | One per variant; spawns task-runners; aggregates via SQLite; writes structured JSON | Python process invoked by the orchestrator | Not applicable; no LLM in the loop |
| Tier 3 Task-runner | One per task; invokes `claude --print` inside an isolated container; writes result to SQLite | Shell wrapper (`invoke-task.sh`) plus `claude --print` | < 15K per task (inner-loop budget, most critical) |

### Tier 1 and Tier 2 budgets (OBSOLETE)

The former 40K (Tier 1) and 30K (Tier 2) per-spawn LLM context budgets are OBSOLETE. Both tiers are now Python processes that execute Python code and shell out to Docker and `claude --print`. They do not load system prompts, tool definitions, or conversation history into a model context window, so there is no LLM context to budget.

Python memory usage is a separate concern tracked via OS-level metrics (resident set size), not token counts. See `GROUP-C-SCOPE.md` for observability scope.

### Tier 3 rationale

Context degradation is non-linear past ~100K tokens (Lost in the Middle, NIAH benchmarks). The 15K budget keeps each `claude --print` invocation well below that threshold with room for input plus output plus tool results.

Tier 3's 15K matters because it runs many times per dev round (nominally 8 variants x 30 tasks = 240 invocations); even 5K of bloat per task compounds to 1.2M wasted tokens.

## Measurement Methodology (Tier 3 only)

SQLite token-accounting logs per Tier 3 invocation. Tiers 1 and 2 are Python processes and do not contribute to token accounting.

### Schema

```
task_token_log (
  invocation_id,
  variant_id,
  task_id,
  started_at,
  ended_at,
  tokens_in,
  tokens_out,
  tokens_total,
  cache_read_input_tokens,
  cache_creation_input_tokens,
  exit_code
)
```

### Post-run Aggregation Queries

* Max tokens per Tier 3 invocation
* p99 per Tier 3 invocation
* Outlier tasks exceeding the 15K budget
* Cache-hit ratio across tasks within a round

### Per-invocation Instrumentation

`invoke-task.sh` captures the `claude --print` response metadata (including `tokens_in`, `tokens_out`, `cache_read_input_tokens`, `cache_creation_input_tokens`) and the Python variant-runner inserts the row into SQLite. Token count is sourced from the Claude Code CLI response metadata emitted by `claude --print`.

## Regression Threshold

If Tier 3 per-task tokens exceed the 15K budget during the V0 / V4 spike, surface the overshoot as a regression before proceeding to the full AHOL build. This gates Group C.

Likely causes of overshoot:

1. Harness-level context bloat in V4 from donnyclaude's 105 skills plus 70 rules.
2. Tier 3 tasks that produce long patch diffs or error logs.
3. Cascading tool-call loops on harder BigCodeBench-Hard tasks.

## Process-Startup Overhead (replaces "Spawn Overhead")

Python processes do not have spawn overhead in the LLM sense. There is no system prompt or tool-definition bootstrap to load into a context window when a Python interpreter starts. The relevant overhead categories are:

1. **Python process startup**: Sub-second per process (import cost of `jsonschema`, `sqlite3`, `opentelemetry-*`). Negligible at spike scale.
2. **Docker container startup per task**: Measurable (typically 1 to 5 seconds per container on a warm daemon) but NOT token-denominated. Tracked via wall-clock, not tokens.
3. **`claude --print` bootstrap per task (Tier 3)**: This IS token-denominated. Claude Code loads its default system prompt plus any configured tools; the 15K budget must accommodate this prefix plus the task payload plus output.

### Tier 3 Invocation Count (unchanged)

| Component | Invocations |
|-----------|-------------|
| Python orchestrator (ahol.py; not token-denominated) | 1 |
| Python variant-runners (not token-denominated) | 8 |
| Tier 3 `claude --print` task invocations (8 x 30) | 240 |
| Total LLM invocations per round | 240 |

### Tier 3 Token Cost Range (aspirational, budget-respecting)

| Estimate | Math | Tokens |
|----------|------|--------|
| Per-task budget | 15K | 15K |
| Per-variant total | 30 x 15K | 450K |
| Per-round total (8 variants) | 240 x 15K | 3.6M |

Actual V0 cost will be measured in the spike; actual V4 cost will be measured in the spike. The 15K-per-task target may be violated; see `REALITY-CHECK.md` and `COST-MODEL.md` for outcome-conditional cost brackets that range from 3M (floor) to 25M (ceiling).

## Constraint: Do Not Collapse Tiers

> "Do not optimize by collapsing tiers. Contamination separation and per-tier attribution are the point. A cheaper non-isolated architecture defeats the experiment."

### Rationale

Collapsing Tier 2 into Tier 1 would force the orchestrator to hold per-variant state in memory across all 8 variants, defeating the isolation goal even though neither tier is LLM-context-bound.

Collapsing Tier 3 into Tier 2 would mean a single Python process issuing 30 `claude --print` calls in-band; the failure-isolation and restart discipline that Tier 3 provides would be lost.

Tier separation is architectural, not token-driven.

## Reconciliation with COST-MODEL.md

Cross-reference `/Users/donmega/Desktop/donnyclaude/.planning/research/ahol/COST-MODEL.md`.

Per-round token cost is now entirely accounted for by Tier 3 `claude --print` invocations. In the aspirational budget-respecting case:

| Scope | Math | Tokens |
|-------|------|--------|
| Per variant (Tier 3) | 30 tasks x 15K | 450K |
| Per round (8 variants, Tier 3) | 240 tasks x 15K | 3.6M |

V0 spike measurement may differ from this aspirational projection. COST-MODEL.md documents the outcome-conditional brackets that reflect real-world measurement (floor 3M, midpoint 17.5M, ceiling 52.5M dev-round totals), because per-task costs in practice exceed the 15K target when harness complexity is high.

Also cross-reference `/Users/donmega/Desktop/donnyclaude/.planning/research/ahol/REALITY-CHECK.md` for the GEPA-hybrid D2 plus D4 build plan that sits on top of this runner architecture, and `packages/ahol/GROUP-C-SCOPE.md` for the Python runner observability scope (OpenTelemetry traces, raw task logs, prompt-cache verification).
