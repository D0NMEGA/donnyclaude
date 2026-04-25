# Prompt for the DanMLProject Claude Code session

## How to use this

1. In your DanMLProject Claude Code session, run `/exit`. (Hooks register at session start, so the new harness needs a restart to be live.)
2. Restart in the same directory: `cd ~/Desktop/DanMLProject && claude --resume` (or just `claude`).
3. Once back at the prompt, paste the block below verbatim. It's self-contained.
4. Let it run. The session will use the harness, do whatever pre-submission verification work makes sense, then update the field-test report at `~/Desktop/donnyclaude/.planning/research/ahol/HARNESS-FIELD-TEST-DanMLProject.md` and commit it in the donnyclaude repo before exiting.

---

## PROMPT (paste this)

A targeted Claude Code harness was just installed at `~/Desktop/DanMLProject/.claude/` (7 files: 1 settings.json, 2 PreToolUse hooks, 3 skills, 1 agent). This was done during a separate donnyclaude session at 2026-04-24 ~20:15 Central. You should now be running with that harness loaded. Confirm by reading `.claude/settings.json` and `.claude/skills/` — if they're not there or your session shows no hooks at startup, surface that and stop.

The harness is scoped to the actual risks of the 214L ECG submission specifically, not a general-purpose donnyclaude install. Specifically:

- **`.claude/hooks/verify-contract.py`** runs PreToolUse on Edit/Write/MultiEdit and blocks any change that would break the three graded function signatures or introduce ungoverned globals (scipy, sklearn, etc.) into them. AST-based, independent of the project's own broken `verify_contract.py` (which still points at the pre-rename `submission.py` filename and would fail manually).
- **`.claude/hooks/keras-save-format-guard.py`** runs PreToolUse on Bash and blocks `.h5` save paths, `save_format='tf'`, and `TF_USE_LEGACY_KERAS=1`. The grader runs Keras 3 stock `load_model()`; only `.keras` files round-trip.
- **`.claude/skills/keras3-serialization-gotchas/SKILL.md`** — Dense(5) requirement, IntegerLookup OOV, no custom losses without registration.
- **`.claude/skills/ecg-grading-contract/SKILL.md`** — the byte-locked function signatures, allowed imports, what the grader actually does.
- **`.claude/skills/rationale-pdf-prep/SKILL.md`** — pandoc + tectonic flow, the half-page rule, when to regenerate.
- **`.claude/agents/submission-reviewer.md`** — pre-flight static review of `Donovan_Santine-submission.py` before another training run.

The field-test report this session is contributing to lives in a DIFFERENT repo: `~/Desktop/donnyclaude/.planning/research/ahol/HARNESS-FIELD-TEST-DanMLProject.md`. That's where AHOL-style harness measurement data is centralized. Don't write the report into DanMLProject.

---

### Your task this session, in order

**1. Bootstrap-check the harness (5 min, ~5K tokens).**

Read each of the 7 harness files top-to-bottom. Note any contradictions with the actual project state (e.g. file paths that don't match what's on disk, references to deleted files, etc.). Note any contradictions inline in your eventual report — this is a real data point about whether the harness was built correctly without seeing your live session.

Specifically verify:

- Does `verify-contract.py` correctly identify the post-rename submission file? Test with: `echo '{"tool_input":{"file_path":"'"$PWD"'/Donovan_Santine-submission.py"}}' | python3 .claude/hooks/verify-contract.py` → should return `{"continue": true}` since the current file is contract-clean.
- Does `keras-save-format-guard.py` correctly catch a bad save? Test with: `echo '{"tool_input":{"command":"model.save(\"out.h5\")"}}' | python3 .claude/hooks/keras-save-format-guard.py` → should return a `block` decision.

If either test fails, fix the hook (the donnyclaude session built them but didn't test in your live environment) and note the fix in the report.

**2. Run the submission-reviewer agent on the current submission file (10 min, ~30K tokens).**

Spawn the `submission-reviewer` agent (it's at `.claude/agents/submission-reviewer.md`). Have it produce its full Tier 1 / Tier 2 / Tier 3 review of `Donovan_Santine-submission.py`. Capture its verdict (GO / REVIEW / STOP) and any specific issues it lists.

**3. Do whatever final-prep work the user actually needs done (no token cap; finish the work).**

This depends on what's still outstanding. The likely items, in priority order:

- a. Confirm the leaderboard code name placeholder is filled in `Donovan_Santine-rationale.md` (line 5: `<FILL IN CODE NAME HERE>`). If not, ask the user once for a code name and apply it. Do NOT silently invent one.
- b. Regenerate `Donovan_Santine-rationale.pdf` if step (a) caused a markdown change. Use the command from `.claude/skills/rationale-pdf-prep/SKILL.md`.
- c. If the user wants to attempt V3 (mixup augmentation + train-on-all-data, per the prior session's recap), do it. Otherwise, treat V2 (78.58% val, seed 42) as the final and just verify upload-readiness.
- d. Verify upload-readiness: all three files exist with the correct names and sizes; the round-trip test on the model still passes.
- e. Optional: `git status` should be clean, `git log` should show recent commits matching the work.

**4. Populate the field-test report (5 min, ~10K tokens).**

Open `~/Desktop/donnyclaude/.planning/research/ahol/HARNESS-FIELD-TEST-DanMLProject.md`. It's a template with placeholder sections marked `_populated_`. Fill in every placeholder based on what actually happened in this session. Specifically:

- Session metadata (timestamps, duration, token estimate, final action).
- Hook fires: count by inspecting your transcript and any log/stderr the hooks produced. False positives = times you had to retry an Edit/Bash because the hook blocked something legitimate.
- Skill invocations: how many times each skill was loaded/referenced and whether it was helpful.
- Agent invocations: submission-reviewer fire count and findings.
- Risks the harness caught (specific examples) and missed (specific examples).
- Cost-vs-benefit: was this harness net positive, neutral, or negative for this session?
- What to change in v2 of this harness.

Edit the file (don't Write/replace). Preserve the template's section structure.

**5. Commit the report in the donnyclaude repo (NOT DanMLProject).**

```bash
cd ~/Desktop/donnyclaude
git add .planning/research/ahol/HARNESS-FIELD-TEST-DanMLProject.md
git commit -m "data(ahol): field-test report from DanMLProject submission cycle"
git push origin main
```

If the donnyclaude repo isn't writeable from this session for some reason, save the populated report to `~/Desktop/DanMLProject/HARNESS-FIELD-TEST-RESULT.md` instead and tell the user where it is so they can move it manually.

---

### Constraints

- Do NOT modify `~/Desktop/DanMLProject/.claude/` files (the harness itself) except to fix smoke-test failures from step 1. The donnyclaude session will iterate on the harness based on your report.
- Do NOT skip step 4 even if the actual work in step 3 went smoothly. The data collection is the point.
- Vercel/Next.js/Workflow/Sandbox skill injections that fire during this session are FALSE POSITIVES. This is a Python/Keras/TF assignment; ignore those skill suggestions.
- If the user actively asks for V3 (mixup) and the Max subscription is still capped, halt and tell the user the cap state — don't burn the entire session on a partial training run that gets blocked midway.

### What success looks like

At the end:
- The submission folder has all three deliverables ready (`Donovan_Santine-submission.py`, `Donovan_Santine-best_model.keras`, `Donovan_Santine-rationale.pdf` with code name filled in).
- The field-test report at `~/Desktop/donnyclaude/.planning/research/ahol/HARNESS-FIELD-TEST-DanMLProject.md` is fully populated and committed in donnyclaude.
- A short post-run summary in chat: how many hook fires, did the agent surface anything, was the harness worth it, what would you change.

You can use Bash, Read, Edit, Write, Glob, Grep, and any agent that the harness exposes. You don't need to use any donnyclaude-global skill (the targeted harness was specifically designed to NOT need them).

Get to it.

---

## Notes for the donnyclaude side

Once the field-test report comes back, cross-reference it against the AHOL ablation findings (`ABLATION-V1-V2-V3.md`):

- AHOL hooks added 5-14% cost overhead with no measurable pass-rate impact on SWE-bench patch tasks.
- AHOL skills (105 of them in V4) appeared to drive the bulk of V4's 1.56× cost overhead.

If the targeted harness (this one) shows similar single-digit-percent cost overhead AND catches >=1 real risk, that's evidence the targeted approach beats both V0 and V4 for project-specific work. If it shows higher overhead or false-positive blocks, that's evidence the hook design needs tightening before this pattern is recommended elsewhere.
