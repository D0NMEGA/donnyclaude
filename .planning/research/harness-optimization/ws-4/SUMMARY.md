# WS-4 Summary: SessionStart Inline One-Liner Refactor

## Files changed

| Path | Type | Lines |
|---|---|---:|
| `packages/hooks/gsd-session-start.js` | created | 198 (CommonJS, fail-open) |
| `packages/hooks/gsd-session-start.test.js` | created | (28 tests) |

## Hook registration diff (applied by orchestrator)

BEFORE (hooks.json lines 133 to 143, 2550 chars total block, ~2288 chars inline command):

```json
"SessionStart": [
  {
    "matcher": "*",
    "hooks": [
      {
        "type": "command",
        "command": "node -e \"<2288 chars of quoted JavaScript resolving CLAUDE_PLUGIN_ROOT, stdin forwarding, spawnSync bookkeeping, fail-open glue>\""
      }
    ],
    "description": "Load previous context and detect package manager on new session"
  }
]
```

AFTER (424 chars total replacement block, 2126 char reduction = 83.4%):

```json
{
  "matcher": "*",
  "hooks": [
    {
      "type": "command",
      "command": "node \"${CLAUDE_PLUGIN_ROOT}/packages/hooks/gsd-session-start.js\"",
      "timeout": 10
    }
  ],
  "description": "WS-4 structured session context: git state, package manager, test runner, latest backup path"
}
```

**Anchor correction**: the task brief said lines 132-143 but line 132 is `],` closing `PreCompact`. Actual SessionStart spans lines 133-143. HOOK-PATCH.md documented both the verbatim quote and a fallback match-by-opener instruction.

## Implementation recap

- Reads hook stdin JSON (cwd, session_id); defaults to `process.cwd()` on malformed input.
- Runs six discovery tasks via `Promise.allSettled` (one failure does not block the rest), each with a 2000 ms sub-timeout:
  - `git branch --show-current`
  - `git diff --stat HEAD`
  - `git log --oneline -5`
  - Package manager detection (lockfile precedence: bun > pnpm > yarn > npm > python-poetry > python-pip > cargo > go > bundler > composer)
  - Test runner detection (`package.json scripts.test` first, then `pytest.ini`, `vitest.config.*`, `jest.config.*`, `Cargo.toml`, `go.mod`)
  - Most-recent-backup lookup (lexicographic sort of `.claude/backups/` subdirs, returns `(none)` if empty)
- Git sub-calls use `execFile` with args array (no shell) to avoid fragile-shell-quoting.
- Aggregates results and emits `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}`; exits 0 on all paths.
- Deliberately excludes last-test-status (WS-3 territory) and skill-index output (WS-1 territory) to avoid duplication.

Empirical timing against the real repo: 0.09 to 0.11s wall-clock. Well under the 8s target.

## Tests

28 passed, 0 failed. Coverage: test-runner detection (vitest config fallback, cargo Cargo.toml, null when none detectable, malformed package.json tolerance), most-recent-backup lookup (missing dir, empty dir, lexicographic max, ignore top-level files), buildContext rendering (all fields populated, clean diff handling, missing-git omission, always-emit backup line, truncation of oversized uncommitted summary).

## Expected delta on Step 0 baseline replay

Baseline had 12,549 first-turn input_tokens. Estimated split: approximately 45 tokens for the actual user prompt, 400 to 700 tokens attributable to environment-discovery probe-and-response on turns 1-2 (Bash-dominated at 28 of 43 calls on baseline, several of which were orientation probes), approximately 11,800 for steady-state per-turn overhead.

**Honest estimate of achievable delta**: 400 to 700 first-turn input_tokens saved, plus 150 to 400 turn-1 output_tokens saved (fewer Bash probes). Also expect shrinkage in the baseline's 6 failures/retries (revfactory +60% quality framing aligns).

Per-turn attribution is estimated, not measured; the JSONL does not break tokens down by cause. Step 2 replay will need to measure directly for rigor.

## Known risks

1. Slow `git log` or `diff` on large worktrees exceeding the 2s sub-timeout (graceful omit).
2. WS-3 coupling requires backup dirs to sort lexicographically (ISO-8601 UTC does).
3. AFTER assumes `${CLAUDE_PLUGIN_ROOT}` is populated (consistent with every other entry in the file).
4. Does not forward to legacy `session-start.js` via `run-with-flags`; orchestrator should verify whether any legacy hook behavior (beyond package manager detection, which WS-4 replaces) needs to remain. The WS-3 backup-restore advisor covers "load previous context."

## Em-dash audit

Zero U+2014 and zero U+2013 across all files written.
