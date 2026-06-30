<purpose>
Verify milestone achieved its definition of done by aggregating phase verifications, checking cross-phase integration, and assessing requirements coverage. Reads existing VERIFICATION.md files (phases already verified during execute-phase), aggregates tech debt and deferred gaps, then spawns integration checker for cross-phase wiring.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<available_agent_types>
Valid Donny subagent types (use exact names - do not fall back to 'general-purpose'):
- donny-integration-checker - Checks cross-phase integration
</available_agent_types>

<process>

## 0. Initialize Milestone Context

```bash
INIT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" init milestone-op)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
AGENT_SKILLS_CHECKER=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" agent-skills donny-integration-checker 2>/dev/null)
```

Extract from init JSON: `milestone_version`, `milestone_name`, `phase_count`, `completed_phases`, `commit_docs`.

Resolve integration checker model:
```bash
integration_checker_model=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" resolve-model donny-integration-checker --raw)
```

## 1. Determine Milestone Scope

```bash
# Get phases in milestone (sorted numerically, handles decimals)
node "$HOME/.claude/donny/bin/donny-tools.cjs" phases list
```

- Parse version from arguments or detect current from ROADMAP.md
- Identify all phase directories in scope
- Extract milestone definition of done from ROADMAP.md
- Extract requirements mapped to this milestone from REQUIREMENTS.md

## 2. Read All Phase Verifications

For each phase directory, read the VERIFICATION.md:

```bash
# For each phase, use find-phase to resolve the directory (handles archived phases)
PHASE_INFO=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" find-phase 01 --raw)
# Extract directory from JSON, then read VERIFICATION.md from that directory
# Repeat for each phase number from ROADMAP.md
```

From each VERIFICATION.md, extract:
- **Status:** passed | gaps_found
- **Critical gaps:** (if any - these are blockers)
- **Non-critical gaps:** tech debt, deferred items, warnings
- **Anti-patterns found:** TODOs, stubs, placeholders
- **Requirements coverage:** which requirements satisfied/blocked

If a phase is missing VERIFICATION.md, flag it as "unverified phase" - this is a blocker.

## 3. Spawn Integration Checker

With phase context collected:

Extract `MILESTONE_REQ_IDS` from REQUIREMENTS.md traceability table - all REQ-IDs assigned to phases in this milestone.

```
Task(
  prompt="Check cross-phase integration and E2E flows.

Phases: {phase_dirs}
Phase exports: {from SUMMARYs}
API routes: {routes created}

Milestone Requirements:
{MILESTONE_REQ_IDS - list each REQ-ID with description and assigned phase}

MUST map each integration finding to affected requirement IDs where applicable.

Verify cross-phase wiring and E2E user flows.
${AGENT_SKILLS_CHECKER}",
  subagent_type="donny-integration-checker",
  model="{integration_checker_model}"
)
```

## 4. Collect Results

Combine:
- Phase-level gaps and tech debt (from step 2)
- Integration checker's report (wiring gaps, broken flows)

## 5. Check Requirements Coverage (3-Source Cross-Reference)

MUST cross-reference three independent sources for each requirement:

### 5a. Parse REQUIREMENTS.md Traceability Table

Extract all REQ-IDs mapped to milestone phases from the traceability table:
- Requirement ID, description, assigned phase, current status, checked-off state (`[x]` vs `[ ]`)

### 5b. Parse Phase VERIFICATION.md Requirements Tables

For each phase's VERIFICATION.md, extract the expanded requirements table:
- Requirement | Source Plan | Description | Status | Evidence
- Map each entry back to its REQ-ID

### 5c. Extract SUMMARY.md Frontmatter Cross-Check

For each phase's SUMMARY.md, extract `requirements-completed` from YAML frontmatter:
```bash
for summary in .planning/phases/*-*/*-SUMMARY.md; do
  [ -e "$summary" ] || continue
  node "$HOME/.claude/donny/bin/donny-tools.cjs" summary-extract "$summary" --fields requirements_completed --pick requirements_completed
done
```

### 5d. Status Determination Matrix

**Deterministic backstop (engine-enforced).** Before applying the matrix by hand, compute it deterministically:

```bash
COVERAGE=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" verify milestone-coverage)
```

Returns `{ gate, counts: { satisfied, partial, unsatisfied, orphaned }, requirements: [{ id, phase, status, orphaned, needs_checkbox_update }] }`. It applies the matrix below to every REQ-ID parsed from REQUIREMENTS.md (checkbox state + traceability phase) against each phase's VERIFICATION verdict (the same `phaseVerificationVerdict` ship's gate trusts) and the union of SUMMARY `requirements-completed`. A `gate: unknown` means the engine could not parse REQUIREMENTS.md - fall back to the manual pass. Otherwise this is the authoritative coverage result and your 3-source cross-reference is a check on it: if the two disagree, the stricter verdict (more `unsatisfied`) wins, so neither a parser miss nor an LLM misread can pass a gap.

For each REQ-ID, determine status using all three sources:

| VERIFICATION.md Status | SUMMARY Frontmatter | REQUIREMENTS.md | -> Final Status |
|------------------------|---------------------|-----------------|----------------|
| passed                 | listed              | `[x]`           | **satisfied**  |
| passed                 | listed              | `[ ]`           | **satisfied** (update checkbox) |
| passed                 | missing             | any             | **partial** (verify manually) |
| gaps_found             | any                 | any             | **unsatisfied** |
| missing                | listed              | any             | **partial** (verification gap) |
| missing                | missing             | any             | **unsatisfied** |

### 5e. FAIL Gate and Orphan Detection

**REQUIRED:** Any `unsatisfied` requirement MUST force `gaps_found` status on the milestone audit. The engine's `gate` field already encodes this (`gaps_found` when `counts.unsatisfied > 0`); adopt it, taking the stricter of the engine and manual verdicts.

**Orphan detection:** The engine flags `orphaned: true` for any requirement assigned to no existing phase directory - a structural proxy for "never built, never verified" - and counts it `unsatisfied`. The engine deliberately does NOT text-scan VERIFICATION.md for REQ-IDs (a satisfied requirement described in prose rather than by ID would be falsely flagged). So also apply the literal rule by hand: a requirement in the traceability table whose assigned phase exists but whose REQ-ID appears in no phase VERIFICATION.md is orphaned too - add any such to the unsatisfied set.

## 5.5. Nyquist Compliance Discovery

Skip if `workflow.nyquist_validation` is explicitly `false` (absent = enabled).

```bash
NYQUIST_CONFIG=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" config-get workflow.nyquist_validation --raw 2>/dev/null)
```

If `false`: skip entirely.

For each phase directory, check `*-VALIDATION.md`. If exists, parse frontmatter (`nyquist_compliant`, `wave_0_complete`).

Classify per phase:

| Status | Condition |
|--------|-----------|
| COMPLIANT | `nyquist_compliant: true` and all tasks green |
| PARTIAL | VALIDATION.md exists, `nyquist_compliant: false` or red/pending |
| MISSING | No VALIDATION.md |

Add to audit YAML: `nyquist: { compliant_phases, partial_phases, missing_phases, overall }`

Discovery only - never auto-calls `/donny-audit-phase`.

## 6. Aggregate into v{version}-MILESTONE-AUDIT.md

Create `.planning/v{version}-MILESTONE-AUDIT.md` with:

```yaml
---
milestone: {version}
audited: {timestamp}
status: passed | gaps_found | tech_debt
scores:
  requirements: N/M
  phases: N/M
  integration: N/M
  flows: N/M
gaps:  # Critical blockers
  requirements:
    - id: "{REQ-ID}"
      status: "unsatisfied | partial | orphaned"
      phase: "{assigned phase}"
      claimed_by_plans: ["{plan files that reference this requirement}"]
      completed_by_plans: ["{plan files whose SUMMARY marks it complete}"]
      verification_status: "passed | gaps_found | missing | orphaned"
      evidence: "{specific evidence or lack thereof}"
  integration: [...]
  flows: [...]
tech_debt:  # Non-critical, deferred
  - phase: 01-auth
    items:
      - "TODO: add rate limiting"
      - "Warning: no password strength validation"
  - phase: 03-dashboard
    items:
      - "Deferred: mobile responsive layout"
---
```

Plus full markdown report with tables for requirements, phases, integration, tech debt.

**Status values:**
- `passed` - all requirements met, no critical gaps, minimal tech debt
- `gaps_found` - critical blockers exist
- `tech_debt` - no blockers but accumulated deferred items need review

## 7. Present Results

Route by status (see `<offer_next>`).

</process>

<offer_next>
Output this markdown directly (not as a code block). Route based on status:

---

**If passed:**

## ✓ Milestone {version} - Audit Passed

**Score:** {N}/{M} requirements satisfied
**Report:** .planning/v{version}-MILESTONE-AUDIT.md

All requirements covered. Cross-phase integration verified. E2E flows complete.

───────────────────────────────────────────────────────────────

## ▶ Next Up

**Complete milestone** - archive and tag

/clear then:

/donny-complete-milestone {version}

───────────────────────────────────────────────────────────────

---

**If gaps_found:**

## ⚠ Milestone {version} - Gaps Found

**Score:** {N}/{M} requirements satisfied
**Report:** .planning/v{version}-MILESTONE-AUDIT.md

### Unsatisfied Requirements

{For each unsatisfied requirement:}
- **{REQ-ID}: {description}** (Phase {X})
  - {reason}

### Cross-Phase Issues

{For each integration gap:}
- **{from} -> {to}:** {issue}

### Broken Flows

{For each flow gap:}
- **{flow name}:** breaks at {step}

### Nyquist Coverage

| Phase | VALIDATION.md | Compliant | Action |
|-------|---------------|-----------|--------|
| {phase} | exists/missing | true/false/partial | `/donny-audit-phase {N}` |

Phases needing validation: run `/donny-audit-phase {N}` for each flagged phase.

───────────────────────────────────────────────────────────────

## ▶ Next Up

**Plan gap closure** - create phases to complete milestone

/clear then:

/donny-plan-milestone-gaps

───────────────────────────────────────────────────────────────

**Also available:**
- cat .planning/v{version}-MILESTONE-AUDIT.md - see full report
- /donny-complete-milestone {version} - proceed anyway (accept tech debt)

───────────────────────────────────────────────────────────────

---

**If tech_debt (no blockers but accumulated debt):**

## ⚡ Milestone {version} - Tech Debt Review

**Score:** {N}/{M} requirements satisfied
**Report:** .planning/v{version}-MILESTONE-AUDIT.md

All requirements met. No critical blockers. Accumulated tech debt needs review.

### Tech Debt by Phase

{For each phase with debt:}
**Phase {X}: {name}**
- {item 1}
- {item 2}

### Total: {N} items across {M} phases

───────────────────────────────────────────────────────────────

## ▶ Options

**A. Complete milestone** - accept debt, track in backlog

/donny-complete-milestone {version}

**B. Plan cleanup phase** - address debt before completing

/clear then:

/donny-plan-milestone-gaps

───────────────────────────────────────────────────────────────
</offer_next>

<success_criteria>
- [ ] Milestone scope identified
- [ ] All phase VERIFICATION.md files read
- [ ] SUMMARY.md `requirements-completed` frontmatter extracted for each phase
- [ ] REQUIREMENTS.md traceability table parsed for all milestone REQ-IDs
- [ ] Deterministic coverage computed (`verify milestone-coverage`) and reconciled with the manual pass (stricter wins)
- [ ] 3-source cross-reference completed (VERIFICATION + SUMMARY + traceability)
- [ ] Orphaned requirements detected (in traceability but absent from all VERIFICATIONs)
- [ ] Tech debt and deferred gaps aggregated
- [ ] Integration checker spawned with milestone requirement IDs
- [ ] v{version}-MILESTONE-AUDIT.md created with structured requirement gap objects
- [ ] FAIL gate enforced - any unsatisfied requirement forces gaps_found status
- [ ] Nyquist compliance scanned for all milestone phases (if enabled)
- [ ] Missing VALIDATION.md phases flagged with validate-phase suggestion
- [ ] Results presented with actionable next steps
</success_criteria>
