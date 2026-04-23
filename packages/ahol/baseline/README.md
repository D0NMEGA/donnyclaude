# AHOL Baseline (Tier 2)

**Status: SYNTHESIZED, UNVALIDATED. V0 spike is the validation gate.**

This directory holds the Q1b patch-only template plus the CLI wrapper that invokes Claude Code under it. The template was assembled from Anthropic's January 2025 SWE-bench submission methodology, Claude Code 2.1.117 flag semantics, LangChain harness-engineering posts, and HumanLayer over-steering findings. No single canonical "Claude Code patch-only SWE-bench prompt" exists in public sources as of April 2026; this is a synthesis. Empirical validation is the V0 spike run.

## Files

- `system-prompt.txt`: verbatim system prompt body from the Q1B source. Passed to Claude Code via `--system-prompt-file`. Contains a `{{ISSUE_BODY}}` placeholder that the task-runner substitutes before invocation.
- `invoke.sh`: executable wrapper. Uses env vars `AHOL_BASELINE` (path to this directory) and `TASK_PROMPT` (issue body). Applies the full Q1b flag set: `--print --bare --model opus --max-turns 50 --disallowedTools "Write,Task,WebFetch,WebSearch,TodoWrite" --effort medium`.
- `VALIDATION-CHECKLIST.md`: five pass/fail gates the V0 spike must clear before the full 8-variant sweep runs. Token consumption, tool-call distribution, scope-expansion failures, premature-termination failures, clarification-request failures.

## Source

Full reconstruction trail and flag rationale: `.planning/research/ahol/Q1B-PATCH-ONLY-TEMPLATE-SOURCE.md`.

## How to use

For a single task invocation:

```bash
export AHOL_BASELINE=/Users/donmega/Desktop/donnyclaude/packages/ahol/baseline
export TASK_PROMPT="$(cat path/to/issue-body.txt)"
$AHOL_BASELINE/invoke.sh
```

For AHOL orchestration, the Tier 3 task-runner subagent sets these env vars per task, invokes `invoke.sh`, captures stdout and exit code, writes result to SQLite per the `task-runner-return` contract.

## Promotion to VALIDATED status

Status line at the top of this README flips from "SYNTHESIZED, UNVALIDATED" to "VALIDATED" only after a V0 spike run passes all five gates in `VALIDATION-CHECKLIST.md` on a 30-task AHOL-Proxy-30 run. Until then, treat the template as provisional and the V0 numbers as subject to revision.
