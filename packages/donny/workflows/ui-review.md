<purpose>
Retroactive 6-pillar visual audit of implemented frontend code. Standalone command that works on any project - Donny-managed or not. Produces scored UI-REVIEW.md with actionable findings.
</purpose>

<required_reading>
@$HOME/.claude/donny/references/ui-brand.md
</required_reading>

<available_agent_types>
Valid Donny subagent types (use exact names - do not fall back to 'general-purpose'):
- donny-ui-auditor - Audits UI against design requirements
</available_agent_types>

<process>

## 0. Initialize

```bash
INIT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" init phase-op "${PHASE_ARG}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
AGENT_SKILLS_UI_AUDITOR=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" agent-skills donny-ui-auditor 2>/dev/null)
```

Parse: `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `padded_phase`, `commit_docs`.

```bash
UI_AUDITOR_MODEL=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" resolve-model donny-ui-auditor --raw)
```

Check config:

```bash
UI_REVIEW_ENABLED=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" config-get workflow.ui_review 2>/dev/null || echo "true")
```

**If `UI_REVIEW_ENABLED` is `false`:**
```
UI review is disabled in config. Enable via /donny-settings.
```
Exit workflow.

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 DONNY ► UI AUDIT - PHASE {N}: {name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 1. Detect Input State

```bash
SUMMARY_FILES=$(ls "${PHASE_DIR}"/*-SUMMARY.md 2>/dev/null)
UI_SPEC_FILE=$(ls "${PHASE_DIR}"/*-UI-SPEC.md 2>/dev/null | head -1)
UI_REVIEW_FILE=$(ls "${PHASE_DIR}"/*-UI-REVIEW.md 2>/dev/null | head -1)
```

**If `SUMMARY_FILES` empty:** Exit - "Phase {N} not executed. Run /donny-execute-phase {N} first."

**If `UI_REVIEW_FILE` non-empty:** Use AskUserQuestion:
- header: "Existing UI Review"
- question: "UI-REVIEW.md already exists for Phase {N}."
- options:
  - "Re-audit - run fresh audit"
  - "View - display current review and exit"

If "View": display file, exit.
If "Re-audit": continue.

## 2. Gather Context Paths

Build file list for auditor:
- All SUMMARY.md files in phase dir
- All PLAN.md files in phase dir
- UI-SPEC.md (if exists - audit baseline)
- CONTEXT.md (if exists - locked decisions)

## 3. Spawn donny-ui-auditor

```
◆ Spawning UI auditor...
```

Build prompt:

```markdown
Read $HOME/.claude/agents/donny-ui-auditor.md for instructions.

<objective>
Conduct 6-pillar visual audit of Phase {phase_number}: {phase_name}
{If UI-SPEC exists: "Audit against UI-SPEC.md design contract."}
{If no UI-SPEC: "Audit against abstract 6-pillar standards."}
</objective>

<files_to_read>
- {summary_paths} (Execution summaries)
- {plan_paths} (Execution plans - what was intended)
- {ui_spec_path} (UI Design Contract - audit baseline, if exists)
- {context_path} (User decisions, if exists)
</files_to_read>

${AGENT_SKILLS_UI_AUDITOR}

<config>
phase_dir: {phase_dir}
padded_phase: {padded_phase}
</config>
```

Omit null file paths.

```
Task(
  prompt=ui_audit_prompt,
  subagent_type="donny-ui-auditor",
  model="{UI_AUDITOR_MODEL}",
  description="UI Audit Phase {N}"
)
```

The auditor captures screenshots via Playwright-MCP when those tools are available
in the session, and falls back to a CLI / code-only audit otherwise. That logic
lives in `donny-ui-auditor.md`; the orchestrator does not duplicate it.

## 4. Handle Return

**If `## UI REVIEW COMPLETE`:**

Read the auditor's verdict deterministically from UI-REVIEW.md - the auditor writes an exact frontmatter contract for this, so do not reprint the overall score/verdict from its prose banner:

```bash
REVIEW=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" verify ui-reviewed "${PHASE_DIR}")
```

Returns `{ status, score, baseline, phase }` (status `PASS|FAIL|PARTIAL`, score `N/24`, baseline `spec|abstract`; `status: missing` means no UI-REVIEW.md was written - report that the audit produced no contract and stop). Use the parsed `status` and `score` as the source of truth for the summary below. The per-pillar rows and top fixes still come from the auditor's report body, but the overall score and verdict are the parsed values, never the agent's prose.

Display score summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 DONNY ► UI AUDIT COMPLETE ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Phase {N}: {Name}** - Verdict: {status from REVIEW} - Overall: {score from REVIEW}

| Pillar | Score |
|--------|-------|
| Copywriting | {N}/4 |
| Visuals | {N}/4 |
| Color | {N}/4 |
| Typography | {N}/4 |
| Spacing | {N}/4 |
| Registry and Experience | {N}/4 |

Top fixes:
1. {fix}
2. {fix}
3. {fix}

Full review: {path to UI-REVIEW.md}

_Informational audit: it does not gate the next phase (unlike /donny-ui-phase, which blocks planning on a BLOCK verdict)._

───────────────────────────────────────────────────────────────

## ▶ Next

`/clear` then one of:

- `/donny-verify-work {N}` - UAT testing
- `/donny-plan-phase {N+1}` - plan next phase

───────────────────────────────────────────────────────────────
```

## 5. Commit (if configured)

```bash
node "$HOME/.claude/donny/bin/donny-tools.cjs" commit "docs(${padded_phase}): UI audit review" --files "${PHASE_DIR}/${PADDED_PHASE}-UI-REVIEW.md"
```

## 6. Update State

```bash
node "$HOME/.claude/donny/bin/donny-tools.cjs" state record-session \
  --stopped-at "Phase ${PHASE} UI audit complete" \
  --resume-file "${PHASE_DIR}/${PADDED_PHASE}-UI-REVIEW.md"
```

</process>

<success_criteria>
- [ ] Config checked (exit if ui_review disabled)
- [ ] Phase validated
- [ ] SUMMARY.md files found (execution completed)
- [ ] Existing review handled (re-audit/view)
- [ ] donny-ui-auditor spawned with correct context (agent-skills key matches the auditor)
- [ ] UI-REVIEW.md created in phase directory
- [ ] Score summary displayed to user
- [ ] Next steps presented
- [ ] State updated (record-session)
</success_criteria>
