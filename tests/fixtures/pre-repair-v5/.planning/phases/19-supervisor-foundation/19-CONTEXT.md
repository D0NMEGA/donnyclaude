# Phase 19: Supervisor Foundation - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the **scaffolding** of cc-autopilot — an external launchd-managed daemon (`~/Developer/cc-autopilot/`) that:
1. Sees every live CC session and addresses each session's **tmux pane** unambiguously,
2. Reads that session's current **context%** from the on-disk bridge (`$TMPDIR/claude-ctx-{session_id}.json`), never acting on stale data,
3. Runs any `claude -p` it ever drives **only** under the `cco-dream` safety boundary.

**Hard scope anchor — NO ACTION is taken this phase.** No `/compact` is sent (Phase 20), no resume is performed (Phase 21). Phase 19 delivers the daemon, the tmux session model, the `session_id→pane` map, the live (never-stale) bridge reads, and the wired safety boundary — proven by an **observe-only** log of what it *would* do. Requirements: PILOT-01..05.

</domain>

<decisions>
## Implementation Decisions

### Language & build
- **D-01:** The v1 daemon is **Python, stdlib-only** — matching the cco-* substrate convention (`cco-source-drift`/`cco-vault-dream` are stdlib-only, no PyYAML). It shells out via `subprocess` to tmux and to `cco-dream`; reads bridge JSON with `json`. Chosen for fastest iteration on the still-unproven mechanisms (`send-keys` round-trip, limit-message format), reuse of the Python pytest regression harness, and native composition of the Python `cco-dream` runner. Cold-start latency is irrelevant for a `KeepAlive` daemon, so the usual "compiled CLI" argument does not bind here.
- **D-02:** A future **Go rewrite of a *proven* hot path** stays open per `CodingLanguagesInfo.md`'s meta-rule ("prototype fast, compile the proven hot path later; premature Rust/Go is as costly as never") — but is **not** done in v1. Deliberate choice of Python *over* the guide's Go-default, on iteration-speed grounds. (See Deferred.)
- **D-03:** Standing project conventions apply: ruff-clean, no bare `except`, type hints; tests run via `~/.local/bin/pytest` (the default `python3` lacks pytest; the PostToolUse lint-loop's `unresolved-import: pytest` is a known false positive).

### tmux adoption (PILOT-01)
- **D-04:** CC enters tmux by **wrapping the `claude` launch** in a `~/.zshrc` shell function (session-per-`claude`-invocation) — **not** auto-exec on every interactive shell. Plain terminals stay untouched ("must not disturb interactive use"). This satisfies "each session's pane addressable" without making every terminal a tmux session.
- **D-05:** Bypass rules: `NO_TMUX=1` runs `claude` bare (the locked bypass); also bypass when already inside tmux (`$TMUX` set) to avoid nested sessions.
- **D-06:** **tmux is not installed** — the foundation installs it via Homebrew (standing install authority) and documents the one-time step. Pin the installed version when verifying `send-keys`/pane mechanics.
- **D-07:** tmux session naming is project-legible (cwd basename + short `session_id` suffix, deduped) — **cosmetic only**; pane addressing keys on the registry (D-08), never on the session name.

### session_id → tmux pane map (PILOT-03 — the no-mis-routing hazard)
- **D-08:** A **SessionStart hook** (which already receives `session_id`) records `session_id ↔ $TMUX_PANE ↔ cwd ↔ pid ↔ ts` to a registry file the daemon reads; a **SessionEnd hook** removes the entry. Deterministic, no inference, no mis-routing.
- **D-09:** Registry lives at `~/.claude/.autopilot/` (co-located with the harness bridge layer). **Scope nuance vs D-17:** the registry-writer hook is part of the *harness bridge layer* in `~/.claude/` (like the statusline bridge), while all supervisor **logic** stays external in `~/Developer/cc-autopilot/`. The planner should treat the small SessionStart/SessionEnd registry hook as in-bounds for `~/.claude/` (reversible, additive), not a violation of "external daemon."
- **D-10:** The daemon treats **bridge-file freshness + live tmux pane existence as authoritative** for liveness — it prunes/ignores stale or missing registry entries each poll. So a missed `SessionEnd` (crash, kill -9) can never cause mis-routing; this folds in the "verify" half of the rejected hybrid option without full pane↔pid↔cwd inference.
- **D-11 (VERIFY-GATED):** Load-bearing assumption to confirm against the live binary *before relying on it*: a **SessionStart hook subprocess inherits `$TMUX_PANE`** when `claude` runs inside the wrapped tmux session. If it does not, fall back to capturing the pane another way (e.g., the wrapper exports it, or the hook reads `tmux display -p`). This is the chief Phase-19 verification item.

### Observability & no-action proof (PILOT-02, PILOT-04, PILOT-05)
- **D-12:** The Phase-19 daemon ships **observe-only by default** — it runs the *full* detect loop (read bridge → resolve pane via registry → evaluate the would-be 60% trigger) and logs structured **"would-act"** decisions **without** sending any keystroke. Acting is gated behind an explicit flag/config that **Phase 20 introduces** (mirrors `cco-dream --dry-run`). This is how the foundation is *proven* while taking no action.
- **D-13:** Action log = **JSONL**, one event per line, at `~/Developer/cc-autopilot/logs/` — tailable AND machine-checkable (tests assert on it). Each event records what / which session / when / why, e.g. `{ts, session_id, pane, cwd, used_pct, decision: "would_compact"|"stale_skip"|"no_op"|"unmapped", reason}`.
- **D-14 (PILOT-04 staleness):** Context% is read from the bridge's **`used_pct`** field (verified live: `{session_id, remaining_percentage, used_pct, used_pct_raw, timestamp}`, `timestamp` = epoch seconds). The daemon **skips + logs `stale_skip`** when `now - bridge.timestamp > 60s`. It never acts on stale data.
- **D-15 (PILOT-05 idempotency):** The daemon persists per-`(session_id, event)` last-action state to disk (survives `KeepAlive` restarts) so it never double-fires. In Phase 19 this is exercised by the observe-only assertion that a single 60%-crossing logs a single `would_compact` (not one per poll).
- **D-16 (PILOT-05 safety boundary):** Any `claude -p` the daemon *ever* invokes goes through the **`cco-dream` runner** (`--disallowedTools` denylist + pre-flight catastrophe check), **never** `--dangerously-skip-permissions`. Phase 19 sends no compact/resume `claude -p` (those are `send-keys`), so the foundation **wires + proves** the boundary with a benign no-op `claude -p` routed through `cco-dream`, verifying the seam before Phases 20/21 (and the deferred headless phase-runner) rely on it.

### launchd lifecycle (PILOT-02)
- **D-17:** The supervisor runs as a launchd **LaunchAgent** `com.user.ccautopilot.plist`: `RunAtLoad` + `KeepAlive` (starts at login, stays up). Distinct label from `com.user.cc_continue_once` (retired reversibly in Phase 21 / PILOT-10 — **do not** touch it this phase).
- **D-18:** Watch cadence = poll every ~10s (config-overridable), comfortably under the 60s staleness window so Phase 20's 60% crossings are caught promptly. (Claude's discretion within this default.)

### Claude's Discretion
- Exact registry file format (single JSON vs JSONL) and log rotation policy.
- The tmux session-name string and dedup scheme (D-07).
- Daemon internal structure (single script vs small package under `~/Developer/cc-autopilot/`).
- Poll-cadence tuning around the ~10s default (D-18).
- Whether the no-op safety-boundary probe (D-16) runs once at startup or is a `--self-test` subcommand.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements (authoritative — these win on any conflict)
- `.planning/ROADMAP.md` (Phase 19 section, ~lines 97–107) — goal, the 5 success criteria, PILOT-01..05 mapping, the strict 19→20→21 dependency chain.
- `.planning/REQUIREMENTS.md` — PILOT-01..05 definitions, the three **Locked decisions** (tmux `send-keys`; reset-from-CLI-message; `cco-dream` boundary), and the Out-of-Scope table.
- `.planning/PROJECT.md` — Core Value; **D-17** (cc-autopilot = EXTERNAL supervisor); the v5.0 scope guards (external daemon, don't touch `~/.zshenv`, augment-not-replace, verify-against-binary, main-thread browser-harness pre-staging); F1–F5.
- `.planning/STATE.md` — Accumulated Context decisions (D-17, D-14 runner-as-boundary, the KEEP-list) and **"v5.0 at-planning feasibility unknowns"** (the session_id↔pane hazard, the send-keys round-trip, the limit-message format).

### Operator source docs (read WITH the noted caveats — partially superseded)
- `~/Developer/cc-autopilot/MILESTONE-cc-autopilot.md` — the operator's origin sketch. **SUPERSEDED where it conflicts with ROADMAP/REQUIREMENTS:** it proposes Accessibility/Ghostty keystroke injection (REJECTED → tmux `send-keys`), an Agent-SDK headless runner (Phase 19's boundary is `cco-dream`, which already addresses its "headless hooks don't enforce" worry via RUNNER-01/02), and a *new* `~/.claude/.autopilot/state.json` schema with `cwd`/`rate_limit_reset_ts`/`model` (SUPERSEDED by the existing leaner bridge). Its "phase 04 headless phase-runner / auto phase-advance" = PILOT-F1 = **deferred**. Still valuable for: the catch-22 issue refs (#47276 etc.), the keystroke-brittleness risk register, and the §03 1M-window bug refs (#43989/#53801/#34332).
- `CodingLanguagesInfo.md` (repo root) — the language-decision input. §4 (Go = CLI/daemon default) + the cross-cutting meta-rule (iteration-speed first, compile the proven hot path later) — the basis for D-01/D-02.
- `CONFIG-CHANGES.md` (repo root) — §3 (make `cco-dream` the safety boundary), §7 (auto-compact at 60% — "the deterministic fix is external… that is phase 03 of cc-autopilot"), §10 (CC Continue: interim tweak, then supersede with `com.user.ccautopilot.plist`).

### Naming reconciliation (pin this — docs disagree with the live system)
- The live one-shot LaunchAgent is **`com.user.cc_continue_once.plist`** (→ `~/.local/bin/cc_continue_final.sh`, logs to `/tmp/cc_continue.log`). Both `MILESTONE-cc-autopilot.md` and `CONFIG-CHANGES.md` call it `com.user.cccontinue.plist` — use the **live** name `com.user.cc_continue_once.plist` (matches ROADMAP/REQUIREMENTS). Retired in Phase 21, not Phase 19.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`~/.claude/bin/cco-dream`** (Python, 88KB) — the safety boundary to **compose** (subprocess), never fork. Inherit `--disallowedTools` denylist + pre-flight catastrophe check + timeout/`--max-cost` (RUNNER-01/02, D-14). The vault-dream siblings prove the "compose, don't fork" pattern (md5-pinned, byte-unchanged each phase).
- **`~/.claude/statusline.py`** — the bridge *writer*; writes `$TMPDIR/claude-ctx-{session_id}.json` on each render. Bridge schema verified live: `{"session_id","remaining_percentage","used_pct","used_pct_raw","timestamp"}` (epoch secs). The daemon is the bridge *reader*. (Sibling `…-{id}-nudged.json` = the compact-nudge marker; leave it to the existing chain — augment, don't replace.)
- **`~/.claude/hooks/`** — home for the new SessionStart + SessionEnd registry hooks (D-08). Existing hooks already read/write `claude-ctx`: `cco-compact-nudge.js`, `gsd-context-monitor.js`, `cco-precompact-snapshot.js`, `gsd-statusline.js` — patterns to follow for hook env + bridge paths.
- **pytest regression harness** at `~/.local/bin/pytest` — the cco-* suite (121/121 green at v4.0 close) is the model: TDD RED→GREEN, JSONL/file assertions, byte-unchanged composition pins.
- **CC Continue** — `~/Library/LaunchAgents/com.user.cc_continue_once.plist` + `~/.local/bin/cc_continue_final.sh`: the *prior art* for the launchd shape and the keystroke-into-pane idea (but it uses fixed `StartCalendarInterval`, RunAtLoad=false, and Accessibility — all of which cc-autopilot improves on). Reference, not retired this phase.

### Established Patterns
- **Compose-not-fork** + **md5-pin byte-unchanged siblings** (the v4.0 discipline) — apply when the daemon shells `cco-dream`.
- **Metadata-only, human-gated, reversible** — every `~/.claude/` edit reversible via `.bak-19-0N-*`; the registry hooks write metadata only (no transcript content), matching cco-log hygiene.
- **Verify-against-binary** — D-11 ($TMUX_PANE inheritance), D-14 (bridge schema, already verified), the Phase-20 send-keys round-trip, the Phase-21 limit format. Standing discipline.
- **BSD-grep caveat** — cco-* files with non-ASCII are mis-classed "binary" by macOS `grep` (silent empty `-c`/`-n`); verify with `grep -a`/Python/pytest.

### Integration Points
- **Reads:** `$TMPDIR/claude-ctx-{session_id}.json` (context% + staleness), `~/.claude/.autopilot/` registry (pane map), `tmux` (pane liveness via subprocess).
- **Writes (Phase 19):** `~/Developer/cc-autopilot/` (daemon + logs), `~/.claude/.autopilot/` (registry, via hooks), `~/.claude/hooks/` (2 new hooks + settings.json registration), `~/.zshrc` (the `claude` wrapper function), `~/Library/LaunchAgents/com.user.ccautopilot.plist`.
- **Does NOT touch:** `~/.zshenv` (Semantic Scholar key — operator's explicit out-of-scope call), `com.user.cc_continue_once.plist` (Phase 21), the in-session compact-nudge / PreCompact / PostCompact chain (augment only).

</code_context>

<specifics>
## Specific Ideas

- The operator deliberately dropped **`CodingLanguagesInfo.md`** into the repo to make the language question rigorous. The chosen answer (Python v1) is a *considered* pick **against** that guide's Go-default — on iteration-speed + glue-workload + reuse-the-Python-substrate grounds — with the guide's own meta-rule ("compile the proven hot path later") as the explicit escape hatch. Capture this as a conscious trade-off, not an oversight.
- "Observe-only first, act later" mirrors the existing **`cco-dream --dry-run`** model the operator already trusts — the Phase-19 daemon's default mode and Phase-20's `act` flag are the same staging shape.
- Pane addressing via a **registry written by a SessionStart hook** was preferred over daemon-side inference specifically to eliminate the same-cwd tie-break mis-routing failure mode.

</specifics>

<deferred>
## Deferred Ideas

- **Go rewrite of a proven hot path** (per `CodingLanguagesInfo.md`'s meta-rule) — revisit only if a measured bottleneck appears; not v1.
- **PILOT-F1 — phase auto-advance / headless phase-runner** (the milestone sketch's "phase 04") — explicitly deferred this milestone (overlaps `/gsd-autonomous`; PILOT-08/09 resume already covers "survive the pause"). The D-16 `claude -p`-through-`cco-dream` seam is the foundation it would later build on.
- **Phase 20 / 21 work** — the actual `/compact` send-keys trigger (PILOT-06/07) and usage-aware resume + CC Continue retirement (PILOT-08/09/10) are out of Phase 19 by the hard no-action anchor.
- **Residual v3-audit hardening** (Seatbelt sandbox for `/dream`, `.cco/green-result.json` contract, green-gate 12-ancestor monorepo-scope fix, MCP-config sync nit), **DOCS-01**, **RECALL-02** — pre-existing backlog, unrelated to the supervisor.

### Reviewed Todos (not folded)
None — `todo match-phase 19` returned 0 matches.

</deferred>

---

*Phase: 19-supervisor-foundation*
*Context gathered: 2026-06-21*
