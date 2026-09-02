# Requirements: claudecodeoptimized — Milestone v5.0 (cc-autopilot)

**Defined:** 2026-06-21
**Core Value:** The harness reliably runs at full strength on every session — auto-compact does not silently fail on 1M-context Opus, effort is actually `max`, and the operator can see harness state at a glance — so long sessions don't degrade or lose context.

**Milestone goal:** An external launchd-managed supervisor that reads the harness's own live session state and acts on it from *outside* the CC process — deterministically fixing what in-process config provably cannot: 60%-context `/compact` on 1M Opus, and resume-after-a-usage-limit.

**Locked decisions feeding these requirements:**
- **Injection = tmux `send-keys`** — `claude` runs inside tmux; the supervisor targets each session's pane by id (clean, no focus-steal, no macOS Accessibility/Automation grants, no cross-pane mis-routing). The osascript/Ghostty path is the rejected alternative.
- **F3 kept**, but reset is **derived from the CLI's "usage limit reached" message** (terryso pattern), since this metered `enterprise_usage_based` seat has no 5h/7d `rate_limits` blob.
- **Safety boundary = the `cco-dream` runner** (D-14): any `claude -p` the supervisor drives carries the `--disallowedTools` denylist + pre-flight catastrophe check; **never** `--dangerously-skip-permissions`.

## v1 Requirements

Requirements for this milestone. Each maps to a roadmap phase.

### Supervisor foundation (F1)

- [x] **PILOT-01**: CC sessions run inside tmux via a `~/.zshrc` auto-exec snippet (session-per-shell), making each session's pane addressable by tmux pane id — without disrupting normal interactive use (a `NO_TMUX=1` bypass exists).
- [x] **PILOT-02**: The supervisor runs as a launchd-managed daemon (starts at login, `KeepAlive`), writing an operator-tailable action log (what it did, to which session, when, and why).
- [x] **PILOT-03**: The supervisor maps each live CC `session_id` to its owning tmux pane, so every action targets the correct pane even with multiple concurrent sessions (no mis-routing).
- [x] **PILOT-04**: The supervisor reads live per-session context % from the statusline bridge (`$TMPDIR/claude-ctx-{session_id}.json`), honoring the 60-second staleness rule (it never acts on stale data).
- [x] **PILOT-05** *(safety)*: Any `claude -p` the supervisor drives runs under the `cco-dream` runner boundary (`--disallowedTools` denylist + pre-flight catastrophe check) and never uses `--dangerously-skip-permissions`; the daemon is idempotent — it never double-fires an action on the same session/event.

### Auto-compact at 60% — the keystone (F2)

- [ ] **PILOT-06**: When a session's context crosses 60%, the supervisor sends `/compact` to that session's owning pane via tmux `send-keys`, without stealing window focus.
- [ ] **PILOT-07**: The 60% trigger fires at most once per fill cycle (re-arms only after a compaction drops usage back down) and is verified end-to-end against the live binary — the `send-keys` → `/compact` round-trip actually compacts the session.

> **Live-proof clause superseded-by-native (D-13, amended 2026-07-02; regime change 2026-07-01, CC 2.1.198).** Native auto-compact now fires at ~59% used on 1M Opus (`trigger:"auto"` at `used_pct:59`, binary-verified), so the PILOT-06/07 `send-keys` `/compact` mechanism is now belt-and-suspenders, not the sole compactor. PILOT-07's "verified end-to-end against the live binary" clause is therefore **superseded-by-native**: Phase 20's pending live `send-keys` round-trip is not a residual to chase - native compaction wins the race. The mechanism stays shipped and unit-proven (72/72 at Phase-20 close) as a deterministic fallback; only the requirement to force a live 60%-crossing round-trip is retired. This does not weaken PILOT-06/07 as shipped code, and it does not affect the F3 resume path (PILOT-08/09), which carries v5.0's remaining live value.

### Usage-aware resume (F3)

- [ ] **PILOT-08**: When a CC session stops on a usage/rate limit, the supervisor detects it from the CLI's own "usage limit reached" message (the message format pinned empirically against the live binary — not the absent `rate_limits` blob).
- [ ] **PILOT-09**: The supervisor waits until the reset time parsed from that message, then resumes the session with the correct per-project continuation (replacing CC Continue's fixed-time guess + generic "continue" string).

### Lifecycle (F5)

- [ ] **PILOT-10**: Once **PILOT-08/09** are proven on the live binary, the supervisor supersedes the existing `com.user.cc_continue_once.plist` one-shot alarm — resume becomes event-driven, and the old plist is retired (reversibly). *(D-13 re-gate, 2026-07-02: the gate is PILOT-08/09 - resume - not 06..09. CC Continue is a resume tool, so retirement gates on the resume path being proven; PILOT-06/07's live clause is superseded-by-native, see the F2 note above. Because the retired plist is already inert - `RunAtLoad=false`, its one-shot date 2026-06-18 passed - retirement can proceed on the D-15 simulation gate, with the exact live banner pinned at the next natural limit event.)*

## Future Requirements

Deferred — tracked, not in this roadmap.

### Phase auto-advance (F4)

- **PILOT-F1**: The supervisor auto-advances GSD phases across usage pauses (a bridge to `/gsd-autonomous`). Deferred — it overlaps the existing autonomous mode, and PILOT-08/09 (resume) already covers "survive the pause." Revisit once the supervisor core is proven.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Re-homing / rotating the Semantic Scholar API key (`~/.zshenv`) | Operator's explicit call 2026-06-21 — kept as-is; do not touch `~/.zshenv`. |
| osascript / Ghostty (System Events) keystroke injection | The rejected alternative to the chosen tmux `send-keys` path (mis-routes, needs TCC grants, fragile). |
| 5h/7d rolling-window resume logic (`rate_limits`/`resets_at`) | This metered `enterprise_usage_based` seat has no rolling windows / no `rate_limits` blob — verified. F3 derives reset from the CLI message instead. |
| `--dangerously-skip-permissions` for the driven `claude -p` | Unbounded risk under an unattended daemon; the `cco-dream` runner boundary (D-14) is the safety model. |
| Replacing the compact-nudge chain / PreCompact-PostCompact snapshot | cc-autopilot **augments** them; the in-session chain (ride-1M, snapshot) stays (KEEP-list). |
| Residual v3-audit hardening (Seatbelt sandbox for `/dream`, `.cco/green-result.json` contract, green-gate 12-ancestor monorepo-scope fix, MCP-config sync nit) | Real but separate; deferred backlog, not this milestone. |
| DOCS-01 (`claudecodedocs` mirror refresh), RECALL-02 (embedding recall) | Pre-existing deferred backlog, unrelated to the supervisor. |

## Traceability

Which phases cover which requirements. Populated during roadmap creation (v5.0 ROADMAP, 2026-06-21).

| Requirement | Phase | Status |
|-------------|-------|--------|
| PILOT-01 | Phase 19 — Supervisor Foundation | Verified (19-VERIFICATION passed); record repair → Phase 22 |
| PILOT-02 | Phase 19 — Supervisor Foundation | Verified (19-VERIFICATION passed); record repair → Phase 22 |
| PILOT-03 | Phase 19 — Supervisor Foundation | Verified (19-VERIFICATION passed); record repair → Phase 22 |
| PILOT-04 | Phase 19 — Supervisor Foundation | Verified (19-VERIFICATION passed); record repair → Phase 22 |
| PILOT-05 | Phase 19 — Supervisor Foundation | Verified (19-VERIFICATION passed); record repair → Phase 22 |
| PILOT-06 | Phase 20 — Auto-Compact at 60% (Keystone) | Mechanism shipped (72/72); live clause superseded-by-native (D-13); re-verification → Phase 22 |
| PILOT-07 | Phase 20 — Auto-Compact at 60% (Keystone) | Mechanism shipped (72/72); live round-trip superseded-by-native (D-13); re-verification → Phase 22 |
| PILOT-08 | Phase 21 — Usage-Aware Resume & CC Continue Retirement | Code shipped (21-05, 102/102); D-15 sim gate discharged; amendment → Phase 22 (banner-pin UAT tracked) |
| PILOT-09 | Phase 21 — Usage-Aware Resume & CC Continue Retirement | Code shipped (21-05, 102/102); D-15 sim gate discharged; amendment → Phase 22 (real-TUI UAT tracked) |
| PILOT-10 | Phase 21 — Usage-Aware Resume & CC Continue Retirement | Retirement executed & verified live (D-13 gate); amendment → Phase 22 |

**Coverage:**
- v1 requirements: 10 total
- Mapped to phases: 10 ✓ (Phase 19: PILOT-01..05 · Phase 20: PILOT-06/07 · Phase 21: PILOT-08/09/10)
- Unmapped: 0 ✓
- Deferred (not mapped, by design): PILOT-F1 (phase auto-advance, F4) — operator 2026-07-03: promote as backlog 999.3 in the cycle AFTER v5.0 closes
- Formal confirmation: 0/10 per the 2026-07-03 milestone-audit engine gate (`gaps_found`, zero code-delivery gaps) — record repair assigned to **Phase 22**; each requirement stays mapped to its implementing phase (19/20/21), whose artifacts Phase 22 repairs in place

---
*Requirements defined: 2026-06-21 (milestone v5.0 cc-autopilot)*
*Last updated: 2026-06-21 — traceability populated by v5.0 roadmap (10/10 PILOT reqs mapped to Phases 19–21; PILOT-F1 deferred).*
*Amended 2026-07-02 (Phase 21, plan 06, D-13): PILOT-10's retirement gate re-scoped to PILOT-08/09 (resume) proven on the live binary - not PILOT-06..09. PILOT-06/07's "verified end-to-end against the live binary" clause marked superseded-by-native (native auto-compact fires at ~59% on CC 2.1.198; the send-keys keystone stays shipped as belt-and-suspenders). Additive amendment - no requirement removed, no shipped code weakened.*
*Amended 2026-07-03 (/donny-plan-milestone-gaps after the v5.0 audit): Phase 22 "Audit-Gap Closure — Traceability & Verification Repair" added; traceability Status column updated. Deliberate deviation from the reassign-and-uncheck rule (operator-approved): requirements stay mapped to Phases 19/20/21 and PILOT-01..05 stay `[x]` because the audit found zero code-delivery gaps — the gaps are the phases' formal records (SUMMARY frontmatter, VERIFICATION verdict vocabulary), which Phase 22 repairs in place. PILOT-06..10 stay `[ ]` until the repaired records parse and the re-audit confirms.*
