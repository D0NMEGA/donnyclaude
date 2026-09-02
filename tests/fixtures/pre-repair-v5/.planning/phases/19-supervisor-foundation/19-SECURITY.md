---
status: PASS
agent: donny-security-auditor
phase: 19-supervisor-foundation
threats_closed: 18
threats_open: 0
asvs_level: 1
---

# Security Audit - Phase 19: Supervisor Foundation

## Threat Register

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-19-01 | Path Traversal (TOCTOU) | mitigate | closed | `bridge.py:73-79` `_is_unsafe_session_id` rejects `/`, `\`, `..` before path construction; `test_bridge.py::test_read_bridge_rejects_path_traversal` covers `"../evil"`, `"a/b"`, `"a\\b"` |
| T-19-02 | Malformed Input / DoS | mitigate | closed | `bridge.py:100` `except (OSError, ValueError)` catches unreadable file and bad JSON (json.JSONDecodeError is a ValueError subclass); no bare except; `test_bridge.py::test_read_bridge_malformed_json_returns_none` |
| T-19-03 | Stale Data / Confused Deputy | mitigate | closed | `bridge.py:30` `STALE_SECONDS = 60`; `bridge.py:132-133` `(n - int(bridge["timestamp"])) > STALE_SECONDS`; `test_bridge.py::test_is_stale_old_90s_is_true` and `test_is_stale_fresh_30s_is_false` |
| T-19-04 | Path Traversal (Registry) | mitigate | closed | JS: `register.js:29` `/[/\\]|\.\./` guard exits before any file I/O; Python: `registry.py:40` globs all `*.json` and keys by session_id - never constructs path from untrusted input |
| T-19-05 | Registry TOCTOU / Torn Write | mitigate | closed | `register.js:52-58` writes to `sessionId + ".json." + process.pid + ".tmp"` then `fs.renameSync(tmpPath, finalPath)` - atomic upsert on all POSIX targets |
| T-19-06 | Session Confusion / Spoofing | mitigate | closed | `registry.py:60` reads keyed strictly on session_id; `_LIST_PANES_ARGV` uses `tmux list-panes -aF "#{pane_id}"` - addresses pane by opaque numeric ID, never by session name |
| T-19-07 | Ghost Session / Stale Registry | mitigate | closed | `registry.py:102-106` `reconcile`: `if pane in live_panes and sid in live_sessions: out[sid] = rec` - dual-signal AND, stale entries pruned |
| T-19-08 | Data Exposure (Registry Content) | accept | closed | Accepted risk - see Accepted Risks section |
| T-19-09 | Privilege Escalation (skip-perms flag) | mitigate | closed | `runner.py:34-60` `build_cco_dream_argv` constructs argv list from explicit allowed parameters only; `test_runner.py::test_build_argv_never_carries_skip_permissions` tests smuggling attempts |
| T-19-10 | Shell Injection via shell=True | mitigate | closed | grep `shell=True` in `autopilot/*.py` returned empty (exit:1); all subprocess calls use argv-list; `test_runner.py::test_build_argv_is_a_list_not_a_shell_string` |
| T-19-11 | Acting on Stale Bridge | mitigate | closed | `daemon.py:96-97` staleness gate before any decision: `if bridge.is_stale(bridge_data, now=now): return event("stale_skip", ...)` ; `test_daemon.py::test_eval_stale_bridge_is_stale_skip` |
| T-19-12 | Duplicate Action on Restart | mitigate | closed | `idempotency.py:65` `os.replace(tmp, path)` atomic state write; per-(session_id, event) on-disk key survives KeepAlive restart; `test_runner.py::test_state_survives_simulated_restart` + `test_daemon.py::test_two_polls_one_crossing_fires_once` |
| T-19-13 | Daemon Crash / Poll Error | mitigate | closed | `daemon.py:212` `except Exception as e:  # noqa: BLE001 - daemon must survive one bad poll (T-19-13)` logs and continues; `test_daemon.py::test_main_survives_a_bad_poll` |
| T-19-14 | Env Injection via Sparse launchd Env | mitigate | closed | `com.user.ccautopilot.plist:64-68` `EnvironmentVariables` block sets explicit absolute `PATH=/opt/homebrew/bin:/Users/d0nmega/.claude/bin:/usr/bin:/bin:/usr/sbin:/sbin` and `HOME=/Users/d0nmega`; no reliance on inherited env |
| T-19-15 | Safety Boundary Bypass (cco-dream) | mitigate | closed | grep `dangerously-skip-permissions` in `autopilot/*.py` returned empty (exit:1); `runner.self_test_argv` uses `build_cco_dream_argv` with `dry_run=True`; `test_composition.py` pins cco-dream md5 `d8055242bffbee5cb3ea557340c6a444` byte-unchanged |
| T-19-16 | Shell Injection (zshrc Wrapper) | accept | closed | Accepted risk - see Accepted Risks section |
| T-19-17 | Crash Loop / Resource Exhaustion | mitigate | closed | `com.user.ccautopilot.plist:49-50` `ThrottleInterval=10`; `RunAtLoad=true`; `KeepAlive=true`; `StandardOutPath` + `StandardErrorPath` for crash capture; live KeepAlive relaunch verified ~1s |
| T-19-18 | Premature Action (Observe-Only Anchor) | mitigate | closed | `daemon.py:113` comment `# OBSERVE-ONLY: we LOG the decision; we send NO keystroke and call NO cco-dream.`; grep `send-keys` in `daemon.py` returned empty (exit:1); `test_daemon.py::test_poll_sends_no_keystroke_or_claude_p`; `test_composition.py` cco-dream md5 pin confirms boundary byte-unchanged |

## Unregistered Flags

None. No `## Threat Flags` section was present in any of the four SUMMARY.md files (19-01 through 19-04). No unregistered attack surface was flagged by the executor during implementation.

## Accepted Risks

### T-19-08: Registry Data Exposure

**Category:** Data Exposure (Information Disclosure)
**Decision:** Accept

The registry records per-session metadata: `{session_id, pane, cwd, pid, ts, source}`. No conversation transcript content is captured at any point. The registry directory is `~/.claude/.autopilot/registry.d/` within the operator's own home directory, inaccessible to other local users under default macOS permissions (`~/.claude/` is mode 0700 in practice).

**Residual risk:** `cwd` may reveal project paths to processes that can read `~/.claude/`. This is consistent with other CCO metadata (the statusline bridge, vault, hook logs) that similarly expose working directory. The operator accepts this on the basis that (1) no conversation content is recorded, (2) `cwd` is already visible to all processes the operator runs, and (3) the registry is confined to the operator's own home.

**Re-evaluate if:** The daemon is ever deployed multi-user or the registry dir permissions are relaxed.

---

### T-19-16: Shell Injection via zshrc Wrapper

**Category:** Shell Injection (Input Validation)
**Decision:** Accept

The `ccautopilot-pane` function in `~/.zshrc` accepts an operator-entered tmux pane ID (format `%N` where N is a small integer). Input arrives via the operator's own interactive shell; there is no external input pathway. The pane is addressed by numeric `%N` ID, not by session name, which structurally prevents session name injection. Tmux interprets `%N` as a literal pane target without shell metacharacter expansion.

**Residual risk:** An operator could self-inject by passing a malformed pane ID. Given that the only user is the operator themselves (single-user local tool), this is self-harm by definition and does not constitute a meaningful attack surface.

**Re-evaluate if:** The wrapper is ever exposed to untrusted input (e.g., driven by another process).

---

## Security Audit 2026-06-30

| Metric | Count |
|--------|-------|
| Threats declared | 18 |
| Threats closed | 18 |
| Threats open | 0 |
| Dispositions: mitigate | 16 |
| Dispositions: accept | 2 |
| Dispositions: transfer | 0 |
| Unregistered flags | 0 |
| ASVS Level | 1 |

All 16 `mitigate` threats have concrete file:line evidence. Both `accept` threats are documented above. The observe-only anchor (T-19-18) and the cco-dream safety boundary (T-19-15) were each confirmed by two independent signals: source grep and a dedicated test. Phase 20 (acting mode) MUST re-audit T-19-18 and T-19-15 when the observe-only constraint is lifted.
