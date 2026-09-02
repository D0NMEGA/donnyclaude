# Phase 20: Auto-Compact at 60% (Keystone) - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn the Phase-19 observe-only `would_compact` decision into a **real action**: when a
session crosses 60% context, cc-autopilot sends `/compact` to *that exact session's* tmux
pane via `send-keys` — no window focus stolen, no other pane touched — firing **at most once
per fill cycle**, and the `send-keys` → `/compact` round-trip is **proven on the live binary**
(the targeted session actually compacts; `used_pct` drops in the bridge afterward).

This is the **Core-Value keystone** (F2): the deterministic fix for 60%-context `/compact` on
1M Opus that in-process config provably cannot deliver (nothing in-process can force `/compact`;
the env override misfires against the buggy 1M-window denominator #43989/#53801/#34332; native
armed auto-compact is broken #63627; the in-session nudge chain only shows an operator message).

**Scope anchor:** ONLY the 60% `/compact` trigger. NO usage-aware resume (Phase 21), NO CC
Continue retirement (Phase 21 / PILOT-10), NO `claude -p` driving. Requirements: **PILOT-06, PILOT-07.**

</domain>

<decisions>
## Implementation Decisions

### The send-keys action (PILOT-06)
- **D-01:** A NEW stdlib-only module `~/Developer/cc-autopilot/autopilot/action.py` builds + runs
  the `tmux send-keys` argv to the owning `%N` pane, **mirroring `registry.tmux_live_panes`'s
  injected-`run` subprocess pattern** (argv LIST, never a shell string; the injected `run`
  lets unit tests capture argv without spawning real tmux). Targets the pane from
  `registry.resolve_pane(session_id)` — the unambiguous `%N` pane_id, never a session name.
- **D-02:** `/compact` is a **keystroke into a live interactive session, NOT a driven `claude -p`**,
  so it does **NOT** route through `cco-dream` / `runner.py`. The `cco-dream` seam stays byte-unchanged
  and reserved for Phase 21 resume + the deferred headless phase-runner (D-16 from Phase 19 holds:
  any `claude -p` still goes through the boundary; a `send-keys` keystroke is not one).
- **D-08 (VERIFY-GATED):** The **exact `send-keys` form** (literal `-l` flag for the text, a
  *separate* `Enter` key, any settle delay, and dismissing the slash-command autocomplete /
  bracketed-paste handling) is a **research + live-verify item**, not assumed. plan-phase research
  proposes the form from prior art; a **live tmux test against the real Claude TUI** confirms it
  actually submits `/compact` before the keystone is declared done. This is the chief Phase-20
  verification hazard (the "send-keys round-trip" unknown from STATE.md).

### Idle safety — don't disturb interactive use (PILOT-06)
- **D-03 (idle guard):** **Best-effort idle check before firing.** Before `send-keys`, sample the
  target pane (e.g. `tmux capture-pane`) for an idle/empty prompt with no active spinner; if the
  pane looks busy (you are mid-typing, or Claude is mid-turn), **skip + log `busy_skip`** and retry
  next poll — do NOT inject into half-typed input or a mid-turn stream. Costs one extra tmux call
  per candidate fire; honors the "must not disturb interactive use" guard.
- **D-04 (structural narrowing):** The daemon can ONLY ever target `CC_TMUX=1` sessions — a bare
  `claude` launch (the default) has `pane=null` → `unmapped` → never acted on. So the idle-collision
  exposure is bounded to a tmux'd session the operator deliberately opted in; "disturb a random
  terminal" is already structurally impossible.

### Fire-once + arming (PILOT-07)
- **D-05 (arm-on-send — the failure-mode trap):** Arming (`idempotency.record_fired`) moves to
  **AFTER a successful `send-keys`**, NOT at the `would_compact` decision (where Phase 19's
  observe-only wiring currently records it). This is load-bearing: a best-effort **idle-skip must NOT
  consume the one allowed fire**, or under fire-once-no-retry (D-06) the session would sit
  stuck-armed-above-threshold and never compact. So: `busy_skip` → un-armed (re-tries next poll);
  successful send → armed; `<45%` drop → re-armed.
- **D-06 (fire-once, no retry):** Send **exactly once per arming**. If the keystroke lands but the
  session does not compact, **log it and wait for the natural re-arm** — do NOT retry inside the
  cycle (never spams a session lingering above 60%). Reliability of the round-trip is proven at the
  live gate (D-09) FIRST; bounded retry / round-trip-confirm is a **deferred fast-follow**, added only
  if the live gate shows the keystroke is flaky.
- **D-07 (re-arm hysteresis):** Re-arm a fired session only once usage drops **below ~45%** (tunable
  band), NOT plain `<60%`. A real `/compact` drops usage far below 60%, so this rarely bites — it is
  cheap anti-flap insurance so a compaction landing near 59% cannot instantly re-fire. Refines the
  Phase-19 `under_threshold` re-arm (which cleared at `<60%`).

### Act enablement & rollout (the observe→act transition)
- **D-10 (opt-in act, observe-only default):** Observe-only stays the **default** after Phase 20
  ships — the running LaunchAgent keeps logging `would_compact`/`compact_disabled` and takes no
  action until the operator flips an explicit **act toggle**, AFTER the live gate (D-09) passes.
  Mirrors the `cco-dream --dry-run` → real-run staging the operator already trusts (Phase-19 D-12
  named this as "the flag Phase 20 introduces").
- **D-11 (act scope = all mapped):** When the act toggle is on, cc-autopilot acts on **ALL mapped
  sessions** that cross 60%. The mapped set is already self-limited to `CC_TMUX` opt-in launches
  (D-04) and flipping the toggle is itself the deliberate opt-in, so a per-session canary tag is
  rejected as YAGNI.
- **D-12 (primary, not backstop):** cc-autopilot is the **PRIMARY** 60% compactor — it fires
  **promptly** on the crossing, not after a grace window. Rationale (D-17): nothing in-process
  actually sends `/compact` on 1M Opus today, so waiting only wastes context above the 60%
  performance ceiling. It reads the existing `…-nudged.json` marker as a **cheap dedupe** so it
  never races a `/compact` the operator just issued manually (or a native compaction if #63627 lands).

### Verification (Success Criterion 3)
- **D-09:** Prove the keystone in two layers: (1) **automated mock-bridge tests** for the act-path
  logic — assert the `send-keys` argv shape + correct `%N` targeting, fire-once (arm-on-send),
  `busy_skip` on a busy pane, the `<45%` hysteresis re-arm, and the marker dedupe — via the injected
  `run` stub (never spawns real tmux); and (2) an **operator-run live end-to-end gate** — contrive a
  ≥60% session, let the daemon fire, watch `used_pct` drop in the bridge — recorded in INSTALL.md as
  a Task-3-style DISCHARGED/RESIDUAL entry (a real 1M token-fill is too slow/expensive to fully
  automate, and Phase 19 established the operator-live-gate pattern).

### Claude's Discretion
- The exact **act toggle mechanism** — leaning a config-file key the daemon reads each poll (e.g.
  `~/.claude/.autopilot/config.json {"act": true}`) so flipping needs no `launchctl bootout/bootstrap`,
  over a plist `ProgramArguments` `--act` flag (which needs a reload). Either is acceptable; pick at plan.
- The **idle heuristic signal** (what `capture-pane` content = idle: the empty prompt line / absence
  of the working spinner). Settle during D-08 research against the live TUI.
- The **act-mode log decision vocabulary** extending the existing `{would_compact, stale_skip, no_op,
  unmapped}` — e.g. `compact_sent` (fired), `busy_skip` (idle-deferred), `compact_disabled`/`would_compact`
  (act toggle off). Keep the 7-field JSONL shape (D-13 from Phase 19).
- The exact **hysteresis band value** (~45% default) and whether the idle-check + marker-dedupe are
  one pre-flight or two.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements (authoritative — these win on any conflict)
- `.planning/ROADMAP.md` (Phase 20 section) — the goal, the **3 success criteria** (fire to own pane
  no-focus-steal / fire-once-per-cycle re-arm / live round-trip drops `used_pct`), PILOT-06/07 mapping,
  the strict 19→20→21 dependency chain.
- `.planning/REQUIREMENTS.md` — **PILOT-06** (send `/compact` via `send-keys` on 60% crossing, no
  focus steal) + **PILOT-07** (fire-once-per-cycle re-arm; verified end-to-end on the live binary),
  the three **Locked decisions** (tmux `send-keys`; `cco-dream` boundary; reset-from-message), and
  the Out-of-Scope table.
- `.planning/PROJECT.md` — Core Value (auto-compact must not silently fail on 1M Opus); **D-17**
  (cc-autopilot = EXTERNAL supervisor, the deterministic fix); **F2** (60% auto-compact trigger); the
  v5.0 scope guards (external daemon, augment-not-replace the KEEP-list, verify-against-binary,
  don't touch `~/.zshenv`).
- `.planning/STATE.md` — Accumulated Context (D-17, D-14 runner-as-boundary, the KEEP-list) and the
  **"v5.0 at-planning feasibility unknowns"** — specifically *"`/compact` send-keys round-trip
  (Phase 20/PILOT-07) — empirically confirm `send-keys` → `/compact` actually compacts the live
  binary before declaring the keystone done. Prior art: sure-scale/claude-code-auto-compact."*

### Phase 19 foundation (the daemon this phase acts through — read in full)
- `.planning/phases/19-supervisor-foundation/19-CONTEXT.md` — the whole inherited decision set
  (D-01..D-18). Especially **D-12** (observe-only by default; *"acting is gated behind an explicit
  flag/config that Phase 20 introduces"*), **D-15** (idempotency / fire-once), **D-16** (the `cco-dream`
  seam — reserved for driven `claude -p`, NOT this phase's keystroke), **D-18** (~10s poll cadence).
- `~/Developer/cc-autopilot/INSTALL.md` — the Phase-19 install + Task-3 live-verification record;
  its §6 "Observe-only anchor" **OPERATOR RESIDUAL** (live ≥60% crossing) is the exact gate Phase 20
  discharges. Phase 20 appends its act-mode + live-round-trip record here.

### Prior art for the send-keys incantation (D-08 research — vet licenses, port clean-room, vendor nothing)
- **sure-scale/claude-code-auto-compact** — tmux `/compact` auto-compaction (named in STATE.md as
  the closest prior art for the round-trip).
- **terryso/claude-auto-resume** — keystroke-into-pane prior art (Phase-21-adjacent, but its
  send-keys mechanics inform D-08). **Do NOT adopt its `--dangerously-skip-permissions`.**
- **CC Continue** — `~/.local/bin/cc_continue_final.sh` — the live harness's own keystroke-into-pane
  precedent (uses Accessibility, which cc-autopilot rejects for `send-keys`, but the incantation shape
  is reference).

### Naming (pin — docs disagree with the live system)
- The one-shot LaunchAgent is **`com.user.cc_continue_once.plist`** (not `com.user.cccontinue`).
  **Untouched this phase** — retired in Phase 21 / PILOT-10.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (all from the Phase-19 daemon — verified PASS 5/5, 180/180 tests green)
- **`autopilot/daemon.py` — `evaluate_session`** is the integration point: its `would_compact`
  branch (decision ladder step 5) is exactly where the act path hooks in. In act mode it calls the new
  `action.py`, and per D-05 the `record_fired` arming **moves to after a successful send** (today it's
  in the `would_compact` branch). The `under_threshold` re-arm branch changes from `<60%` to the D-07
  `<~45%` band. `poll_once` / `main` (the loop + per-poll error guard) are unchanged.
- **`autopilot/idempotency.py`** — `record_fired` / `already_fired` / `clear_fired` are already built;
  `clear_fired`'s docstring literally says *"Phase 20 calls this when usage drops back under threshold
  so a later re-crossing fires again."* Re-arm is wired; Phase 20 shifts *when* record/clear fire (D-05/D-07).
- **`autopilot/registry.py`** — `tmux_live_panes` is the **template for the new `send-keys` action**
  (injected `run`, argv list, graceful non-zero/OSError handling); `resolve_pane(session_id)` returns
  the owning `%N` the action targets.
- **`autopilot/runner.py`** — the `cco-dream` seam. **Left byte-unchanged** — `/compact` is a keystroke,
  not a `claude -p` (D-02). Stays for Phase 21.
- **`autopilot/__main__.py`** — the CLI/entry point; the act toggle wires here (or via a config file
  the daemon reads — discretion). Keep `--self-test` intact.
- **`~/.claude/statusline.py`** — the bridge writer; the sibling `…-{id}-nudged.json` marker is the
  D-12 dedupe read (augment, don't replace — leave the marker's writer/chain alone).
- **pytest harness** at `~/.local/bin/pytest` — the cco-*/autopilot suite is the model: TDD RED→GREEN,
  JSONL + argv assertions via the injected `run`/clock stubs, byte-unchanged composition pins.

### Established Patterns
- **Observe-only-first → act-behind-a-flag** mirrors `cco-dream --dry-run` (the staging shape the
  operator trusts; Phase-19 default + Phase-20 act toggle are the same shape).
- **Injected `run`/`now` for subprocess + clock** — the real tmux binary is never spawned in unit tests.
- **Metadata-only, reversible, verify-against-binary** — every `~/.claude/` edit reversible via
  `.bak-20-0N-*`; the load-bearing `send-keys` round-trip is live-verified before relied upon.
- **BSD-grep caveat** — cco-*/autopilot files with non-ASCII are mis-classed "binary" by macOS `grep`
  (silent empty `-c`/`-n`); verify with `grep -a` / Python / pytest.

### Integration Points
- **Reads:** the bridge `used_pct` + `timestamp` (staleness), the registry `%N` pane, `tmux
  capture-pane` (idle check, D-03) + `tmux list-panes` (liveness), `…-nudged.json` (dedupe, D-12).
- **Acts / writes:** `tmux send-keys` to the `%N` pane (the NEW action, D-01); idempotency state
  (arm-on-send, D-05); the JSONL log (new act-mode decision vocab); the act toggle (config file /
  flag — discretion).
- **Does NOT touch:** `cco-dream` / `runner.py` (byte-unchanged), the in-session compact-nudge /
  PreCompact / PostCompact chain (augment only), `~/.zshenv`, `com.user.cc_continue_once.plist` (Phase 21).

</code_context>

<specifics>
## Specific Ideas

- **cc-autopilot IS the deterministic Core-Value fix, so it fires primary and prompt.** The operator's
  framing: nothing in-process reliably compacts on 1M Opus (native armed auto-compact is broken #63627;
  the in-session nudge chain only surfaces an operator `systemMessage`), so a backstop grace window
  would just burn context above the 60% ceiling. Fire on the crossing; use the marker only to avoid
  racing a manual `/compact`.
- **The arm-on-send subtlety (D-05) is a conscious correctness decision, not an oversight.** Phase 19
  arms in the `would_compact` branch (correct for observe-only, where the "fire" IS the log line). In
  act mode with a best-effort idle skip, arming there would consume the one allowed fire on a `busy_skip`
  and, under fire-once-no-retry, silently strand the session armed-above-threshold. Arming must follow
  a successful `send-keys`.
- **"Observe-only first, act later" = `cco-dream --dry-run`.** The Phase-19 default mode and the
  Phase-20 act toggle are deliberately the same staging shape the operator already relies on.

</specifics>

<deferred>
## Deferred Ideas

- **Bounded retry / round-trip-confirm** (re-send if the bridge doesn't drop within N polls) — a
  **fast-follow**, added only if the live gate (D-09) shows the `send-keys` round-trip is flaky.
  Fire-once-no-retry (D-06) ships first.
- **Backstop grace window** — rejected this phase (D-12 chose primary/prompt; a grace window adds
  latency above the 60% ceiling). Revisit only if prompt-firing proves to race something real.
- **Per-session canary act tag** — rejected as YAGNI (D-11): mapped is already `CC_TMUX` opt-in and
  the act toggle is the deliberate gate.
- **Usage-aware resume + CC Continue retirement** (PILOT-08/09/10) — **Phase 21**, out of the
  keystone's boundary. The `cco-dream` seam + pane-targeting Phase 20 leaves intact are its foundation.
- **Phase auto-advance** (PILOT-F1) — deferred this milestone (overlaps `/gsd-autonomous`).
- **osascript / Ghostty keystroke injection** — locked-rejected upstream (mis-routes, TCC grants,
  focus-steal); `send-keys` is the path.

### Reviewed Todos (not folded)
None — `todo match-phase 20` returned 0 matches.

</deferred>

---

*Phase: 20-auto-compact-at-60-keystone*
*Context gathered: 2026-06-30*
