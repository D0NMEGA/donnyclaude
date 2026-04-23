# AHOL V0 vs V4 Spike Plan (revised post-deep-research)

Revised: 2026-04-23 UTC

This document replaces the prior SWE-bench-Lite-10-task spike plan. The prior plan was obsolete: it relied on a Docker-blocked harness, used a contamination-risk benchmark, lacked outcome-conditional cost brackets, and had no patch-only template validation. Recent deep-research outputs (listed below) supersede it with a V0-vs-V4-on-AHOL-Proxy-30 spike.

## Upstream artifacts referenced

- `.planning/research/ahol/REALITY-CHECK.md` (GEPA hybrid and Managed Agents rejection verdicts)
- `.planning/research/ahol/COST-MODEL.md` (outcome-conditional budget matrix with 17.5M, 52.5M, 77.5M dev-round brackets)
- `.planning/research/ahol/Q1B-PATCH-ONLY-TEMPLATE-SOURCE.md` (patch-only system prompt synthesis and 5-criterion validation checklist)
- `.planning/research/ahol/DOCKER-API-CHOICE.md` (raw Bash with name-prefix allowlist verdict)
- `packages/ahol/CONTAMINATION-ANALYSIS.md` (three-tier separation; V0 through V7 variant matrix)
- `packages/ahol/baseline/VALIDATION-CHECKLIST.md` (the 5 pass/fail gates from the Q1B source)
- `packages/ahol/benchmarks/README.md` (AHOL-Proxy-30 composition)
- `.planning/research/ahol/thermal-baseline.md` (2018 MBP thermal capture and go/no-go thresholds)

## Spike scope (replaces prior 10-task Lite subset)

Two variants:

- **V0**: Tier-2 baseline (from `packages/ahol/baseline/`) with the Q1b patch-only template.
- **V4**: Tier-2 baseline plus full donnyclaude (105 skills, 49 agents, 8 hooks, 70 rules, MCP servers).

Benchmark: **AHOL-Proxy-30** (30 tasks):
- 15 Terminal-Bench-Core v0.1.1
- 10 HAL SWE-bench Verified Mini
- 5 BigCodeBench-Hard

One run per variant in this phase. No triple-run sigma measurement; direction first, variance in later phase.

## Budget and cost bracket

From COST-MODEL.md outcome-conditional matrix:

- **V0 expected cost** (per-task target ~100K on 30 tasks): ~3M floor to ~15M ceiling depending on V0 validation outcome.
- **V4 expected cost** (per-task target ~500K on 30 tasks): ~15M nominal to ~25M ceiling.
- **Combined budget cap**: 25M tokens (user-authorized). If projected or observed cost exceeds this cap, pause and resurface before continuing.
- **Wall clock**: 4 to 8 hours total for both variants. Serial (not parallel) at spike scale, to simplify thermal observability and trace inspection.

## V0 validation gate (5-criterion checklist)

Reproduced from `packages/ahol/baseline/VALIDATION-CHECKLIST.md`:

- **Gate 1**: per-task token consumption median under 100K, p95 under 150K.
- **Gate 2**: tool-call count distribution median 5 to 15, p95 under 30.
- **Gate 3**: zero scope-expansion failures (no new files produced).
- **Gate 4**: zero premature-termination failures (no "Patch applied." before an Edit tool call).
- **Gate 5**: zero clarification-request failures (no question back to user in final message).

**Gate enforcement policy**: V0 must pass all five gates on at least one 30-task run before V4 runs or before the full 8-variant sweep proceeds. If any gate fails, halt and revise the template per the Q1B source's revision path (tighten stop condition, reduce max-turns, add post-Edit Bash prohibition, adopt LangChain PreCompletionChecklistMiddleware as last resort).

## Container orchestration (adopts DOCKER-API-CHOICE.md verdict)

- Raw Bash (no Docker MCP adoption in this phase).
- Container naming convention: `ahol-variant-V0-<task_id>`, `ahol-variant-V4-<task_id>`.
- Cleanup discipline: `docker rm -f ahol-variant-V*-*` at spike end; never use unprefixed `docker rm`.
- Allowlist patterns for Claude Code Bash tool:
  - `Bash(docker run:*)`
  - `Bash(docker logs:*)`
  - `Bash(docker inspect:*)`
  - `Bash(docker exec:*)`
  - `Bash(docker rm -f ahol-variant-*:*)`
- Full allowlist reference in `DOCKER-API-CHOICE.md`.

## Thermal protocol

Re-capture protocol during the spike per `thermal-baseline.md`:

1. **Pre-run**: capture baseline before the variant starts.
2. **Mid-run**: capture at task 15 (midpoint of the 30-task run).
3. **Post-run**: immediately after completion, before cooldown.
4. **Cooldown**: 5 min after the post-run capture.

- Log each capture as an appendix to this file once runs complete.
- Exclude throttled runs from analysis: RED threshold is CPU die temp over 92 C OR prochots greater than 0 during the run.
- Macs Fan Control must be running with custom curve active before the spike starts (PID check in pre-flight).

## Decision tree after spike

| V0 vs V4 outcome | AHOL mode | Next action |
|---|---|---|
| V0 significantly outperforms V4 | cut-mode | Identify which donnyclaude components to remove; run V1 through V7 sweep to isolate contributors of the regression |
| V4 significantly outperforms V0 | grow-mode | Identify which additions to stack; run V1 through V7 sweep to isolate best-performing subsets |
| Rough parity (within noise) | decompose | Run full 8-variant V0 through V7 matrix for per-component attribution |

"Significantly" is defined as: at least 2 percentage points AND at least 2x the per-task cost ratio (direction lock requires both signal and cost context).

## Budget guardrail

- If projected spike cost exceeds 25M tokens: pause, surface, re-authorize before continuing.
- If V0 per-task cost consistently exceeds 150K tokens (Gate 1 fail): halt and revise template before V4.

## Pre-flight checklist

Before running the spike:

- [ ] Docker Desktop running, resources tuned per `docker-config-required.md` (4 CPUs, 11.68 GiB memory)
- [ ] Macs Fan Control running (PID check); custom CPU Proximity curve active
- [ ] `packages/ahol/baseline/bootstrap.sh` produces a clean `.ahol/baseline/` (validated per Task 4)
- [ ] Three benchmark datasets downloaded and images pulled (per `packages/ahol/benchmarks/README.md`)
- [ ] SQLite task-run log schema created (per `packages/ahol/context-budgets.md` and `packages/ahol/contracts/`)
- [ ] 25M-token budget explicitly authorized

## Status table (PENDING runs)

| Metric | V0 result | V4 result | Gate pass/fail | Notes |
|---|---|---|---|---|
| Tasks completed / 30 | PENDING | PENDING | - | - |
| Tasks passed | PENDING | PENDING | - | - |
| Median per-task tokens | PENDING | PENDING | Gate 1 | <100K target, <150K limit |
| p95 per-task tokens | PENDING | PENDING | Gate 1 | <150K limit |
| Median tool calls | PENDING | PENDING | Gate 2 | 5 to 15 target |
| p95 tool calls | PENDING | PENDING | Gate 2 | <30 limit |
| Scope-expansion failures | PENDING | PENDING | Gate 3 | zero required |
| Premature-termination failures | PENDING | PENDING | Gate 4 | zero required |
| Clarification-request failures | PENDING | PENDING | Gate 5 | zero required |
| Total tokens | PENDING | PENDING | - | - |
| Wall-clock (hours) | PENDING | PENDING | - | - |
| Peak CPU die temp | PENDING | PENDING | - | <92 C required |
| Prochots during run | PENDING | PENDING | - | zero required |

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
