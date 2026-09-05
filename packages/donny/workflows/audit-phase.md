<purpose>
Retroactively audit a completed phase across three dimensions: security (threat mitigations recorded in the PLAN.md threat model are actually implemented), validation (Nyquist test coverage for the phase's requirements), and records (the deterministic `verify` checkers run over the phase's own planning artifacts). By default all three run; `--security`, `--validate` or `--records` narrows to one. Updates SECURITY.md, VALIDATION.md and/or NN-RECORDS.md. The record dimension calls no model and never blocks advancement.
</purpose>

<required_reading>
@$HOME/.claude/donny/references/ui-brand.md
</required_reading>

<available_agent_types>
Valid Donny subagent types (use exact names - do not fall back to 'general-purpose'):
- donny-security-auditor - Verifies threat mitigation coverage
- donny-nyquist-auditor - Validates verification coverage
</available_agent_types>

<process>

## 0. Initialize + Resolve Scope

```bash
INIT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" init phase-op "${PHASE_ARG}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse: `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `padded_phase`.

**Scope flags** (from `$ARGUMENTS`):
- No flag, or `--all` -> run ALL THREE audits (default).
- `--security` -> security audit only.
- `--validate` -> validation audit only.
- `--records` -> record gate only.

```bash
SECURITY_CFG=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" config-get workflow.security_enforcement --raw 2>/dev/null || echo "true")
NYQUIST_CFG=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" config-get workflow.nyquist_validation --raw 2>/dev/null || echo "true")
RECORD_CFG=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" config-get workflow.record_gate --raw 2>/dev/null || echo "true")
```

Since Phase 24, `config-get` resolves any key in `VALID_CONFIG_KEYS` through hardcoded defaults,
then `~/.donny/defaults.json`, then `.planning/config.json`, and always prints a value. The
`|| echo "true"` is now a last resort rather than the default layer. It stays because it still
catches a crashed `node`, a missing binary, or a key that is genuinely unregistered.

Resolve `RUN_SECURITY`, `RUN_VALIDATE` and `RUN_RECORDS`:
- Default scope: `RUN_SECURITY` = (`SECURITY_CFG` != false); `RUN_VALIDATE` = (`NYQUIST_CFG` != false); `RUN_RECORDS` = (`RECORD_CFG` != false).
- `--security`: `RUN_VALIDATE`=false, `RUN_RECORDS`=false. If `SECURITY_CFG` is false, exit - "Security enforcement disabled. Enable via /donny-settings or `donny-tools config-set workflow.security_enforcement true`." Else `RUN_SECURITY`=true.
- `--validate`: `RUN_SECURITY`=false, `RUN_RECORDS`=false. If `NYQUIST_CFG` is false, exit - "Nyquist validation disabled. Enable via /donny-settings or `donny-tools config-set workflow.nyquist_validation true`." Else `RUN_VALIDATE`=true.
- `--records`: `RUN_SECURITY`=false, `RUN_VALIDATE`=false. If `RECORD_CFG` is false, exit - "Record gate disabled. Enable via /donny-settings or `donny-tools config-set workflow.record_gate true`." Else `RUN_RECORDS`=true.

If all three are false (default scope, all configs disabled): exit - "Security, Nyquist and record audits are all disabled. Enable via /donny-settings."

A narrowing flag is the only way to skip a dimension, and each one says out loud what it turned off.
The v5.0 record drift came from the opposite arrangement, where the dimension had to be remembered
INTO the run: phases 19 through 21 ran `--security` alone and nobody noticed the gap for months.

**Phase-executed gate** (shared State C - applies to whichever audits run):

```bash
SUMMARY_FILES=$(ls "${PHASE_DIR}"/*-SUMMARY.md 2>/dev/null)
```

If `SUMMARY_FILES` is empty: exit - "Phase {N} not executed. Run /donny-execute-phase {N} first."

Display banner: `DONNY ► AUDIT PHASE {N}: {name}` (append the active scope, naming exactly the dimensions that will run: `security + validation + records`, `security + records`, `validation + records`, `security + validation`, `security only`, `validation only`, or `records only`).

Track `SECURITY_BLOCKED=false` for the final routing decision.

---

## Part A - Security Audit

**Run this part only if `RUN_SECURITY` is true.** Otherwise skip to Part B.

```bash
AGENT_SKILLS_SEC=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" agent-skills donny-security-auditor 2>/dev/null)
SEC_MODEL=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" resolve-model donny-security-auditor --raw)
```

### A1. Detect Input State

```bash
SECURITY_FILE=$(ls "${PHASE_DIR}"/*-SECURITY.md 2>/dev/null | head -1)
PLAN_FILES=$(ls "${PHASE_DIR}"/*-PLAN.md 2>/dev/null)
```

- **State A** (`SECURITY_FILE` non-empty): audit existing.
- **State B** (`SECURITY_FILE` empty, `PLAN_FILES` non-empty): run from artifacts.

### A2. Discovery

Read PLAN.md - extract `<threat_model>` block: trust boundaries, STRIDE register (`threat_id`, `category`, `component`, `disposition`, `mitigation_plan`). Read SUMMARY.md `## Threat Flags`. Build the register per threat: `{ threat_id, category, component, disposition, mitigation_pattern, files_to_check }`.

### A3. Threat Classification

| Status | Criteria |
|--------|----------|
| CLOSED | mitigation found OR accepted risk documented in SECURITY.md OR transfer documented |
| OPEN | none of the above |

Build: `{ threat_id, category, component, disposition, status, evidence }`. If `threats_open: 0` -> skip to A6.

### A4. Present Threat Plan

Call AskUserQuestion with the threat table and options:
1. "Verify all open threats" -> A5
2. "Accept all open - document in accepted risks log" -> add to SECURITY.md accepted risks, set all CLOSED, A6
3. "Cancel" -> skip the rest of Part A

### A5. Spawn donny-security-auditor

```
Task(
  prompt="Read $HOME/.claude/agents/donny-security-auditor.md for instructions.\n\n" +
    "<files_to_read>{PLAN, SUMMARY, impl files, SECURITY.md}</files_to_read>" +
    "<threat_register>{threat register}</threat_register>" +
    "<config>asvs_level: {SECURITY_ASVS}, block_on: {SECURITY_BLOCK_ON}</config>" +
    "<output_contract>Write findings to ${PHASE_DIR}/${PADDED_PHASE}-SECURITY.md - ALWAYS the phase-padded filename, never a bare SECURITY.md. State A re-runs detect prior audits by the *-SECURITY.md glob; a bare name breaks that and overwrites the audit trail.</output_contract>" +
    "<constraints>Never modify implementation files. Verify mitigations exist - do not scan for new threats. Escalate implementation gaps.</constraints>" +
    "${AGENT_SKILLS_SEC}",
  subagent_type="donny-security-auditor",
  model="{SEC_MODEL}",
  description="Verify threat mitigations for Phase {N}"
)
```

Handle return: `## SECURED` -> record closures -> A6. `## OPEN_THREATS` -> record closed + open, present accept/block choice -> A6. `## ESCALATE` -> present to user -> A6.

### A6. Write/Update SECURITY.md

**Filename guard (fixes the State-A re-run bug):** the canonical path is `${PHASE_DIR}/${PADDED_PHASE}-SECURITY.md`. If the auditor produced a bare `${PHASE_DIR}/SECURITY.md`, move it to the padded name before proceeding so future runs detect State A:

```bash
if [[ -f "${PHASE_DIR}/SECURITY.md" && ! -f "${PHASE_DIR}/${PADDED_PHASE}-SECURITY.md" ]]; then
  mv "${PHASE_DIR}/SECURITY.md" "${PHASE_DIR}/${PADDED_PHASE}-SECURITY.md"
fi
```

**State B (create):** read `$HOME/.claude/donny/templates/SECURITY.md`, fill frontmatter / threat register / accepted risks / audit trail, write to `${PHASE_DIR}/${PADDED_PHASE}-SECURITY.md`.

**State A (update):** update threat-register statuses, append the audit trail:

```markdown
## Security Audit {date}
| Metric | Count |
|--------|-------|
| Threats found | {N} |
| Closed | {M} |
| Open | {K} |
```

**ENFORCING GATE (engine-enforced, BLOCKING).** After SECURITY.md is written, re-derive the open-threat count deterministically from the Threat Register table instead of trusting the frontmatter `threats_open` the auditor wrote:

```bash
THREATS=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" verify threats-clear "${PHASE_DIR}")
```

Returns `{ clear, threats_open, open_ids, declared, consistent, has_register }` - it counts rows whose Status is `open` in the `## Threat Register` table (the Security Audit Trail table, which also has an "Open" column, is excluded). Decide routing from this, not from the auditor's self-reported count:
- `clear: true` -> proceed; no open threats.
- `clear: false` -> set `SECURITY_BLOCKED=true` and report `open_ids`.
- `consistent: false` -> the frontmatter `threats_open` (`declared`) disagrees with the table count; the table wins. Surface the mismatch so the auditor's bookkeeping is corrected, and still block on the table count.
- `has_register: false` -> SECURITY.md has no parseable register; treat as NOT clear and block.

(Routing is decided once at the end so a combined run still records the validation result.)

---

## Part B - Validation Audit

**Run this part only if `RUN_VALIDATE` is true.** Otherwise skip to Part C.

```bash
AGENT_SKILLS_NYQ=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" agent-skills donny-nyquist-auditor 2>/dev/null)
NYQ_MODEL=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" resolve-model donny-nyquist-auditor --raw)
```

### B1. Detect Input State

```bash
VALIDATION_FILE=$(ls "${PHASE_DIR}"/*-VALIDATION.md 2>/dev/null | head -1)
```

- **State A** (`VALIDATION_FILE` non-empty): audit existing.
- **State B** (`VALIDATION_FILE` empty): reconstruct from artifacts.

### B2. Discovery

Read all PLAN and SUMMARY files - extract task lists, requirement IDs, key-files changed, verify blocks. Build the requirement-to-task map per task: `{ task_id, plan_id, wave, requirement_ids, has_automated_command }`.

Detect test infrastructure:
- State A: parse from the existing VALIDATION.md Test Infrastructure table.
- State B: filesystem scan -

```bash
find . -name "pytest.ini" -o -name "jest.config.*" -o -name "vitest.config.*" -o -name "pyproject.toml" 2>/dev/null | head -10
find . \( -name "*.test.*" -o -name "*.spec.*" -o -name "test_*" \) -not -path "*/node_modules/*" 2>/dev/null | head -40
```

Cross-reference each requirement to existing tests by filename, imports, and test descriptions.

### B3. Gap Analysis

| Status | Criteria |
|--------|----------|
| COVERED | Test exists, targets behavior, runs green |
| PARTIAL | Test exists, failing or incomplete |
| MISSING | No test found |

Build: `{ task_id, requirement, gap_type, suggested_test_path, suggested_command }`. No gaps -> skip to B6, set `nyquist_compliant: true`.

### B4. Present Gap Plan

Call AskUserQuestion with the gap table and options:
1. "Fix all gaps" -> B5
2. "Skip - mark manual-only" -> add to Manual-Only, B6
3. "Cancel" -> skip the rest of Part B

### B5. Spawn donny-nyquist-auditor

```
Task(
  prompt="Read $HOME/.claude/agents/donny-nyquist-auditor.md for instructions.\n\n" +
    "<files_to_read>{PLAN, SUMMARY, impl files, VALIDATION.md}</files_to_read>" +
    "<gaps>{gap list}</gaps>" +
    "<test_infrastructure>{framework, config, commands}</test_infrastructure>" +
    "<constraints>Never modify impl files. Max 3 debug iterations. Escalate impl bugs.</constraints>" +
    "${AGENT_SKILLS_NYQ}",
  subagent_type="donny-nyquist-auditor",
  model="{NYQ_MODEL}",
  description="Fill validation gaps for Phase {N}"
)
```

Handle return: `## GAPS FILLED` -> record tests + map updates -> B6. `## PARTIAL` -> record resolved, move escalated to manual-only -> B6. `## ESCALATE` -> move all to manual-only -> B6.

### B6. Generate/Update VALIDATION.md

**State B (create):** read `$HOME/.claude/donny/templates/VALIDATION.md`, fill frontmatter / Test Infrastructure / Per-Task Map / Manual-Only / Sign-Off, write to `${PHASE_DIR}/${PADDED_PHASE}-VALIDATION.md`.

**State A (update):** update Per-Task Map statuses, add escalated to Manual-Only, update frontmatter, append the audit trail:

```markdown
## Validation Audit {date}
| Metric | Count |
|--------|-------|
| Gaps found | {N} |
| Resolved | {M} |
| Escalated | {K} |
```

---

## Part C - Record Gate

**Run this part only if `RUN_RECORDS` is true.** Otherwise skip to Commit.

This is the only LLM-free dimension. No subagent is spawned, no model is called, and the whole
check is two deterministic CLI calls. It is advisory by construction (D-02): it does not touch
`SECURITY_BLOCKED` and it never suppresses next-phase routing.

### C1. Detect Input State

```bash
RECORDS_FILE=$(ls "${PHASE_DIR}"/*-RECORDS.md 2>/dev/null | head -1)
```

- **State A** (`RECORDS_FILE` non-empty): a prior run exists. The gate re-runs and appends a dated
  row to the audit trail in that file (D-04). Never skip because a passing record already exists;
  the verdict is always derived from the CURRENT artifacts.
- **State B** (`RECORDS_FILE` empty): first run for this phase.

### C2. Run the Gate

```bash
GATE=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" verify gate "${PHASE_NUM}" --write)
if [[ "$GATE" == @file:* ]]; then GATE=$(cat "${GATE#@file:}"); fi
```

Exactly one JSON document comes back. Parse `verdict`, `rollup`, `counts` and `records_file`:

- `rollup` is exactly thirteen rows, one per checker: `{ verb, scope, targets, severity, detail, findings }`.
  Severity is one of `pass`, `warning`, `error`, `not_applicable`, `not_yet`.
- `counts` totals every checker INVOCATION across every target, not the thirteen rows, so its
  `total` runs well above 13 on a phase with several plans. Report the rollup, not this.
- `records_file` is the path `--write` just wrote, always `${PHASE_DIR}/${PADDED_PHASE}-RECORDS.md`.

Report the rollup as a short table - checker, severity, detail - for every row whose severity is
not `pass`. Do not print all thirteen rows when all thirteen pass; print the counts line and say so.

### C3. ENFORCING GATE (engine-enforced, ADVISORY)

After the record file is written, re-derive the verdict from its own body table rather than trusting
the frontmatter the writer just emitted. This is the same discipline A6 applies to `threats_open`:

```bash
RECORD_VERDICT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" verify gate "${PHASE_NUM}" --read --raw)
RECORD_DETAIL=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" verify gate "${PHASE_NUM}" --read)
```

`--read` runs no checkers; it parses the `## Verb Results` table in `NN-RECORDS.md` and returns
`{ present, has_table, verdict, derived, declared, consistent, counts, file, detail }`. Decide what
to report from this, not from what C2 printed:

- `verdict: pass` -> report `[records] gate passed`.
- `verdict: fail` -> report `[records] {counts.error} checker error(s)` and list them. Do NOT set
  `SECURITY_BLOCKED` and do NOT suppress routing. The record dimension is advisory (D-02).
- `verdict: not_run` -> the file is absent or its table is unparseable. Report
  `[records] NOT RUN - no parseable record gate result for this phase`. A missing run never reads as
  a pass (D-10, GATE-02).
- `consistent: false` -> the frontmatter verdict disagrees with the body table. The TABLE WINS.
  Report both values so the disagreement is visible.

---

## Commit

```bash
# Validation only: stage any generated test files first.
[ -n "{generated_test_files}" ] && git add {test_files} && git commit -m "test(phase-${PHASE}): add Nyquist validation tests"

node "$HOME/.claude/donny/bin/donny-tools.cjs" commit "docs(phase-${PHASE}): audit security, validation and records"
```

(Scope the commit message to whichever audits ran: `audit security`, `audit validation`, `audit records`,
`audit security and records`, `audit validation and records`, `audit security and validation`, or
`audit security, validation and records`.)

`commit` with no `--files` stages `.planning/` wholesale, so `${PHASE_DIR}/*-RECORDS.md` is already
included when `RUN_RECORDS` ran. Do not narrow the staging to a file list to pick it up - that would drop
the SECURITY.md and VALIDATION.md written by the other two dimensions.

---

## Results + Routing

**If `SECURITY_BLOCKED` is true** - emit the block and STOP. Do not emit next-phase routing:

```
DONNY ► PHASE {N} SECURITY BLOCKED
{K} threats open - phase advancement blocked until threats_open: 0
▶ Fix mitigations then re-run: /donny-audit-phase {N} --security
▶ Or document accepted risks in SECURITY.md and re-run.
```

**Otherwise** - report each audit that ran, then route:

```
DONNY ► PHASE {N} AUDIT COMPLETE
[security] threats_open: 0 - all threats have dispositions.
[validation] {M} automated, {K} manual-only.
[records] verdict: {RECORD_VERDICT} - {counts.error} errors, {counts.warning} warnings, {counts.not_yet} not-yet.
▶ /donny-verify-work {N}        run UAT
▶ /donny-audit-milestone ${DONNY_WS}   when the milestone is done
```

The `[records]` line appears only when `RUN_RECORDS` was true, and its counts come from the C3
`--read` result, so they describe the thirteen rows of the record's own table rather than the
per-invocation totals C2 printed.

The record dimension never sets `SECURITY_BLOCKED`. A failing record gate is reported and recorded,
and routing proceeds (D-02). Nothing in this dimension may sit on the critical path of an unattended
run.

Show only the lines for the audits that ran. Display the `/clear` reminder.

</process>

<success_criteria>
- [ ] Scope resolved from flags (default all three; `--security`/`--validate`/`--records` narrow) and config gates
- [ ] Disabled-and-narrowed or all-disabled cases exit cleanly
- [ ] Shared phase-executed gate (no SUMMARY -> exit)
- [ ] Security: input state detected, threat register built, classified, user gate, auditor spawned, SECURITY.md created/updated
- [ ] Security: auditor output written as `${PADDED_PHASE}-SECURITY.md` (bare-name guard applied) so State-A re-runs work
- [ ] Security: threats_open > 0 BLOCKS advancement (no next-phase routing emitted)
- [ ] Validation: input state detected, requirement map + test infra built, gaps classified, user gate, auditor spawned, VALIDATION.md created/updated, test files committed separately
- [ ] Combined run records the validation result even when security blocks
- [ ] Records: input state detected (State A re-run appends, State B first run)
- [ ] Records: `verify gate {N} --write` run and `NN-RECORDS.md` written to the phase directory
- [ ] Records: verdict re-derived via `--read`; a `consistent: false` disagreement reports both values and the table wins
- [ ] Records: a failing or not-run record gate never blocks routing
- [ ] Results reflect only the audits that ran, with routing
</success_criteria>
