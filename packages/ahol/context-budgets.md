# AHOL Context Budgets

Per-tier context budgets and subagent-spawn overhead accounting for AHOL's three-tier subagent hierarchy.

## Per-Tier Budgets

| Tier | Role | Max context (tokens) |
|------|------|----------------------|
| Tier 1 Orchestrator | Reads config, spawns variant-runners, runs champion-promotion logic, writes CHAMPION.md, never reads raw task output or patch diffs | < 40K accumulated across full run |
| Tier 2 Variant-runner | One per variant; spawns task-runners; aggregates via SQLite; returns structured JSON | < 30K per variant |
| Tier 3 Task-runner | One per task; executes single benchmark task in isolated container; writes result to SQLite | < 15K per task (inner-loop budget, most critical) |

### Rationale

Context degradation is non-linear past ~100K tokens (Lost in the Middle, NIAH benchmarks). The 40K / 30K / 15K budgets keep each tier well below that threshold with room for input plus output plus tool results.

Tier 3's 15K is the tightest because it runs 240 times per dev round (8 variants x 30 tasks); even 5K of bloat per task compounds to 1.2M wasted tokens.

## Measurement Methodology

SQLite token-accounting logs per tier per spawn.

### Schema

```
spawn_log (
  spawn_id,
  tier,
  parent_spawn_id,
  variant_id,
  task_id,
  started_at,
  ended_at,
  tokens_in,
  tokens_out,
  tokens_total,
  exit_code
)
```

### Post-run Aggregation Queries

* Max tokens per tier
* p99 per tier
* Outlier spawns exceeding budget

### Per-spawn Instrumentation

Each tier emits an opening log entry with `parent_spawn_id` and a closing log entry with `tokens_total` at exit. Token count is sourced from the Claude Code API's response metadata.

## Regression Threshold

If any tier exceeds its budget during V0 / V4 spike, surface the overshoot as a regression before proceeding to the full AHOL build. This gates Group C.

Likely causes of overshoot:

1. Harness-level context bloat in V4 from donnyclaude's 105 skills plus 70 rules.
2. Tier 3 tasks that produce long patch diffs or error logs.
3. Cascading tool-call loops on harder BigCodeBench-Hard tasks.

## Spawn Overhead Accounting

Per-spawn cost: 5K to 15K tokens of system prompt plus tool-definition overhead (Claude Code's default subagent bootstrap, no custom tools adds 5K to 8K; with typical tool surface for AHOL, 10K to 15K).

### Initial 8-variant x 30-task Matrix

| Component | Spawns |
|-----------|--------|
| Orchestrator (already running, no spawn cost) | 1 |
| Variant-runners | 8 |
| Task-runners (8 x 30) | 240 |
| Total | 248 |

### Spawn-overhead Cost Range

| Estimate | Math | Tokens |
|----------|------|--------|
| Floor | 248 x 5K | 1.24M |
| Ceiling | 248 x 15K | 3.72M |
| Midpoint | | 2.48M |

## Constraint: Do Not Collapse Tiers

> "Do not optimize spawn overhead by collapsing tiers. Context isolation is the point. A cheaper non-isolated architecture defeats the experiment."

### Rationale

Collapsing Tier 2 into Tier 1 would accumulate 8 x (variant overhead) in orchestrator context, blowing past the 40K budget and degrading champion-promotion reasoning.

Collapsing Tier 3 into Tier 2 would accumulate 30 x (task overhead) in variant-runner context, degrading per-variant aggregation.

The overhead is the price of coherence.

## Reconciliation with COST-MODEL.md

Cross-reference `/Users/donmega/Desktop/donnyclaude/.planning/research/ahol/COST-MODEL.md`.

Dev-round nominal total: 52.5M tokens (5 variants x 10M eval, plus 2.5M variant-gen, plus 0.05M aggregation).

| Spawn overhead | Tokens | Percent of dev-round total | Assessment |
|----------------|--------|----------------------------|------------|
| Floor | 1.24M | ~2 percent | Essentially free |
| Midpoint | 2.48M | ~5 percent | Acceptable |
| Ceiling | 3.72M | ~7 percent | Still acceptable |

Also cross-reference `/Users/donmega/Desktop/donnyclaude/.planning/research/ahol/REALITY-CHECK.md` for the GEPA-hybrid D2 plus D4 build plan that sits on top of this three-tier architecture.
