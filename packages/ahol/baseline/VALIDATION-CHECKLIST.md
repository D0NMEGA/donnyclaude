# V0 Validation Checklist

Source: `.planning/research/ahol/Q1B-PATCH-ONLY-TEMPLATE-SOURCE.md` section "Validation checklist for V0 spike".

Purpose: the V0 spike (baseline harness + Q1b patch-only template) on AHOL-Proxy-30 runs these five measurements as pass/fail gates. Any metric failing its target signals the template needs revision before the full 8-variant sweep begins.

## Pass/fail gates

1. **Per-task token consumption**
   - Target: median under 100K tokens.
   - Pass/fail: 150K tokens as the upper acceptable bound.
   - Consistently higher means template revision needed.

2. **Tool call count distribution**
   - Target: median 5 to 15 tool calls per task.
   - Target: p95 under 30 tool calls.

3. **Scope-expansion failures**
   - Target: zero tasks where Claude Code produced new files.
   - Note: Write is disallowed by the CLI flag, so this should be unreachable; check for evidence of attempted writes in the error log as a correctness check.

4. **Premature termination failures**
   - Target: zero tasks where Claude Code responded with "Patch applied." before making any Edit tool call.

5. **Clarification-request failures**
   - Target: zero tasks where Claude Code's final response is a question back to the user.

## If any gate fails

Revision path, in escalating order (from Q1B source's Reconstruction trail):

1. Tighten the "stop" condition. Replace "Patch applied." with a more restrictive pattern.
2. Reduce max-turns from 50 to 30.
3. Add explicit "do not run Bash commands after your final Edit" language.
4. Adopt the full LangChain PreCompletionChecklistMiddleware pattern (higher complexity, higher implementation cost).

Halt the AHOL build at step 1 of the revision path; do not proceed to the full 8-variant sweep until the revised template passes all five gates.

## Measurement methodology

Spike scoring lives in the task-runner SQLite log (schema defined in `packages/ahol/contracts/task-runner-return.schema.json` and `packages/ahol/context-budgets.md`). Per-run aggregation:

- Gate 1: `SELECT quantile(tokens_used, 0.5), quantile(tokens_used, 0.95) FROM task_runs WHERE variant_id = 'V0'`
- Gate 2: `SELECT quantile(tool_calls, 0.5), quantile(tool_calls, 0.95) FROM task_runs WHERE variant_id = 'V0'` (requires tool_calls column; add to schema if not present when spike runs)
- Gates 3-5: parse `error_summary` and final-message text via regex on the error log written at task-runner exit.

All five gates must pass simultaneously on the same 30-task AHOL-Proxy-30 run. Cross-run averaging is not permitted; the gate is a single-run check.
