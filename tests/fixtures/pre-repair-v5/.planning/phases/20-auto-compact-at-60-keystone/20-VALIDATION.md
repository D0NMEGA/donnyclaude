---
phase: 20
slug: auto-compact-at-60-keystone
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-30
---

# Phase 20 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from
> 20-RESEARCH.md "## Validation Architecture" (PILOT-06/07). cc-autopilot's stdlib pytest
> suite is the harness (Phase 19 shipped 180/180 green); Phase 20 adds `tests/test_action.py`
> and extends `tests/test_daemon.py`. Task IDs below are placeholders until the planner assigns them.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 8.x — run via `~/.local/bin/pytest` (default `python3` lacks pytest; lint-loop `unresolved-import: pytest` is a known false positive) |
| **Config file** | `~/Developer/cc-autopilot/pyproject.toml` (`pythonpath=["."]`, `testpaths=["tests"]`) |
| **Quick run command** | `~/.local/bin/pytest ~/Developer/cc-autopilot/tests/test_action.py -x` |
| **Full suite command** | `~/.local/bin/pytest ~/Developer/cc-autopilot/tests -q` |
| **Estimated runtime** | ~3 seconds (stdlib-only, injected `run`/clock stubs; no real tmux/subprocess) |

---

## Sampling Rate

- **After every task commit:** Run `~/.local/bin/pytest ~/Developer/cc-autopilot/tests/test_action.py -x`
- **After every plan wave:** Run `~/.local/bin/pytest ~/Developer/cc-autopilot/tests -q`
- **Before `/donny-verify-work`:** Full suite must be green
- **Max feedback latency:** ~3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 20-01-* | 01 | 0 | PILOT-06 | - | RED stubs for the act path (argv, idle-guard, dedupe) | unit | `pytest tests/test_action.py -x` | ❌ W0 | ⬜ pending |
| 20-0x-* | 0x | 1 | PILOT-06 | T-20-01 | `send-keys -l "/compact"` + delay + separate Enter to resolved `%N`; no other pane, no focus arg (argv-list, injected run) | unit | `pytest tests/test_action.py::test_compact_send_keys_argv -x` | ❌ W0 | ⬜ pending |
| 20-0x-* | 0x | 1 | PILOT-06 | T-20-02 | busy pane (no `❯` / spinner) → `busy_skip`, NO send | unit | `pytest tests/test_action.py::test_busy_pane_skips_send -x` | ❌ W0 | ⬜ pending |
| 20-0x-* | 0x | 1 | PILOT-06 | T-20-03 | acts only on a mapped `CC_TMUX` pane; unmapped → no send | unit | `pytest tests/test_daemon.py::test_act_only_on_mapped_pane -x` | ➕ extend | ⬜ pending |
| 20-0x-* | 0x | 1 | PILOT-06 | - | set `…-nudged.json` marker for the crossing suppresses the external send | unit | `pytest tests/test_action.py::test_marker_dedupe -x` | ❌ W0 | ⬜ pending |
| 20-0x-* | 0x | 1 | PILOT-07 | T-20-04 | arm-on-send fire-once: one crossing sends once across polls; a `busy_skip` does NOT consume the fire | unit | `pytest tests/test_daemon.py::test_fire_once_arm_on_send -x` | ➕ extend | ⬜ pending |
| 20-0x-* | 0x | 1 | PILOT-07 | - | re-arm only after `used_pct < ~45%`, not `<60%` | unit | `pytest tests/test_daemon.py::test_rearm_hysteresis_band -x` | ➕ extend | ⬜ pending |
| 20-0x-* | 0x | 1 | PILOT-07 | T-20-05 | observe-only default: no act toggle → logs `would_compact`/`compact_disabled`, NO send-keys | unit | `pytest tests/test_daemon.py::test_observe_only_no_send -x` | ➕ extend | ⬜ pending |
| MANUAL | - | - | PILOT-07 | - | live `send-keys` → `/compact` compacts + `used_pct` drops | manual | operator gate (D-09), recorded in INSTALL.md | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Threat refs are provisional — the planner's `<threat_model>` assigns the canonical T-20-NN ids.*

---

## Wave 0 Requirements

- [ ] `tests/test_action.py` - NEW: send-keys argv shape, idle-guard `busy_skip`, marker dedupe (PILOT-06)
- [ ] extend `tests/test_daemon.py` - act-path integration: arm-on-send fire-once, `<~45%` hysteresis re-arm, observe-only default (PILOT-06/07)

*Framework already present (pytest + `tests/conftest.py` shipped Phase 19) - no install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live `send-keys` → `/compact` round-trip actually compacts a session and `used_pct` drops in the bridge | PILOT-07 | A real ≥60% 1M token-fill is too slow/costly to automate; the live TUI is not scriptable in unit tests | Contrive/observe a ≥60% `CC_TMUX` session with the act toggle on; confirm exactly one `/compact` lands, the session compacts, `used_pct` drops afterward, no other pane touched; record DISCHARGED/RESIDUAL in INSTALL.md (Phase-19 Task-3 pattern) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 3s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
