# Harness field test: targeted ECG submission harness on DanMLProject

**Status:** TEMPLATE — populated by the DanMLProject Claude Code session at the end of its next work cycle.
**Harness committed:** 2026-04-24 by donnyclaude session (ECG harness build, see `~/Desktop/DanMLProject/.claude/`)
**Project under test:** UT 214L ECG AFib Classifier (`~/Desktop/DanMLProject/`)
**Submission deadline window:** 2026-04-27 (bonus) / 2026-04-29 (hard)

---

## Why this exists

This file is the **outcome-side** complement to AHOL's V0/V4 spike data (`SPIKE-VERDICT-RETRY.md`, `ABLATION-V1-V2-V3.md`). AHOL measures harness cost vs benefit on synthetic SWE-bench-style patch tasks. This file measures the same thing on a **real, non-synthetic, deadline-driven** task (a UT class assignment). Together they triangulate whether targeted harnesses (small `.claude/` trees scoped to actual project risk) outperform either bare-baseline (V0) or full-donnyclaude (V4) for real work.

The harness installed at `~/Desktop/DanMLProject/.claude/` contains:

- 1 `settings.json`
- 2 PreToolUse hooks (`verify-contract.py`, `keras-save-format-guard.py`)
- 3 skills (`keras3-serialization-gotchas`, `ecg-grading-contract`, `rationale-pdf-prep`)
- 1 agent (`submission-reviewer`)

Total: 7 files. Should add <10% token overhead vs bare baseline (extrapolated from AHOL's V3 data: single-hook variants ran at 0.98-1.05× V0 cost).

## What the field-test session is asked to record

The DanMLProject Claude Code session will be given a prompt that asks it to use the harness for any pre-submission verification work and then write to **this file** (Edit, not Write — preserve the template structure) before /exit. Expected sections:

### Session metadata

| Field | Value |
|-------|-------|
| Session start time (Central) | _populated by DanMLProject session_ |
| Session end time (Central) | _populated_ |
| Wall-clock duration (min) | _populated_ |
| Approximate tokens consumed | _populated, from /usage if available_ |
| Final action taken | _e.g. "verified PDF + uploaded to Canvas" / "ran V3 model" / "stopped to wait for user input"_ |

### Hook fires (data-collection signal)

For each hook, record: invocations / blocks / false positives.

| Hook | Tool | Total fires | Blocks (legitimate) | False positives (overrode) | Notes |
|------|------|-------------|---------------------|----------------------------|-------|
| verify-contract.py | Edit/Write/MultiEdit | _populated_ | _populated_ | _populated_ | _populated_ |
| keras-save-format-guard.py | Bash | _populated_ | _populated_ | _populated_ | _populated_ |

A "block (legitimate)" is one where the hook's blocking output was correct and the agent fixed the underlying problem. A "false positive" is one where the agent had to override or re-issue the call to work around the hook because the hook misjudged. False positives are the failure mode that matters most for harness design.

### Skill invocations

| Skill | Times referenced/loaded | Used for | Verdict (helpful / neutral / distracting) |
|-------|------------------------|----------|--------------------------------------------|
| keras3-serialization-gotchas | _populated_ | _populated_ | _populated_ |
| ecg-grading-contract | _populated_ | _populated_ | _populated_ |
| rationale-pdf-prep | _populated_ | _populated_ | _populated_ |

### Agent invocations

| Agent | Times spawned | Findings produced | Verdict |
|-------|---------------|--------------------|---------|
| submission-reviewer | _populated_ | _populated_ | _populated_ |

### Risks the harness caught

Free-text. Anything where the harness prevented an actual mistake. e.g. "Hook blocked an attempted Edit that would have removed the `val_features=None` default; that would have broken the grader's positional call."

### Risks the harness missed

Free-text. Anything that went wrong despite the harness, OR things the harness should have caught but didn't.

### Cost-vs-benefit assessment (subjective)

A short paragraph from the session-side agent's perspective: was this harness net positive, net neutral, or net negative for the work that happened in this session? Compare to the alternative of working with bare global ~/.claude/ only.

### What to change in the harness next time

Free-text. Specific recommendations for v2 of this harness.

---

## Cross-reference to AHOL data

When this report is populated, append the following section so the data can be analyzed alongside AHOL rounds:

| AHOL data point | This field test |
|------------------|-----------------|
| V0 SWE-bench resolved rate (retry): 9/10 | _per-rubric-item self-assessment_ |
| V4 SWE-bench resolved rate: 8/10 | _per-rubric-item self-assessment_ |
| V0 → V4 cost ratio: 1.56× | _harness vs bare-baseline cost ratio if estimable_ |
| V3 (single hook): 0.98× cost, 8/10 pass | _comparable single-hook signature here_ |

## Filing instruction for the DanMLProject session

After populating this file, commit it in donnyclaude (this repo, not the DanMLProject repo) with a message like:

```
data(ahol): field-test report from DanMLProject submission cycle
```

Do NOT commit it in DanMLProject. The harness lives in DanMLProject; the data lives here. Keeps the experiment data centralized for AHOL analysis.

---

*Template generated 2026-04-24 by donnyclaude session.*
