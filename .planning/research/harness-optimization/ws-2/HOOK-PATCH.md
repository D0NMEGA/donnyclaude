# HOOK-PATCH: register gsd-verify-edit

Orchestrator applies this patch to `packages/hooks/hooks.json` after WS-2 returns. WS-2 did not touch that file, per scope constraints.

## Context

The existing `packages/hooks/hooks.json` already registers a `PostToolUse` array with the matcher-then-hooks shape (verified by reading the file). The new entry follows the same shape. Key facts drawn from the file:

- `PostToolUse` exists and contains entries keyed by `matcher` (string) and `hooks` (array).
- Each hook entry has `type: "command"`, `command: "node ..."`, and optional `timeout` (seconds) and `async` (boolean).
- Existing `Edit|Write|MultiEdit` matcher is already used by the `post:quality-gate` entry at lines 169 to 179, confirming matcher syntax.
- Existing hooks are invoked via `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/...`. The gsd-* hooks shipped in `packages/hooks/` are referenced from elsewhere in the plugin wiring; for the patch below, the command uses a `${CLAUDE_PLUGIN_ROOT}`-relative path that matches the directory where `gsd-verify-edit.js` lives (`packages/hooks/`). Adjust this path at apply-time if the orchestrator places the file under a different root.

## Addition (JSON fragment)

Append this object to the `hooks.PostToolUse` array in `packages/hooks/hooks.json`. Place it adjacent to the existing `Edit|Write|MultiEdit` quality-gate entry so related verification hooks stay grouped.

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
  "description": "Run project lint or typecheck after file edits, inject failures as additionalContext. Fail-open (exit 0 on any error). Closes the usually-vs-always gap per DEEP-RESEARCH rec #2."
}
```

## Diff view (conceptual)

```diff
     "PostToolUse": [
       ...existing entries...
       {
         "matcher": "Edit|Write|MultiEdit",
         "hooks": [
           {
             "type": "command",
             "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js\" \"post:quality-gate\" \"scripts/hooks/quality-gate.js\" \"standard,strict\"",
             "async": true,
             "timeout": 30
           }
         ],
         "description": "Run quality gate checks after file edits"
       },
+      {
+        "matcher": "Write|Edit|MultiEdit",
+        "hooks": [
+          {
+            "type": "command",
+            "command": "node \"${CLAUDE_PLUGIN_ROOT}/packages/hooks/gsd-verify-edit.js\"",
+            "timeout": 10
+          }
+        ],
+        "description": "Run project lint or typecheck after file edits, inject failures as additionalContext. Fail-open (exit 0 on any error). Closes the usually-vs-always gap per DEEP-RESEARCH rec #2."
+      },
       ...remaining entries...
     ]
```

## Registration notes

1. Matcher `Write|Edit|MultiEdit` matches exactly the three tools named in the task contract. The existing `post:quality-gate` entry uses the equivalent ordering `Edit|Write|MultiEdit`; both forms are accepted by Claude Code's matcher engine (pipe-delimited alternation).
2. `timeout: 10` is in seconds, matching the convention used elsewhere in the file. The hook itself enforces a 5-second budget on the spawned lint command and a 3-second stdin read timeout; the 10-second outer guard is padding for Node startup plus spawnSync overhead.
3. `async` is intentionally omitted. Verification results must be delivered synchronously so the next turn sees the `additionalContext` injection. The existing quality-gate hook uses `async: true` because it is fire-and-forget formatting; that is not appropriate for verification signaling.
4. No `"env"` block is needed; the hook reads only PATH and the standard process env.
5. The hook is registered under `PostToolUse`, not `PostToolUseFailure`. It must run on every edit, success or failure, because the platform's is_error flag is unreliable for tools that emit error text on stdout with exit 0 (see BASELINE.md).
