# WS-4 HOOK-PATCH: SessionStart inline one-liner to script

Applied by the orchestrator after WS-4 returns. WS-4 does not modify
`packages/hooks/hooks.json` itself (per its hard constraints).

## Target

File: `packages/hooks/hooks.json`
Anchor: the `SessionStart` array (lines 133-143 at the time of this writing).

Note on line numbers: the task brief called out "lines 132-143", but line 132
in the current file is `],` closing the preceding `PreCompact` array. The
actual `SessionStart` block spans lines 133-143 inclusive. The BEFORE quote
below uses the precise 133-143 range so the orchestrator has an unambiguous
anchor; if line numbers have drifted, match by the `"SessionStart": [` opener
and the trailing `]` of that array.

## BEFORE (verbatim, lines 133-143)

```json
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const fs=require('fs');const path=require('path');const {spawnSync}=require('child_process');const raw=fs.readFileSync(0,'utf8');const rel=path.join('scripts','hooks','run-with-flags.js');const hasRunnerRoot=candidate=>{const value=typeof candidate==='string'?candidate.trim():'';return value.length>0&&fs.existsSync(path.join(path.resolve(value),rel));};const root=(()=>{const envRoot=process.env.CLAUDE_PLUGIN_ROOT||'';if(hasRunnerRoot(envRoot))return path.resolve(envRoot.trim());const home=require('os').homedir();const claudeDir=path.join(home,'.claude');if(hasRunnerRoot(claudeDir))return claudeDir;for(const candidate of [path.join(claudeDir,'plugins','everything-claude-code'),path.join(claudeDir,'plugins','everything-claude-code@everything-claude-code'),path.join(claudeDir,'plugins','marketplace','everything-claude-code')]){if(hasRunnerRoot(candidate))return candidate;}try{const cacheBase=path.join(claudeDir,'plugins','cache','everything-claude-code');for(const org of fs.readdirSync(cacheBase,{withFileTypes:true})){if(!org.isDirectory())continue;for(const version of fs.readdirSync(path.join(cacheBase,org.name),{withFileTypes:true})){if(!version.isDirectory())continue;const candidate=path.join(cacheBase,org.name,version.name);if(hasRunnerRoot(candidate))return candidate;}}}catch{}return claudeDir;})();const script=path.join(root,rel);if(fs.existsSync(script)){const result=spawnSync(process.execPath,[script,'session:start','scripts/hooks/session-start.js','minimal,standard,strict'],{input:raw,encoding:'utf8',env:process.env,cwd:process.cwd(),timeout:30000});const stdout=typeof result.stdout==='string'?result.stdout:'';if(stdout)process.stdout.write(stdout);else process.stdout.write(raw);if(result.stderr)process.stderr.write(result.stderr);if(result.error||result.status===null||result.signal){const reason=result.error?result.error.message:(result.signal?'signal '+result.signal:'missing exit status');process.stderr.write('[SessionStart] ERROR: session-start hook failed: '+reason+String.fromCharCode(10));process.exit(1);}process.exit(Number.isInteger(result.status)?result.status:0);}process.stderr.write('[SessionStart] WARNING: could not resolve ECC plugin root; skipping session-start hook'+String.fromCharCode(10));process.stdout.write(raw);\""
          }
        ],
        "description": "Load previous context and detect package manager on new session"
      }
    ],
```

## AFTER (exact replacement block)

```json
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/packages/hooks/gsd-session-start.js\"",
            "timeout": 10
          }
        ],
        "description": "Emit structured session context (git state, package manager, test runner, latest backup) as additionalContext on session start"
      }
    ],
```

## RATIONALE

The inline one-liner stuffed ~2,288 characters of quoted JavaScript into a
single JSON string, mixing plugin-root resolution, stdin forwarding,
spawnSync bookkeeping, and fail-open glue. That layout is fragile (shell
quoting errors silently corrupt the runtime, as the harness-optimizer
flagged elsewhere), hard to test, and emits no structured
`additionalContext` payload, so the model still has to discover branch,
package manager, test runner, and recent-commit facts on turn 1. The
replacement registers a real script at a `CLAUDE_PLUGIN_ROOT`-relative path
(matching every other hook entry in this file), adds the standard
`"timeout": 10` safety margin, and keeps all discovery logic in
`packages/hooks/gsd-session-start.js` where it can be unit-tested. The
script runs the four git queries in parallel via `Promise.allSettled`,
detects the package manager and test runner by lockfile precedence, reads
`.claude/backups/` for the most recent backup directory, and emits a
`hookSpecificOutput.additionalContext` block per LangChain
LocalContextMiddleware and DEEP-RESEARCH rec #6. Fail-open is preserved:
on any error the script exits 0 without blocking session start.
