<purpose>
Cross-AI peer review - invoke external AI CLIs to independently review phase plans.
Each CLI gets the same prompt (PROJECT.md context, phase plans, requirements) and
produces structured feedback. Results are combined into REVIEWS.md for the planner
to incorporate via --reviews flag.

This implements adversarial review: different AI models catch different blind spots.
A plan that survives review from 2-3 independent AI systems is more robust.
</purpose>

<process>

<step name="detect_clis">
Check which AI CLIs are available on the system:

```bash
# Check each CLI
command -v gemini >/dev/null 2>&1 && echo "gemini:available" || echo "gemini:missing"
command -v claude >/dev/null 2>&1 && echo "claude:available" || echo "claude:missing"
command -v codex >/dev/null 2>&1 && echo "codex:available" || echo "codex:missing"
command -v coderabbit >/dev/null 2>&1 && echo "coderabbit:available" || echo "coderabbit:missing"
command -v opencode >/dev/null 2>&1 && echo "opencode:available" || echo "opencode:missing"
```

Parse flags from `$ARGUMENTS`:
- `--gemini` -> include Gemini
- `--claude` -> include Claude
- `--codex` -> include Codex
- `--coderabbit` -> include CodeRabbit
- `--opencode` -> include OpenCode
- `--all` -> include all available
- No flags -> include all available

If no CLIs are available:
```
No external AI CLIs found. Install at least one:
- gemini: https://github.com/google-gemini/gemini-cli
- codex: https://github.com/openai/codex
- claude: https://github.com/anthropics/claude-code
- opencode: https://opencode.ai (leverages GitHub Copilot subscription models)

Then run /donny-review again.
```
Exit.

If only one CLI is the current runtime (e.g. running inside Claude), skip it for the review
to ensure independence. At least one DIFFERENT CLI must be available.
</step>

<step name="resolve_phase">
Parse the phase from `$ARGUMENTS`:
- If `--phase N` is present, use `N` as `PHASE_ARG`.
- **If no `--phase` is given, default to the current phase** - read `.planning/STATE.md` and use the
  active phase number recorded there. Do not require the user to pass `--phase`.
- If neither a flag nor STATE.md yields a phase, ask the user which phase to review.
</step>

<step name="gather_context">
Collect phase artifacts for the review prompt:

```bash
INIT=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" init phase-op "${PHASE_ARG}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Read from init: `phase_dir`, `phase_number`, `padded_phase`.

Then read:
1. `.planning/PROJECT.md` (first 80 lines - project context)
2. Phase section from `.planning/ROADMAP.md`
3. All `*-PLAN.md` files in the phase directory
4. `*-CONTEXT.md` if present (user decisions)
5. `*-RESEARCH.md` if present (domain research)
6. `.planning/REQUIREMENTS.md` (requirements this phase addresses)
</step>

<step name="build_prompt">
Build a structured review prompt:

```markdown
# Cross-AI Plan Review Request

You are reviewing implementation plans for a software project phase.
Provide structured feedback on plan quality, completeness, and risks.

## Project Context
{first 80 lines of PROJECT.md}

## Phase {N}: {phase name}
### Roadmap Section
{roadmap phase section}

### Requirements Addressed
{requirements for this phase}

### User Decisions (CONTEXT.md)
{context if present}

### Research Findings
{research if present}

### Plans to Review
{all PLAN.md contents}

## Review Instructions

Analyze each plan and provide:

1. **Summary** - One-paragraph assessment
2. **Strengths** - What's well-designed (bullet points)
3. **Concerns** - Potential issues, gaps, risks (bullet points with severity: HIGH/MEDIUM/LOW)
4. **Suggestions** - Specific improvements (bullet points)
5. **Risk Assessment** - Overall risk level (LOW/MEDIUM/HIGH) with justification

Focus on:
- Missing edge cases or error handling
- Dependency ordering issues
- Scope creep or over-engineering
- Security considerations
- Performance implications
- Whether the plans actually achieve the phase goals

Output your review in markdown format.
```

Write to a temp file: `/tmp/donny-review-prompt-{phase}.md`
</step>

<step name="invoke_reviewers">
For each selected CLI, invoke in sequence (not parallel - avoid rate limits):

**Gemini:**
```bash
gemini -p "$(cat /tmp/donny-review-prompt-{phase}.md)" 2>/dev/null > /tmp/donny-review-gemini-{phase}.md
```

**Claude (separate session):**
```bash
claude -p "$(cat /tmp/donny-review-prompt-{phase}.md)" --no-input 2>/dev/null > /tmp/donny-review-claude-{phase}.md
```

**Codex:**
```bash
CODEX_STATUS=$(node "$HOME/.claude/donny/bin/donny-tools.cjs" codex run \
  --prompt-file /tmp/donny-review-prompt-{phase}.md \
  --verdict-out /tmp/donny-review-codex-{phase}.md \
  --cd "$(pwd)" \
  --pick status)
echo "codex: $CODEX_STATUS"
```

Codex is the one reviewer that goes through an owned contract rather than a bare shell line
(SEAM-02). The contract closes stdin, applies the `workflow.codex_timeout` bound, pins the sandbox
to `read-only`, passes `--ignore-user-config`, and reads the verdict from the
`-o/--output-last-message` file rather than stdout. Do NOT send stderr to /dev/null here: the
discarded stderr is how the previous version hid an indefinite hang, and the contract's warnings
are meant to be seen.

`$CODEX_STATUS` is one of `ok`, `auth`, `quota`, `timeout`, `empty` or `nonzero`.
`/tmp/donny-review-codex-{phase}.md` is written ONLY when the status is `ok`, and it is removed
before the call, so an absent file means no review exists rather than an empty one. Carry the
status into the `write_reviews` step.

**CodeRabbit:**

Note: CodeRabbit reviews the current git diff/working tree - it does not accept a prompt. It may take up to 5 minutes. Use `timeout: 360000` on the Bash tool call.

```bash
coderabbit review --prompt-only 2>/dev/null > /tmp/donny-review-coderabbit-{phase}.md
```

**OpenCode (via GitHub Copilot):**
```bash
cat /tmp/donny-review-prompt-{phase}.md | opencode run - 2>/dev/null > /tmp/donny-review-opencode-{phase}.md
if [ ! -s /tmp/donny-review-opencode-{phase}.md ]; then
  echo "OpenCode review failed or returned empty output." > /tmp/donny-review-opencode-{phase}.md
fi
```

If a CLI fails, log the error and continue with remaining CLIs.

Display progress:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 DONNY ► CROSS-AI REVIEW - Phase {N}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Reviewing with {CLI}... done
- Reviewing with {CLI}... done
```
</step>

<step name="write_reviews">
Combine all review responses into `{phase_dir}/{padded_phase}-REVIEWS.md`:

Derive `reviewers` and `reviewer_status` from observation, never from the list of CLIs you intended
to run. For Codex, use the `status` the contract returned in `$CODEX_STATUS`. For each of the other
four, the file at `/tmp/donny-review-<name>-{phase}.md` is `ok` when it exists and is non-empty and
`empty` otherwise; the OpenCode block writes `OpenCode review failed or returned empty output.`
into its own output file, so a file holding only that sentence is `empty`, not `ok`. A CLI that
`detect_clis` reported missing is `cli_missing`; one that was available but not selected by the
flags is `not_selected`. Do not write a name into `reviewers` whose status is anything other than
`ok`.

Those four file-based statuses are weaker than the Codex one. They separate output from no output,
not one failure reason from another, so do not present all five reviewers as checked to the same
depth.

```markdown
---
phase: {N}
reviewers: [{reviewers that actually produced a review, in the order they ran}]
reviewer_status:
  {name}: {ok | auth | quota | timeout | empty | nonzero | not_selected | cli_missing}
reviewed_at: {ISO timestamp}
plans_reviewed: [{list of PLAN.md files}]
---

# Cross-AI Plan Review - Phase {N}

## Gemini Review

**Status:** {status}

{gemini review content, or the not-run note}

---

## Claude Review

**Status:** {status}

{claude review content, or the not-run note}

---

## Codex Review

**Status:** {status}

{codex review content, or the not-run note}

---

## CodeRabbit Review

**Status:** {status}

{coderabbit review content, or the not-run note}

---

## OpenCode Review

**Status:** {status}

{opencode review content, or the not-run note}

---

## Consensus Summary

Consensus over {reviewers with status ok} of {reviewers considered} reviewers. Consensus is
computed over the reviewers whose status is `ok`. A reviewer that did not run is not evidence of
agreement, and the count of participating reviewers is stated so a two-reviewer consensus is not
read as a five-reviewer one.

{synthesize common concerns across the reviewers whose status is ok}

### Agreed Strengths
{strengths mentioned by 2+ reviewers}

### Agreed Concerns
{concerns raised by 2+ reviewers - highest priority}

### Divergent Views
{where reviewers disagreed - worth investigating}
```

A reviewer whose status is not `ok` gets the reason in place of content, never a blank section.
For Codex the reason is the contract's status and its `terminal_message`:

```
No review produced. Status `{status}`. {terminal_message}
```

For the other four the only available signal is whether the output file has content, so the note
claims that much and no more:

```
No review produced. Status `empty`. This reviewer is still invoked through a bare shell line with
stderr discarded (a deferred defect at review.md lines 134, 139, 169 and 174), so no reason is
available. Only Codex reports a distinguishable failure reason today.
```

Naming the deferred defect in the artifact the operator reads, rather than only in a planning
document, is how it gets fixed rather than forgotten.

Commit:
```bash
node "$HOME/.claude/donny/bin/donny-tools.cjs" commit "docs: cross-AI review for phase {N}" --files {phase_dir}/{padded_phase}-REVIEWS.md
```
</step>

<step name="present_results">
Display summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 DONNY ► REVIEW COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phase {N} reviewed by {count} AI systems.

Consensus concerns:
{top 3 shared concerns}

Full review: {padded_phase}-REVIEWS.md

To incorporate feedback into planning:
  /donny-plan-phase {N} --reviews
```

Clean up temp files.
</step>

</process>

<success_criteria>
- [ ] At least one external CLI invoked successfully
- [ ] REVIEWS.md written with structured feedback
- [ ] Consensus summary synthesized from multiple reviewers
- [ ] Temp files cleaned up
- [ ] User knows how to use feedback (/donny-plan-phase --reviews)
</success_criteria>
