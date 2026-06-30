<purpose>
Generate a UI design contract (UI-SPEC.md) for frontend phases. Orchestrates donny-ui-researcher and donny-ui-checker with a revision loop. Inserts between discuss-phase and plan-phase in the lifecycle.

UI-SPEC.md locks spacing, typography, color, copywriting, and design system decisions before the planner creates tasks. This prevents design debt caused by ad-hoc styling decisions during execution.
</purpose>

<required_reading>
@$HOME/.claude/donny/references/ui-brand.md
</required_reading>

<available_agent_types>
Valid Donny subagent types (use exact names - do not fall back to 'general-purpose'):
- donny-ui-researcher - Researches UI/UX approaches
- donny-ui-checker - Reviews UI implementation quality
</available_agent_types>

<process>

## 1. Initialize

```bash
INIT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" init plan-phase "$PHASE")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
AGENT_SKILLS_UI=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" agent-skills donny-ui-researcher 2>/dev/null)
AGENT_SKILLS_UI_CHECKER=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" agent-skills donny-ui-checker 2>/dev/null)
```

Parse JSON for: `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `padded_phase`, `has_context`, `has_research`, `commit_docs`.

**File paths:** `state_path`, `roadmap_path`, `requirements_path`, `context_path`, `research_path`.

Resolve UI agent models:

```bash
UI_RESEARCHER_MODEL=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" resolve-model donny-ui-researcher --raw)
UI_CHECKER_MODEL=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" resolve-model donny-ui-checker --raw)
```

Check config:

```bash
UI_ENABLED=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" config-get workflow.ui_phase 2>/dev/null || echo "true")
```

**If `UI_ENABLED` is `false`:**
```
UI phase is disabled in config. Enable via /donny-settings.
```
Exit workflow.

**If `planning_exists` is false:** Error - run `/donny-init` first.

## 2. Parse and Validate Phase

Extract phase number from $ARGUMENTS. If not provided, detect next unplanned phase.

```bash
PHASE_INFO=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" roadmap get-phase "${PHASE}")
```

**If `found` is false:** Error with available phases.

## 3. Check Prerequisites

**If `has_context` is false:**
```
No CONTEXT.md found for Phase {N}.
Recommended: run /donny-discuss-phase {N} first to capture design preferences.
Continuing without user decisions - UI researcher will ask all questions.
```
Continue (non-blocking).

**If `has_research` is false:**
```
No RESEARCH.md found for Phase {N}.
Note: stack decisions (component library, styling approach) will be asked during UI research.
```
Continue (non-blocking).

## 4. Check Existing UI-SPEC

```bash
UI_SPEC_FILE=$(ls "${PHASE_DIR}"/*-UI-SPEC.md 2>/dev/null | head -1)
```

**If exists:** Use AskUserQuestion:
- header: "Existing UI-SPEC"
- question: "UI-SPEC.md already exists for Phase {N}. What would you like to do?"
- options:
  - "Update - re-run researcher with existing as baseline"
  - "View - display current UI-SPEC and exit"
  - "Skip - keep current UI-SPEC, proceed to verification"

If "View": display file contents, exit.
If "Skip": proceed to step 7 (checker).
If "Update": continue to step 5.

## 5. Spawn donny-ui-researcher

Display:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 DONNY ► UI DESIGN CONTRACT - PHASE {N}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning UI researcher...
```

Build prompt:

```markdown
Read $HOME/.claude/agents/donny-ui-researcher.md for instructions.

<objective>
Create UI design contract for Phase {phase_number}: {phase_name}
Answer: "What visual and interaction contracts does this phase need?"
</objective>

<files_to_read>
- {state_path} (Project State)
- {roadmap_path} (Roadmap)
- {requirements_path} (Requirements)
- {context_path} (USER DECISIONS from /donny-discuss-phase)
- {research_path} (Technical Research - stack decisions)
</files_to_read>

${AGENT_SKILLS_UI}

<output>
Write to: {phase_dir}/{padded_phase}-UI-SPEC.md
Template: $HOME/.claude/donny/templates/UI-SPEC.md
</output>

<config>
commit_docs: {commit_docs}
phase_dir: {phase_dir}
padded_phase: {padded_phase}
</config>
```

Omit null file paths from `<files_to_read>`.

```
Task(
  prompt=ui_research_prompt,
  subagent_type="donny-ui-researcher",
  model="{UI_RESEARCHER_MODEL}",
  description="UI Design Contract Phase {N}"
)
```

## 6. Handle Researcher Return

**If `## UI-SPEC COMPLETE`:**
Before spending the checker, validate the spec's structure deterministically - a malformed or near-empty UI-SPEC must not drive planning:

```bash
UISPEC_VALID=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" frontmatter validate "${phase_dir}/${padded_phase}-UI-SPEC.md" --schema ui-spec)
```

Returns `{ valid, missing, empty, present }`. If `valid` is false, the researcher produced a structurally incomplete contract (the `missing` keys are absent, the `empty` keys are present but blank). Do NOT continue to the checker - route to the revision loop (the same path step 9 uses when the checker finds issues), passing the `missing`/`empty` fields as the revision request; abort only if a valid spec cannot be produced. If `valid` is true, display confirmation and continue to step 7.

**If `## UI-SPEC BLOCKED`:**
Display blocker details and options. Exit workflow.

## 7. Spawn donny-ui-checker

Display:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 DONNY ► VERIFYING UI-SPEC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning UI checker...
```

Build prompt:

```markdown
Read $HOME/.claude/agents/donny-ui-checker.md for instructions.

<objective>
Validate UI design contract for Phase {phase_number}: {phase_name}
Check all 6 dimensions. Return APPROVED or BLOCKED.
</objective>

<files_to_read>
- {phase_dir}/{padded_phase}-UI-SPEC.md (UI Design Contract - PRIMARY INPUT)
- {context_path} (USER DECISIONS - check compliance)
- {research_path} (Technical Research - check stack alignment)
</files_to_read>

${AGENT_SKILLS_UI_CHECKER}

<config>
ui_safety_gate: {ui_safety_gate config value}
</config>
```

```
Task(
  prompt=ui_checker_prompt,
  subagent_type="donny-ui-checker",
  model="{UI_CHECKER_MODEL}",
  description="Verify UI-SPEC Phase {N}"
)
```

## 8. Handle Checker Return

**If `## UI-SPEC VERIFIED`:**
Display dimension results. The checker is read-only and never edits UI-SPEC.md, so the orchestrator promotes the spec itself: use `Edit` to change the UI-SPEC.md frontmatter `status: draft` to `status: approved` and add a `reviewed_at: {ISO-8601 timestamp}` line. Then proceed to step 10.

**If `## ISSUES FOUND`:**
Display blocking issues. Proceed to step 9.

## 9. Revision Loop (Max 2 Iterations)

Track `revision_count` (starts at 0).

**If `revision_count` < 2:**
- Increment `revision_count`
- Re-spawn donny-ui-researcher with revision context:

```markdown
<revision>
The UI checker found issues with the current UI-SPEC.md.

### Issues to Fix
{paste blocking issues from checker return}

Read the existing UI-SPEC.md, fix ONLY the listed issues, re-write the file.
Do NOT re-ask the user questions that are already answered.
</revision>
```

- After researcher returns -> re-spawn checker (step 7)

**If `revision_count` >= 2:**
```
Max revision iterations reached. Remaining issues:

{list remaining issues}

Options:
1. Force approve - proceed with current UI-SPEC (FLAGs become accepted)
2. Edit manually - open UI-SPEC.md in editor, re-run /donny-ui-phase
3. Abandon - exit without approving
```

Use AskUserQuestion for the choice.

## 10. Present Final Status

Display:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 DONNY ► UI-SPEC READY ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Phase {N}: {Name}** - UI design contract approved

Dimensions: 6/6 passed
{If any FLAGs: "Recommendations: {N} (non-blocking)"}

───────────────────────────────────────────────────────────────

## ▶ Next Up

**Plan Phase {N}** - planner will use UI-SPEC.md as design context

`/clear` then:

`/donny-plan-phase {N}`

───────────────────────────────────────────────────────────────
```

## 11. Commit (if configured)

```bash
node "$HOME/.claude/donny/bin/donny-tools.cjs" commit "docs(${padded_phase}): UI design contract" --files "${PHASE_DIR}/${PADDED_PHASE}-UI-SPEC.md"
```

## 12. Update State

```bash
node "$HOME/.claude/donny/bin/donny-tools.cjs" state record-session \
  --stopped-at "Phase ${PHASE} UI-SPEC approved" \
  --resume-file "${PHASE_DIR}/${PADDED_PHASE}-UI-SPEC.md"
```

</process>

<success_criteria>
- [ ] Config checked (exit if ui_phase disabled)
- [ ] Phase validated against roadmap
- [ ] Prerequisites checked (CONTEXT.md, RESEARCH.md - non-blocking warnings)
- [ ] Existing UI-SPEC handled (update/view/skip)
- [ ] donny-ui-researcher spawned with correct context and file paths
- [ ] UI-SPEC.md created in correct location
- [ ] donny-ui-checker spawned with UI-SPEC.md
- [ ] All 6 dimensions evaluated
- [ ] Revision loop if BLOCKED (max 2 iterations)
- [ ] Final status displayed with next steps
- [ ] UI-SPEC.md committed (if commit_docs enabled)
- [ ] State updated
</success_criteria>
