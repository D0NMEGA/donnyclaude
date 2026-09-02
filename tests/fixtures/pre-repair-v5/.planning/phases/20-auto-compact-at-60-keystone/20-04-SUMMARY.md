---
status: PASS
agent: donny-executor (finished inline by orchestrator after user-killed background run)
phase: 20-auto-compact-at-60-keystone
plan: 04
wave: 3
autonomous: false
requirements-completed: []
key-files:
  created: []
  modified:
    - ~/Developer/cc-autopilot/INSTALL.md
---

# Plan 20-04 Summary — INSTALL act-mode doc + D-09 live operator gate (Wave 3)

**Result:** the autonomous documentation task is complete; the live round-trip verification is
recorded honestly as an **OPERATOR RESIDUAL** (unstarted), not fabricated. `autonomous: false`.

## What shipped

Appended a "Phase 20 — Auto-Compact at 60% (act mode)" section to
`~/Developer/cc-autopilot/INSTALL.md` (backed up `INSTALL.md.bak-20-04-1782923991`), covering:

- **What shipped + opt-in default:** the daemon's act path sends `/compact` to a mapped
  `CC_TMUX` `%N` pane at a 60% crossing when act mode is enabled; observe-only stays the shipped
  DEFAULT (no `~/.claude/.autopilot/config.json` present). Proven by the automated suite
  (**72 passed / 0 failed**), with the key act-path tests named.
- **Components table** (action.py / config.py / daemon.py act branch / runner.py byte-unchanged).
- **Enabling act mode** (opt-in, read each poll, no `launchctl` reload): `echo '{"act": true}' >
  ~/.claude/.autopilot/config.json`; disable via `{"act": false}` or `rm`.
- **The shipped mechanism:** dedupe-first (D-12) → fail-closed `❯` idle guard (D-03) → `send-keys
  -l "/compact"` + ~0.4s settle + a SEPARATE `Enter` (D-08); arm-on-send (D-05), fire-once (D-06),
  `<45%` re-arm hysteresis (D-07); the new JSONL decision vocabulary
  (`would_compact`/`compact_sent`/`busy_skip`/`compact_deduped`, 7-field shape unchanged).
- **Reversibility** (every `.bak-20-0N-*`) and **augment-not-replace** (PRIMARY compactor, dedupes
  vs the in-session nudge marker; the compact-nudge/PreCompact/PostCompact KEEP-list untouched).

## The D-09 live gate (OPERATOR RESIDUAL — unstarted)

The act path is unit-proven (72/72), but the mock suite **cannot** prove the live TUI round-trip:
that `send-keys -t %N -l "/compact"` + 0.4s + `Enter` actually SUBMITS `/compact` (not absorbed as
`[Pasted text]`) and the session visibly compacts with `used_pct` dropping in the bridge. INSTALL.md
records this as an **OPERATOR RESIDUAL — unstarted** (mirroring Phase-19 §6), with a 5-row live-check
table and a 7-step operator discharge procedure. No `>=60%` fill was contrived; no DISCHARGED result
is claimed. This is the honest keystone completion shape: automated layer done, live proof is the
operator's to discharge.

## Safety / integrity

- `~/.claude/.autopilot/config.json` was **NOT** created — the shipped default stays observe-only;
  the running LaunchAgent takes no action.
- Full suite re-confirmed **72 passed / 0 failed** after the doc edit (code untouched this wave).
- INSTALL.md only edited file; backed up; the accuracy nit (escape-vs-glyph prose) corrected.

## Requirements

PILOT-06/07 `requirements-completed` left empty: the automated mechanism is complete and
unit-proven across Waves 0–3, but PILOT-07's success-criterion-3 (live round-trip) completes only
when the operator discharges the D-09 gate. Marking it done here would falsely claim a live test
passed. This matches the 20-01/02/03 convention.

## Self-Check: PASS

Documentation accurate + honest; live gate an unfabricated operator residual; daemon observe-only;
suite green. The one open item (the live round-trip) is by design an operator-only verification.
