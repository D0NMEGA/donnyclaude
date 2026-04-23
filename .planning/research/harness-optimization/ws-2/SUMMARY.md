# WS-2 Summary: PostToolUse Verify-Edit Hook

## Files changed

| Path | Type | Lines |
|---|---|---:|
| `packages/hooks/gsd-verify-edit.js` | created | 232 |
| `packages/hooks/gsd-verify-edit.test.js` | created | 189 |

## Hook registration diff (applied by orchestrator)

Added to `packages/hooks/hooks.json` PostToolUse array:

```json
{
  "matcher": "Write|Edit|MultiEdit",
  "hooks": [
    {
      "type": "command",
      "command": "node \"${CLAUDE_PLUGIN_ROOT}/packages/hooks/gsd-verify-edit.js\"",
      "timeout": 10
    }
  ],
  "description": "WS-2 post-edit verify: run project lint or typecheck, inject failures as additionalContext. Fail-open. False-success detection catches Error text on exit 0."
}
```

## Implementation recap

Reads stdin JSON with 3s timeout and 1 MiB cap, bails silently on non-Write/Edit/MultiEdit tools, walks up from the edited file to locate the project root (markers: package.json, pyproject.toml, Cargo.toml, .git), detects linter in priority order: explicit `npm run lint` script, then `npx eslint` when `.eslintrc*` or `eslint.config.*` exists, then `ruff check` for `.py` files in projects with `pyproject.toml` or `.ruff.toml`. Cargo intentionally skipped because `cargo check` exceeds the 10-second outer budget. Detected command runs via `spawnSync` with a 5-second timeout and no shell (no injection surface).

On failure (non-zero exit OR a leading error-token on any of the first 50 lines), emits `{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: "POST-EDIT VERIFY ..."}}` and exits 0. Every error path (JSON parse, spawn crash, timeout, missing file_path) falls through to empty-stdout exit 0. Measured wall-clock at 0.34s for the happy path.

**False-success heuristic** addresses the Step 0 BASELINE.md incident where three Bash tool_results had `is_error: false` because the CLI emitted "Error: ..." on stdout with exit 0. Matches case-insensitive leading tokens {error, fatal, panic, traceback, exception, failed, ✗}, requiring a word-boundary character afterwards (colon, space, tab, comma, or end) to avoid flagging "errored" or "exceptions found" in benign text.

## Tests

14 passed, 0 failed. Coverage: detection heuristic (npm lint precedence, inferred eslint), false-success pattern (Error/FATAL/Traceback/✗ detection, no false flags), fail-open paths (non-JSON stdin, wrong tool, missing file_path), fixture passthrough (realistic Write no-lint, false-success stdout triggers injection).

## Honest delta estimate on Step 0 baseline

Direct delta on baseline metric 4 (6 failures + retries): **0**. The three false-success failures in 9742c210 were Bash calls to `gsd-tools`; this hook fires only on Write|Edit|MultiEdit per task contract. The baseline session issued exactly one Edit, which succeeded. The hook would not have fired on any observed failure in the measured session.

Value appears on future sessions: edits producing invalid TypeScript, ESLint violations, or Python NameErrors get caught on the turn of the edit rather than N turns downstream. LangChain Terminal Bench attributes approximately 13.7 harness-only points to PreCompletionChecklistMiddleware; SWE-agent attributes measurable lift to linter-gated edits. This variant is advisory (injects context, does not block), so expected effect is smaller but non-zero.

## Known risks

1. Slow project lint scripts can hit the 5s spawn timeout and fail-open silently. Consider `GSD_VERIFY_QUICK=1` env flag if observed.
2. False-success heuristic could flag benign outputs opening with "Error count: 0"; word-boundary guard reduces but does not eliminate this. Tighter `^error\s*:` regex is an option.
3. Monorepo subpackages without their own package.json walk up to repo root and run root-level lint (over-scope). Acceptable for this iteration.
4. Synchronous `spawnSync` adds 0.3 to 3 seconds per edit on projects with heavy lint startup. Mitigation: outer 10-second ceiling.
5. ESLint pre-v6 may not accept single-file argv; rare in 2026.

## Em-dash audit

Zero U+2014 and zero U+2013 across all files written.
