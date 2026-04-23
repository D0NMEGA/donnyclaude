# AHOL Cost Model (load-bearing budget decision)

Generated: 2026-04-23 UTC
Revised: 2026-04-23 UTC post-REALITY-CHECK.md
Anchor: re-cost from Step 3 final report after corrections (D1 public benchmarks, D5 calendar scheduler, D6 manual-merge champion), then folded in GEPA hybrid + Managed Agents rejected verdicts from REALITY-CHECK.md, plus the D1 benchmark swap (SWE-bench Lite replaced by SWE-Bench Pro + SWE-bench-Live + AHOL-Proxy-30).
Hard constraint: no em dashes anywhere.

## Per-event token math (revised for D1 benchmark swap)

| Event | Composition | Tokens |
|---|---|---:|
| Variant generation (one variant, non-skill mutation) | Opus 4.7 reads traces + harness diff schema, emits one structured mutation diff | ~0.5M |
| Variant generation (one variant, skill mutation via gskill) | GEPA reflective proposer, ~300 rollouts per Bleve analog | ~1.5M (upper estimate) |
| Per-variant dev evaluation on AHOL-Proxy-30 (30 tasks mixed difficulty) | Target ~10M tokens per variant under Q1b patch-only template per research | ~10M nominal, ~3M floor (V0), ~15M ceiling (V4) |
| Per-variant champion validation on SWE-Bench Pro subset (~200 tasks) + SWE-bench-Live (~50 fresh tasks) | Heterogeneous difficulty, ~100K avg per task | ~25M to 40M |
| Aggregator + CHAMPION.md update | Haiku 4.5 over SQLite task-result rows, decides champion update | ~0.05M |

## Per-cycle cost (revised)

Dev-round cost scales with per-variant evaluation, which is the load-bearing uncertainty until V0 vs V4 spike produces empirical per-task numbers. Three scenarios bracket the plausible range.

| Cycle | Variants | Evaluations | Aggregation | Total |
|---|---:|---:|---:|---:|
| Dev round, optimistic (5 variants, V0-like cost, ~3M each) | 5 × 0.5M = 2.5M | 5 × 3M = 15M | 0.05M | **~17.5M** |
| Dev round, nominal (5 variants, research-summary target, ~10M each) | 5 × 0.5M = 2.5M | 5 × 10M = 50M | 0.05M | **~52.5M** |
| Dev round, pessimistic (5 variants, V4-like cost, ~15M each) | 5 × 0.5M = 2.5M | 5 × 15M = 75M | 0.05M | **~77.5M** |
| Champion validation (1 variant, SWE-Bench Pro 200 + SWE-bench-Live 50) | 0 | ~30M | 0.05M | **~30M** |

The 12x swing between optimistic and pessimistic dev rounds is the single largest open question in AHOL economics. V0 vs V4 spike is the load-bearing input for locking this range.

## Cadence tiers (revised, using nominal 52.5M dev round + 30M champion validation)

| Tier | Pattern | Per-week tokens | Per-month tokens |
|---|---|---:|---:|
| **Tier 1 (full cadence)** | 3 dev rounds + 1 champion validation per week | 3 × 52.5M + 30M = 187.5M | ~750M |
| **Tier 2 (relaxed)** | 1 dev round + 1 champion validation per week | 52.5M + 30M = 82.5M | ~330M |
| **Tier 3 (minimal continuous)** | 1 dev round per week + 1 champion validation per month | 52.5M | ~240M (210M dev + 30M monthly val) |
| **Tier 4 (manual-trigger only)** | No automatic cadence; AHOL infra exists but runs only when invoked | 0 | 0 (build cost only, run on-demand) |

These tiers assume the nominal dev-round cost (~52.5M). If the V0 vs V4 spike shows V0-like costs (~3M per variant), Tier 1 drops to ~65M/week; if V4-like (~15M per variant), Tier 1 balloons to ~262M/week. Re-derive after the spike.

## Decision matrix (revised, nominal scenario)

| Available monthly token budget for AHOL | Recommended tier | Notes |
|---|---|---|
| > 800M | Tier 1 | Full continuous improvement loop; biggest signal-to-noise on champion progression |
| 350M to 800M | Tier 2 | Most of the value; lose 2 dev rounds per week of variant exploration |
| 250M to 350M | Tier 3 | Slow cadence; champion progression measurable monthly, not weekly |
| 50M to 250M | Tier 4 with monthly manual triggers | Treat AHOL as a quarterly checkpoint, not a continuous loop |
| < 50M | Defer AHOL or reduce variant count | Build cost plus any meaningful run cost exceeds budget at this scale; consider reducing dev-round to 2 or 3 variants or waiting on cheaper inference |

The ~6x budget inflation vs. the pre-revision table is driven by AHOL-Proxy-30's 30-task-vs-10-task expansion and the shift from ~30K-per-task (SWE-bench Lite estimate) to ~100K-to-500K-per-task (mixed-difficulty composite). If V0 under Q1b template measures at the optimistic end (~100K per task), these thresholds drop accordingly. Re-derive after the spike.

## Build cost (one-time, revised post-REALITY-CHECK)

Starting point: Step 3 estimate 98 to 163 hours, midpoint 130.

Adjustments applied per REALITY-CHECK.md:
- D2 + D4 GEPA hybrid: save ~14h (GEPA for skill mutations; hand-code D2 for hook, rule, and config mutations; hand-code D4 tournament)
- D3 Managed Agents rejected: no change (~20h bespoke Docker remains)
- D1 benchmark swap (SWE-bench Lite replaced by SWE-Bench Pro + SWE-bench-Live + AHOL-Proxy-30): net +4 to +8h for three-dataset onboarding
- D5 local ccusage-style JSONL parser: within existing D5 estimate (~4 to 8h)
- D6 manual merge gate: unchanged

**Revised total: 88 to 157 wall-clock hours, midpoint ~122 hours.**

The research summary's Finding G (30 to 50 hours) assumed full-adopt on both GEPA and Managed Agents. Only GEPA partially adopts; Managed Agents is rejected. The realizable savings are smaller than the summary projected.

Build-token cost is a separate axis: estimated 7.7M to 17.6M before the reality check, now adjusted to ~8M to 15M (GEPA integration is mostly Python glue, relatively token-light; Docker orchestration is token-heavy for the reflective-loop prototyping in D2).

## Compounding considerations

- **Dev-round noise floor**: per the D1 spike result, if SWE-bench Lite 10-task subset variance is high, dev rounds need either more tasks per evaluation (raising per-variant cost) or fewer variants per round (slower exploration). The spike's noise number is the load-bearing input for tier selection.
- **Cache amortization across runs**: Claude Code prompt cache may amortize part of the per-task cost if the same harness state is hit repeatedly. The 30K-token-per-task estimate is conservative (no cache hit). Real-world cost may be 60 to 80% of nominal in steady state.
- **Champion-validation skip**: a tier-1 cadence with no successful champion update for several weeks could reasonably skip monthly champion validation runs. This is an operational policy, not a cost-model variable.

## Recommended action (revised)

1. Run the V0 vs V4 spike (per revised `spike-results.md`) on AHOL-Proxy-30 to measure actual per-variant token cost under Q1b patch-only template. V0 = baseline Q1b only, V4 = full donnyclaude harness.
2. The spike resolves the 12x dev-round-cost swing. Lock nominal / optimistic / pessimistic scenario based on measured per-task cost.
3. Lock direction from V0 vs V4: cut-mode (V0 wins), grow-mode (V4 wins), or decompose (rough parity).
4. Pick a tier from the revised decision matrix based on the locked per-round cost.
5. If tier choice is Tier 1 or 2, proceed to full AHOL build per the revised 88 to 157-hour estimate with the GEPA-hybrid D2 + D4 plan.
6. If tier choice is Tier 3 or 4, build the same AHOL infrastructure but configure D5 scheduler with longer intervals, and consider reducing dev-round variant count from 5 to 2 or 3.

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
