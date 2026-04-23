# WS-3 Summary: PreCompact Active Backup + SessionStart Restore

## Files changed

| Path | Type | Lines |
|---|---|---:|
| `packages/hooks/gsd-pre-compact-backup.js` | created | 197 |
| `packages/hooks/gsd-backup-restore.js` | created | 122 |
| `packages/hooks/gsd-pre-compact-backup.test.js` | created | (20 tests) |
| `packages/hooks/gsd-backup-restore.test.js` | created | (15 tests) |

## Hook registration diffs (applied by orchestrator)

**PreCompact**: added alongside existing ECC entry (additive, not replacing):

```json
{
  "matcher": "*",
  "hooks": [
    {
      "type": "command",
      "command": "node \"${CLAUDE_PLUGIN_ROOT}/packages/hooks/gsd-pre-compact-backup.js\"",
      "timeout": 15
    }
  ],
  "description": "WS-3 active backup: serialize session state to .claude/backups/{timestamp}/state.json before compaction. Fail-open."
}
```

**SessionStart**: added as one of three new entries (alongside WS-1 skill-index and WS-4 gsd-session-start), replacing the prior 2288-char inline one-liner:

```json
{
  "matcher": "*",
  "hooks": [
    {
      "type": "command",
      "command": "node \"${CLAUDE_PLUGIN_ROOT}/packages/hooks/gsd-backup-restore.js\"",
      "timeout": 10
    }
  ],
  "description": "WS-3 backup-restore advisor"
}
```

## Implementation recap

**gsd-pre-compact-backup.js (PreCompact)**: reads stdin JSON (session_id, cwd, transcript_path), tail-reads last 50 KB of transcript, extracts current_task (capped 500 chars), last 20 tool_use entries, unique file paths from Read/Edit/Write/MultiEdit/NotebookEdit, reads `.last-test-status` or `.test-results.json` from project root, writes `<cwd>/.claude/backups/<ISO-safe>/state.json` with all 8 required fields (backup_version, captured_at_utc, session_id, current_task, open_file_paths, recent_test_status, last_20_tool_calls, working_directory). Timestamps use colon-to-hyphen substitution (e.g. `2026-04-22T19-30-00Z`) so they are filesystem-safe and sort lexicographically = chronologically. Fail-open (exit 0 always; 10s stdin timer).

**gsd-backup-restore.js (SessionStart)**: readdir `.claude/backups/`, filters by ISO-8601 safe regex, picks lex-max, parses state.json, emits compact advisory additionalContext with absolute path. Missing dir, malformed JSON, or no matches all emit empty additionalContext and exit 0. Advisory only; no auto-restore.

## Tests

35 passed, 0 failed. Coverage: tool-call extraction, file-path deduplication, test-status parsing, state serialization, directory creation (including concurrent mkdir race), round-trip backup write then restore read, formatSummary edge cases (null input, truncation, overflow, missing fields).

## Step 2 synthetic test pass/fail criteria

Write:
```bash
rm -rf /tmp/ws3-synth && mkdir -p /tmp/ws3-synth
echo '{"session_id":"syn-123","cwd":"/tmp/ws3-synth","transcript_path":""}' | node packages/hooks/gsd-pre-compact-backup.js
# Pass: exit 0; state.json exists under /tmp/ws3-synth/.claude/backups/<timestamp>/; all 8 keys present.
```

Read:
```bash
echo '{"cwd":"/tmp/ws3-synth","session_id":"new-sess"}' | node packages/hooks/gsd-backup-restore.js
# Pass: exit 0; stdout JSON with hookSpecificOutput.additionalContext referencing the backup path.
```

Unit tests: `node packages/hooks/gsd-pre-compact-backup.test.js` (20 pass), `node packages/hooks/gsd-backup-restore.test.js` (15 pass). WS-3 passes iff all three succeed.

## Known risks

1. Concurrent-session mkdir race handled by `fs.mkdirSync({recursive:true})` idempotency.
2. State.json last-writer-wins is acceptable for advisory use.
3. No retention or TTL sweeping (out of scope; a later workstream can add a sweeper).
4. Transcript schema drift degrades `current_task` or `last_20_tool_calls` to null or empty but does not crash.
5. State.json size bounded (approximately 10 KB typical).

## Em-dash audit

Zero U+2013 and zero U+2014 across all 5 files written.
