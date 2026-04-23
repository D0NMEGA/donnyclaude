# WS-3 Hook Registration Patch

Two registration blocks to add to `packages/hooks/hooks.json`. WS-3 does not modify hooks.json directly (per constraint); this file documents the exact shape.

The existing hooks.json already has stub entries for `PreCompact` and `SessionStart` (see `packages/hooks/hooks.json` lines 121-143). Both stubs delegate to legacy scripts. To adopt the WS-3 active-backup behavior, replace the existing block's `hooks` array entries as shown below. The schema fields match the repo's existing entries (`type`, `command`, and optional `timeout` in seconds, consistent with `async` entries elsewhere in hooks.json that use `"timeout": 30`).

## 1. PreCompact (active backup)

Replace the existing `PreCompact` block (lines 121-132) with:

```json
"PreCompact": [
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
]
```

Timeout rationale: 15 seconds matches the `insaits-security-wrapper` precedent (hooks.json line 84) for hooks that do non-trivial filesystem work. The stdin-read internal timeout is 10 seconds; the 15-second outer ceiling leaves a 5-second buffer for mkdir/write on slow disks.

## 2. SessionStart (restore advisor)

Replace the existing `SessionStart` block (lines 133-144) with:

```json
"SessionStart": [
  {
    "matcher": "*",
    "hooks": [
      {
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/packages/hooks/gsd-backup-restore.js\"",
        "timeout": 10
      }
    ],
    "description": "WS-3 restore advisor: on session start, inject advisory additionalContext pointing at the most recent .claude/backups/{timestamp}/state.json. Advisory only; no auto-restore."
  }
]
```

Timeout rationale: 10 seconds is sufficient because the work is a single readdir plus one JSON parse. Matches the stdin-read internal timeout in the script.

## Diff summary

Before (current hooks.json, PreCompact):

```
PreCompact -> node .../scripts/hooks/run-with-flags.js "pre:compact" scripts/hooks/pre-compact.js "standard,strict"
```

After (WS-3):

```
PreCompact -> node ${CLAUDE_PLUGIN_ROOT}/packages/hooks/gsd-pre-compact-backup.js
```

Before (current hooks.json, SessionStart):

```
SessionStart -> node -e "<bootstrap inline script that spawns scripts/hooks/session-start.js>"
```

After (WS-3):

```
SessionStart -> node ${CLAUDE_PLUGIN_ROOT}/packages/hooks/gsd-backup-restore.js
```

If the host harness still needs the legacy `session-start.js` side effects (package-manager detection), chain both entries in the `hooks` array; Claude Code runs them in order and concatenates their `additionalContext` outputs. Example with both:

```json
"SessionStart": [
  {
    "matcher": "*",
    "hooks": [
      {
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/packages/hooks/gsd-backup-restore.js\"",
        "timeout": 10
      },
      {
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js\" \"session:start\" \"scripts/hooks/session-start.js\" \"minimal,standard,strict\"",
        "timeout": 30
      }
    ],
    "description": "WS-3 restore advisor plus legacy session-start detection."
  }
]
```
