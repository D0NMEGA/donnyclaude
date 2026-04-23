# AHOL Cost Model (load-bearing budget decision)

Generated: 2026-04-23 UTC
Anchor: re-cost from Step 3 final report after corrections (D1 public benchmarks, D5 calendar scheduler, D6 manual-merge champion).
Hard constraint: no em dashes anywhere.

## Per-event token math

| Event | Composition | Tokens |
|---|---|---:|
| Variant generation (one variant) | Opus 4.7 reads traces + harness diff schema, emits one structured mutation diff | ~0.5M |
| Per-variant evaluation (dev cadence) | 10 SWE-bench Lite tasks (one per difficulty bucket) at ~30K tokens each | 0.3M |
| Per-variant evaluation (champion validation) | Full 300 SWE-bench Lite tasks + 100 Terminal Bench 2.0 tasks, ~50K tokens average | ~20M |
| Aggregator + CHAMPION.md update | Haiku 4.5, parses scorecard, decides champion update | ~0.05M |

## Per-cycle cost

| Cycle | Variants | Evaluations | Aggregation | Total |
|---|---:|---:|---:|---:|
| Dev round (5 variants × 0.5M gen + 5 × 0.3M eval + 0.05M agg) | 5 × 0.5M = 2.5M | 5 × 0.3M = 1.5M | 0.05M | **~4M** |
| Champion validation (1 variant × 20M eval + 0.05M agg) | 0 | 1 × 20M = 20M | 0.05M | **~20M** |

## Cadence tiers

| Tier | Pattern | Per-week tokens | Per-month tokens |
|---|---|---:|---:|
| **Tier 1 (full cadence)** | 3 dev rounds + 1 champion validation per week | 3 × 4M + 20M = 32M | ~130M |
| **Tier 2 (relaxed)** | 1 dev round + 1 champion validation per week | 4M + 20M = 24M | ~96M |
| **Tier 3 (minimal continuous)** | 1 dev round per week + 1 champion validation per month | 4M | ~36M (16M dev + 20M monthly val) |
| **Tier 4 (manual-trigger only)** | No automatic cadence; AHOL infra exists but runs only when invoked | 0 | 0 (build cost only, run on-demand) |

## Decision matrix

| Available monthly token budget for AHOL | Recommended tier | Notes |
|---|---|---|
| > 150M | Tier 1 | Full continuous improvement loop; biggest signal-to-noise on champion progression |
| 100M to 150M | Tier 2 | Most of the value; lose 2 dev rounds per week of variant exploration |
| 30M to 100M | Tier 3 | Slow cadence; champion progression measurable monthly, not weekly |
| 10M to 30M | Tier 4 with monthly manual triggers | Treat AHOL as a quarterly checkpoint, not a continuous loop |
| < 10M | Defer AHOL | Build cost (~12M) plus any meaningful run cost exceeds budget; reconsider after Claude Max tier upgrade or external compute access |

## Build cost (one-time)

From Step 3 estimate, restated: 98 to 163 wall-clock hours, 7.7M to 17.6M build tokens. Midpoint 130 hours, 12M tokens. This is paid once before any cadence kicks in.

## Compounding considerations

- **Dev-round noise floor**: per the D1 spike result, if SWE-bench Lite 10-task subset variance is high, dev rounds need either more tasks per evaluation (raising per-variant cost) or fewer variants per round (slower exploration). The spike's noise number is the load-bearing input for tier selection.
- **Cache amortization across runs**: Claude Code prompt cache may amortize part of the per-task cost if the same harness state is hit repeatedly. The 30K-token-per-task estimate is conservative (no cache hit). Real-world cost may be 60 to 80% of nominal in steady state.
- **Champion-validation skip**: a tier-1 cadence with no successful champion update for several weeks could reasonably skip monthly champion validation runs. This is an operational policy, not a cost-model variable.

## Recommended action

1. Run the D1 spike to measure actual noise floor on SWE-bench Lite 10-task subset.
2. Use the spike's variance number to confirm whether 10 tasks suffice per dev round or whether the subset needs to grow.
3. Pick a tier from the decision matrix based on the user's monthly Claude Max budget allocated to AHOL.
4. If tier choice is Tier 1 or 2, proceed to full AHOL build with the chosen cadence.
5. If tier choice is Tier 3 or 4, build the same AHOL infrastructure but configure D5 scheduler with longer intervals.

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
