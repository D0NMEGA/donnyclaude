<purpose>
Retroactively audit a completed phase across two dimensions: security (threat mitigations recorded in the PLAN.md threat model are actually implemented) and validation (Nyquist test coverage for the phase's requirements). By default both audits run; `--security` or `--validate` narrows to one. Updates SECURITY.md and/or VALIDATION.md.
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
- No flag, or `--all` -> run BOTH audits (default).
- `--security` -> security audit only.
- `--validate` -> validation audit only.

```bash
SECURITY_CFG=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" config-get workflow.security_enforcement --raw 2>/dev/null || echo "true")
NYQUIST_CFG=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" config-get workflow.nyquist_validation --raw 2>/dev/null || echo "true")
```

Resolve `RUN_SECURITY` and `RUN_VALIDATE`:
- Default scope: `RUN_SECURITY` = (`SECURITY_CFG` != false); `RUN_VALIDATE` = (`NYQUIST_CFG` != false).
- `--security`: `RUN_VALIDATE`=false. If `SECURITY_CFG` is false, exit - "Security enforcement disabled. Enable via /donny-settings." Else `RUN_SECURITY`=true.
- `--validate`: `RUN_SECURITY`=false. If `NYQUIST_CFG` is false, exit - "Nyquist validation disabled. Enable via /donny-settings." Else `RUN_VALIDATE`=true.

If both `RUN_SECURITY` and `RUN_VALIDATE` are false (default scope, both configs disabled): exit - "Both security and Nyquist audits are disabled. Enable via /donny-settings."

**Phase-executed gate** (shared State C - applies to whichever audits run):

```bash
SUMMARY_FILES=$(ls "${PHASE_DIR}"/*-SUMMARY.md 2>/dev/null)
```

If `SUMMARY_FILES` is empty: exit - "Phase {N} not executed. Run /donny-execute-phase {N} first."

Display banner: `DONNY ► AUDIT PHASE {N}: {name}` (append the active scope: `security + validation`, `security only`, or `validation only`).

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

**Run this part only if `RUN_VALIDATE` is true.** Otherwise skip to Commit.

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

## Commit

```bash
# Validation only: stage any generated test files first.
[ -n "{generated_test_files}" ] && git add {test_files} && git commit -m "test(phase-${PHASE}): add Nyquist validation tests"

node "$HOME/.claude/donny/bin/donny-tools.cjs" commit "docs(phase-${PHASE}): audit security and validation"
```

(Scope the commit message to whichever audits ran: `audit security`, `audit validation`, or `audit security and validation`.)

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
▶ /donny-verify-work {N}        run UAT
▶ /donny-audit-milestone ${DONNY_WS}   when the milestone is done
```

Show only the lines for the audits that ran. Display the `/clear` reminder.

</process>

<success_criteria>
- [ ] Scope resolved from flags (default both; `--security`/`--validate` narrow) and config gates
- [ ] Disabled-and-narrowed or both-disabled cases exit cleanly
- [ ] Shared phase-executed gate (no SUMMARY -> exit)
- [ ] Security: input state detected, threat register built, classified, user gate, auditor spawned, SECURITY.md created/updated
- [ ] Security: auditor output written as `${PADDED_PHASE}-SECURITY.md` (bare-name guard applied) so State-A re-runs work
- [ ] Security: threats_open > 0 BLOCKS advancement (no next-phase routing emitted)
- [ ] Validation: input state detected, requirement map + test infra built, gaps classified, user gate, auditor spawned, VALIDATION.md created/updated, test files committed separately
- [ ] Combined run records the validation result even when security blocks
- [ ] Results reflect only the audits that ran, with routing
</success_criteria>
