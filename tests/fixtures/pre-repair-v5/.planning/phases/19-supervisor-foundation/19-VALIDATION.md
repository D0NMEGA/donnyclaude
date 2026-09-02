---
phase: 19
slug: supervisor-foundation
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-21
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> See `19-RESEARCH.md` → "Validation Architecture" for the automatable-vs-manual split.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (run via `~/.local/bin/pytest` — default `python3` has no pytest) |
| **Config file** | none — Wave 0 adds `~/Developer/cc-autopilot/tests/` + fixtures |
| **Quick run command** | `~/.local/bin/pytest ~/Developer/cc-autopilot/tests/ -q` |
| **Full suite command** | `~/.local/bin/pytest ~/Developer/cc-autopilot/tests/ ~/.claude/bin -q` |
| **Estimated runtime** | ~5–15 seconds (pure-Python, fixture-driven; no network/launchd/tmux) |

---

## Sampling Rate

- **After every task commit:** Run `~/.local/bin/pytest ~/Developer/cc-autopilot/tests/ -q`
- **After every plan wave:** Run the full suite (phase-19 tests + `~/.claude/bin` cco-* regression — proves byte-unchanged composition of `cco-dream` and the bridge writers)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

> Populated by the planner/executor as tasks are created. Every task gets an `<automated>` verify
> command or a Wave 0 dependency; no 3 consecutive tasks without an automated verify.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-1 | 01 | 0/1 | PILOT-04 | T-19-01/02 | fixtures + RED stubs; reader rejects traversal & catches (OSError,ValueError) | unit | `~/.local/bin/pytest ~/Developer/cc-autopilot/tests/ -q --collect-only` | ❌ W0 | ⬜ pending |
| 19-01-2 | 01 | 1 | PILOT-04 | T-19-01/02/03 | used_pct read; >60s ⇒ stale; nudge-marker excluded | unit | `~/.local/bin/pytest ~/Developer/cc-autopilot/tests/test_bridge.py -q` | ❌ W0 | ⬜ pending |
| 19-02-1 | 02 | 1 | PILOT-03 | T-19-04/05/08 | atomic per-session registry write; traversal-guarded; metadata-only | integration | `node` round-trip (register→file→deregister) prints PASS | ✅ | ⬜ pending |
| 19-02-2 | 02 | 1 | PILOT-03 | T-19-04 | hooks registered additively; settings.json still valid | integration | `node -e require(settings.json)` + grep both hooks | ✅ | ⬜ pending |
| 19-02-3 | 02 | 1 | PILOT-03 | T-19-06/07 | resolve by %N (no swap); reconcile drops dead-pane/no-bridge | unit | `~/.local/bin/pytest ~/Developer/cc-autopilot/tests/test_registry.py -q` | ❌ W0 | ⬜ pending |
| 19-03-1 | 03 | 2 | PILOT-05 | T-19-09/10/12 | cco-dream argv (no skip flag); idempotency survives restart | unit | `~/.local/bin/pytest ~/Developer/cc-autopilot/tests/test_runner.py -q` | ✅ | ✅ green (16) |
| 19-03-2 | 03 | 2 | PILOT-02 | T-19-11/13 | observe-only 7-field JSONL; one would_compact/crossing; stale_skip; no send-keys | unit | `~/.local/bin/pytest ~/Developer/cc-autopilot/tests/test_daemon.py -q` | ✅ | ✅ green (12) |
| 19-03-3 | 03 | 2 | PILOT-05 | T-19-09 | cco-dream byte-unchanged (md5 pin); full cco-* regression green | regression | `~/.local/bin/pytest ~/Developer/cc-autopilot/tests/ ~/.claude/bin -q` | ✅ | ✅ green (177) |
| 19-04-1 | 04 | 3 | PILOT-01 | T-19-16 | claude() tmux wrapper + NO_TMUX/$TMUX bypass; preserves --effort max; entry point parses | integration | `tmux -V` + `zsh -ic 'type claude'` + ast.parse(__main__.py) | ✅ | ✅ green |
| 19-04-2 | 04 | 3 | PILOT-02 | T-19-14/17 | plutil-valid plist; RunAtLoad+KeepAlive+ThrottleInterval; absolute sparse-env PATH | integration | `plutil -lint …ccautopilot.plist` | ✅ | ✅ green |
| 19-04-3 | 04 | 3 | PILOT-01/02/03/05 | T-19-15/18 | D-11 $TMUX_PANE live; KeepAlive relaunch; multi-session no-mis-route; cco-dream probe; observe-only would_compact | manual | checkpoint (operator) + `! grep -aR dangerously-skip-permissions ~/Developer/cc-autopilot/` | ✅ | ✅ green (operator-approved; real invariant is package-scoped autopilot/*.py) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `~/Developer/cc-autopilot/tests/` — pytest module(s) for PILOT-01..05 (RED stubs first)
- [ ] `~/Developer/cc-autopilot/tests/conftest.py` — shared fixtures: fake `$TMPDIR` bridge dir (`claude-ctx-*.json`), fake `~/.claude/.autopilot/` registry, injectable "now", stubbed `cco-dream`/`tmux` subprocess (argv capture, never spawns the real binary)
- [ ] Framework install — none needed (`~/.local/bin/pytest` present)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `$TMUX_PANE` populated in the SessionStart hook (D-11) | PILOT-03 | tmux not yet installed; empirical against the live binary | Install tmux → wrap `claude` → SessionStart hook echoes `$TMUX_PANE`; confirm registry records a real `%N` pane id (fallback: hook runs `tmux display-message -p '#{pane_id}'`) |
| `claude` launches inside tmux; `NO_TMUX=1` bare; `$TMUX`-set bypass | PILOT-01 | live shell + terminal behavior | Open shell → `claude` (in tmux, pane addressable) → `NO_TMUX=1 claude` (bare) → inside tmux, `claude` does not nest |
| Daemon starts at login + `KeepAlive` restart | PILOT-02 | launchd lifecycle | `launchctl bootstrap gui/$UID …plist` → confirm running; `kill` the daemon → confirm relaunch; check `Standard{Out,Error}Path` |
| Multi-session no-mis-routing cross-check | PILOT-03 | live concurrent sessions | Open ≥2 concurrent CC sessions → confirm each `session_id` resolves to its own pane in the action log (no swap) |
| Benign no-op `claude -p` routed through live `cco-dream` | PILOT-05 | exercises the real runner seam | Run the startup/`--self-test` probe → confirm the action log shows the probe went through `cco-dream` (denylist + pre-flight), never `--dangerously-skip-permissions` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** plans authored 2026-06-21 (4 plans / 3 waves). Wave 0 scaffolding scheduled FIRST inside plan 01 (conftest + RED stubs for all PILOT modules). No 3 consecutive tasks without an automated verify. Executor sets `nyquist_compliant: true` / `wave_0_complete: true` once the Wave 0 suite is green.
