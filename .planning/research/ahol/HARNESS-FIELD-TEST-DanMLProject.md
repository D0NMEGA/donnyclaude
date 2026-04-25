# Harness field test: targeted ECG submission harness on DanMLProject

**Status:** POPULATED 2026-04-24 by DanMLProject session post-harness-install.
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
| Session start time (Central) | 2026-04-24 ~20:22 CDT |
| Session end time (Central) | 2026-04-24 ~20:30 CDT (approx, before the report-write phase) |
| Wall-clock duration (min) | ~8 min interactive, plus report-write phase |
| Approximate tokens consumed | ~70K input + ~15K output. Largest single contributor: submission-reviewer agent (~32K of total tokens, single fire). Rest split between reading the 7 harness files (~12K), reading submission.py + rationale.md (~25K), 4 bash smoke tests, and report write (~15K output). |
| Final action taken | Static verification only — confirmed all 3 deliverables are upload-ready (`Donovan_Santine-{submission.py, best_model.keras, rationale.pdf}`). No model retrain. No PDF regen needed. User did NOT request V3. Session ended after report write + commit. |

### Hook fires (data-collection signal)

For each hook, record: invocations / blocks / false positives.

| Hook | Tool | Total fires | Blocks (legitimate) | False positives (overrode) | Notes |
|------|------|-------------|---------------------|----------------------------|-------|
| verify-contract.py | Edit/Write/MultiEdit | 2 | 0 | 0 | Fired on (a) the bash smoke test invocation against the current file (returned `{"continue": true}`, signature+globals clean) and (b) the field-test report Edit on the donnyclaude side, where the file_path was the wrong basename so it correctly passed through. No real Edits to submission.py occurred this session. **Untested in production conditions** — the high-value path (an actual Edit on submission.py that would break a signature) was not exercised. |
| keras-save-format-guard.py | Bash | 3 | 2 | 0 (with caveat below) | Fires: (1) `model.save("out.h5")` test → blocked, correct. (2) `model.save("out.keras")` test → passed, correct. (3) `export TF_USE_LEGACY_KERAS=1 && python train.py` test → blocked, correct on pattern. **Caveat on (3):** my intent was to test the hook itself, not actually set the env var. The hook can't disambiguate test-of-hook vs real-use. Counted as 0 false positives because the rule "block any literal `TF_USE_LEGACY_KERAS=1`" is correct in real-use context, but flagged as a class of true-positives-with-meta-FP-intent that any hook will produce when scaffolding/testing. |

A "block (legitimate)" is one where the hook's blocking output was correct and the agent fixed the underlying problem. A "false positive" is one where the agent had to override or re-issue the call to work around the hook because the hook misjudged. False positives are the failure mode that matters most for harness design.

**Important caveat on hook-fire count: this session was NOT a high-edit session.** The user had already finalized V2 and the work was static verification. Both hooks would see meaningfully more fires in a session that involved active iteration on `Donovan_Santine-submission.py` or active training/saving. The 5 fires above are mostly self-induced smoke tests, not organic protection events. **Generalize cautiously.**

### Skill invocations

| Skill | Times referenced/loaded | Used for | Verdict (helpful / neutral / distracting) |
|-------|------------------------|----------|--------------------------------------------|
| keras3-serialization-gotchas | 1 (referenced in submission-reviewer prompt + read end-to-end during bootstrap) | Confirmed Dense(5, softmax) + built-in loss requirement when inspecting the .keras config.json. The Dense(5)-vs-Dense(4) gotcha was the single most actionable item — it gave me an exact thing to grep for. | **Helpful.** Tight, project-specific. Trumped what I would have guessed from training data (which is correct about IntegerLookup defaults but doesn't connect them to "your Dense head must be 5 wide"). |
| ecg-grading-contract | 1 (referenced in submission-reviewer prompt + read end-to-end during bootstrap) | Defined the contract the submission-reviewer agent verified against. Without it the agent would have invented its own checklist. | **Helpful.** The "what the grader actually does" pseudocode + allowed-imports table compressed ~3 separate clarifying questions into a single-shot review. |
| rationale-pdf-prep | 0 active loads (only bootstrap-read) | Would have been used if a PDF regen was needed. PDF mtime (19:56) > MD mtime (19:50), so no regen required. | **Neutral this session, would-be-helpful in others.** The skill correctly identifies its own trigger conditions; none fired here. **Stale data inside it (see "Risks the harness missed" below)** — flag for v2. |

### Agent invocations

| Agent | Times spawned | Findings produced | Verdict |
|-------|---------------|--------------------|---------|
| submission-reviewer | 1 | All 5 Tier-1 checks PASS, both Tier-2 checks PASS, 2 Tier-3 informational items (no seeding inside `train_model`, patience values OK). Final verdict: **GO** — safe to upload. Specific note on the intentional `best_model.keras` → `Donovan_Santine-best_model.keras` filename rename was correctly identified as the manual-copy step, not a broken pipeline. Total tokens: ~32K. Wall clock: ~37s. | **High value.** This was the single best ROI artifact in the harness. Doing the same review by hand would have required ~5-8 Read calls + ~3-5 Grep calls + me holding the contract in my context the whole time. The agent did it in one shot, in a fresh context window, with the contract skill already loaded. |

### Risks the harness caught

1. **`keras-save-format-guard.py` blocked `.h5` save and `TF_USE_LEGACY_KERAS=1` env-var attempts.** Both were my own smoke tests, not real-use slips, but the pattern matching was correct and the block reasons cited the right `keras 3 grader can't load` rationale. In a session where the user (or me) was iterating on the training cell and accidentally pasted `model.save('best.h5')` (a common LLM-training-data mistake — the legacy form is more documented), this hook would have stopped it cold.

2. **`verify-contract.py` independently re-implemented the AST check.** This caught a real risk that the project's own `verify_contract.py` (in the repo root) is broken — it still references the pre-rename `submission.py` filename and would `FileNotFoundError` on first run. The hook's AST check works regardless of that script's state, so a Tier-1 violation introduced via Edit would still be blocked even though the project's own verification tool is currently silent. **This is exactly the "harness compensates for project tooling rot" value proposition.**

3. **The `submission-reviewer` agent caught nothing because nothing was wrong**, but the absence of findings IS the value when the cost is one ~32K-token agent call vs. me re-doing the same checks manually across many tool calls and risking missing one. This is the "static verification compresses cleanly into a subagent" pattern.

4. **The `keras3-serialization-gotchas` skill kept me on the right verification path when I was inspecting the `.keras` zip archive.** Without it I might have spot-checked the file size and called it good. With it I knew to extract `config.json` and verify Dense(5, softmax) + the loss `class_name` + `module: keras.losses` (the built-in marker). Each of those was a 30-second extraction that confirmed the model would load without `custom_objects=`.

### Risks the harness missed

1. **Stale data inside the `rationale-pdf-prep` skill.** Lines 76-79 of `rationale-pdf-prep/SKILL.md` say `<FILL IN CODE NAME HERE>` is still a placeholder on line 5 of the markdown. **It was already filled in (`Donnyclaude`) before this session started.** This is exactly the failure mode of harness skills that record point-in-time project state: they go stale fast. Not a grader risk (the user did the right thing), but a **harness-reliability risk** — a future session that trusts the skill's "as of 2026-04-24" claim could waste time investigating a non-issue. Self-noted in the skill itself, but the recommendation here is to **strip volatile state from skills entirely** and either verify it live each time or move it to a `.planning/STATE.md`-style file the skill points at.

2. **No round-trip verification hook.** The harness has no automated way to verify that `Donovan_Santine-best_model.keras` actually deserializes cleanly via `keras.models.load_model()` with no kwargs. I had to manually `unzip -p ... config.json` and inspect class names. The user already ran the round-trip test in a fresh Colab kernel (per rationale line 28), so the actual risk was zero this time, but the harness has no way to catch a future "user retrained, copied the new file, forgot to round-trip-test" sequence. Suggested fix: a hook on Bash commands matching `cp .* Donovan_Santine-best_model.keras` or on Edit commands to the deliverable directory that runs `python3 -c "import keras; m = keras.models.load_model(...); print(m.summary())"` and blocks if it fails.

3. **`verify-contract.py` only inspects file state at hook-fire time, not the post-edit content.** The hook's own comment (lines 168-175) acknowledges this: for `Edit` (which only carries `old_string`/`new_string`), it reads the current on-disk file rather than applying the edit in memory. So an Edit that introduces `def pre_process_features(input_features, **kwargs):` would NOT be caught at the moment of the Edit; it would only be caught on the *next* Edit/Write to the same file. This is a meaningful gap. Fix: build the post-edit file content in memory by applying the `old_string`/`new_string` substitution before the AST parse.

4. **No hook on Notebook-cell edits.** The user's primary editing surface is the `ecg_classifier.ipynb` Colab notebook, not direct edits to `submission.py`. The functions inside the notebook may diverge from `Donovan_Santine-submission.py` (the user copies cells out to the .py file when ready). The harness only protects the .py file. A V3 mixup attempt in the notebook could introduce a custom loss subclass, and the harness would only catch it at the moment the user copies the cell into `submission.py` — not when it's first written. Suggested fix: a hook on `Edit` to `*.ipynb` that AST-parses any cell containing one of the three function names and runs the same checks.

5. **Hooks can't see Bash output, only commands.** A user running `pip install scipy` in a Colab cell wouldn't be caught by the Bash hook because they'd run it inside the notebook, not in this session's Bash. (Out of scope for this harness, but noted because it's the natural next failure mode if the harness does its job for graded-function edits.)

### Cost-vs-benefit assessment (subjective)

**Net positive, but with thin margin because the session was static-verification-only.**

The single biggest value was the `submission-reviewer` agent. One ~32K-token agent call replaced what would have been ~10-15 sequential Read/Grep/AST-inspection tool calls in my own context, and produced a verdict in a structured template I could trust without reverification. That alone justifies the harness for a pre-submission session even if nothing else fired.

The hooks did their job on smoke tests but had zero organic fires (no real Edits to graded files, no real save calls). In a session where the user was *actively iterating* — adding mixup augmentation, swapping loss functions, doing a fresh training run — both hooks would likely have fired multiple times for real protection. Cannot extrapolate from this session alone whether the hooks would prove their cost; this session's evidence is "they didn't get in the way + the smoke tests worked".

The skills (especially `keras3-serialization-gotchas`) were noticeably better than my training-data Keras knowledge for this specific project, because they encode the *intersection* of (Keras 3 quirks) ∩ (this project's grader contract) ∩ (the user's V2 architecture). General Keras knowledge would not have told me to immediately grep for `Dense(\d+,` and verify the 5 specifically. Project-specific compression like that is what makes targeted harnesses outperform global ones.

**Compared to working with bare global `~/.claude/` only:** the global skills (e.g. `python-review`, `code-review`, `learn`) are too generic to have produced the same review. They would have flagged Python style issues that don't matter and missed the Dense(5) gotcha entirely. **Targeted harness > bare baseline** for this task.

**Compared to a full donnyclaude V4-style harness:** AHOL data shows V4 had 1.56× cost overhead vs. V0. This targeted harness probably added 10-15% overhead this session (mostly the agent call), and only one of those percent-points was hook overhead. **Targeted harness > V4** for this task because it pays only for the project-specific protection it provides, and the agent's value scales with the project's actual graded-contract complexity rather than with the size of the harness itself.

### What to change in the harness next time

In rough priority order:

1. **Strip point-in-time project state out of the skills.** `rationale-pdf-prep/SKILL.md` lines 76-79 had stale "as of 2026-04-24" content about the placeholder code name. Skill files should describe *invariants and triggers*, not snapshot state. Move the volatile state to `.planning/STATE.md` and have the skill say "check STATE.md for current values" instead.

2. **Make `verify-contract.py` do post-edit content reconstruction for `Edit` calls.** Today it reads the on-disk file and AST-parses *that*, which means a contract-breaking Edit only gets caught on the *next* hook fire (when the bad state is already on disk). The fix is ~20 lines: when `tool_input` has `old_string` and `new_string`, read the file, apply the substitution in memory, then run `check_source` on the proposed result. This closes the "drift through Edit" gap that is the hook's most-likely real-world failure mode.

3. **Add a `verify-keras-roundtrip.py` hook.** Triggers on Bash commands that match `cp .*\.keras Donovan_Santine-best_model\.keras` or any Edit that re-saves the deliverable. Runs the round-trip in a subprocess: `python3 -c "import keras; m = keras.models.load_model('Donovan_Santine-best_model.keras'); m.summary()"` and blocks on any non-zero exit. Catches the "user trained a new model with a custom subclass + forgot to test load" sequence that is the failure mode the user explicitly worries about.

4. **Add notebook coverage.** The user's primary edit surface is `ecg_classifier.ipynb`, not `submission.py`. A hook on `Edit` to `*.ipynb` that AST-parses any code cell containing `def pre_process_features|build_compile_model|train_model` would catch graded-contract violations at their source instead of at copy-out time. ~30 lines using `nbformat`.

5. **Make the `keras-save-format-guard.py` patterns aware of multiline / quoted Bash.** The current regexes work for simple inline cases but a `.h5` path inside a heredoc or a Python file written via `cat <<EOF` would slip past. Lower priority because the failure mode is rare in practice; flag for future hardening.

6. **Document the "test-the-hook" anti-pattern in the harness README.** When agents (including me) want to verify a hook works, they naturally write `echo '{...}' | hook.py` with the literal blocked pattern in the input. The hook fires on a meta-test rather than a real intent. Either tag test invocations with an env var the hook can recognize and skip, or accept that this is a known-and-tolerable noise floor in early-session smoke testing.

7. **Consider compressing the 3 skills into 1.** `ecg-grading-contract` + `keras3-serialization-gotchas` + `rationale-pdf-prep` overlap in their "stuff that breaks the grader" sections (e.g. Dense(5) is mentioned in two of three; save format is mentioned in two of three). One unified `ecg-submission-bible` skill might be tighter and load faster. Counter-argument: the current split lets the rationale-pdf-prep skill be invoked alone when only the PDF needs work, without pulling in the full grader contract. **Verdict: probably leave as is**, but worth re-evaluating after another session of real use.

8. **Add an `archive-and-clean` skill or workflow.** Once the user uploads to Canvas, the `.claude/` harness has served its purpose for this milestone. A future session needs to know whether to remove it, archive it, or leave it for V3 follow-on work. Document the lifecycle in the harness README.

---

## Cross-reference to AHOL data

When this report is populated, append the following section so the data can be analyzed alongside AHOL rounds:

| AHOL data point | This field test |
|------------------|-----------------|
| V0 SWE-bench resolved rate (retry): 9/10 | Per-rubric self-assessment (pre-grader): 5/5 hard-fail items PASS (signatures, no custom_objects, Dense(5), no banned imports, .keras format) + 2/2 soft-fail items PASS (categorical_accuracy metric, no augmentation pollution). Independent of accuracy points (which depend on hidden test set). For the rubric's contract-compliance items, this submission self-scores 100%. |
| V4 SWE-bench resolved rate: 8/10 | N/A — single submission, not a 10-trial cohort. The closest analog is the user's earlier V1 (76.84% val) → V2 (78.58% val) iteration, which the harness wasn't installed during. Going forward, harness-resident-during-iteration sessions can be tracked against the same per-rubric metric. |
| V0 → V4 cost ratio: 1.56× | **Estimated 1.10-1.15× this session.** ~32K of ~85K total tokens went to the submission-reviewer agent (the only meaningfully expensive harness artifact); skill loads added negligible token volume; hook fires were near-zero token cost (just stdin/stdout JSON). The dominant cost was the agent call, which is functionally equivalent to "I would have done this work anyway, but now I don't have to keep the contract in my main context." So the *net* overhead vs doing the same review without the harness is plausibly negative. **Caveat: tiny n=1, static-verification session, not generalizable.** |
| V3 (single hook): 0.98× cost, 8/10 pass | Comparable single-hook signature: this harness has 2 hooks (`verify-contract` + `keras-save-format-guard`). Total hook overhead this session was effectively 0 — JSON in/out and one AST parse per fire, well under 100ms. Consistent with V3's 0.98× finding. The hooks would scale linearly with edit count; static-verification sessions bottom out at near-zero cost. |

## Filing instruction for the DanMLProject session

After populating this file, commit it in donnyclaude (this repo, not the DanMLProject repo) with a message like:

```
data(ahol): field-test report from DanMLProject submission cycle
```

Do NOT commit it in DanMLProject. The harness lives in DanMLProject; the data lives here. Keeps the experiment data centralized for AHOL analysis.

---

*Template generated 2026-04-24 by donnyclaude session.*
*Populated 2026-04-24 ~20:30 CDT by DanMLProject session.*

---

## Bootstrap-check anomalies (added by DanMLProject session)

Findings worth flagging that don't fit the template above:

1. **All 7 harness files were present and readable at session start.** No missing files, no zero-byte placeholders. settings.json is well-formed JSON; both hook scripts are valid Python with correct shebangs; both hook scripts are executable (verified via successful smoke-test invocations). Net: harness install was clean.

2. **Both hooks survived smoke tests with correct verdicts:** verify-contract.py returned `{"continue": true}` on the current contract-clean submission (true negative); keras-save-format-guard.py blocked `.h5`, `save_format='tf'`, and `TF_USE_LEGACY_KERAS=1` patterns (true positives) and passed `.keras` paths (true negative).

3. **The `keras3-serialization-gotchas` skill at line 53 already calls out** the project's own `verify_contract.py` as broken (still points at pre-rename `submission.py`). This is documented and expected — the hook compensates. **Do not "fix" the project's verify_contract.py via this harness's authority** unless the user explicitly asks; the hook is the source of truth and the project script is a separate user-facing tool.

4. **Submission state at session start vs. assumptions in the prompt:** The prompt's step 3a asks "confirm the leaderboard code name placeholder is filled in `Donovan_Santine-rationale.md` (line 5: `<FILL IN CODE NAME HERE>`). If not, ask the user once for a code name and apply it." **Already filled with `Donnyclaude`.** No user prompt needed. The `rationale-pdf-prep` skill at lines 76-79 has the stale claim. Logged under "Risks the harness missed".

5. **PDF mtime is newer than markdown mtime by 6 minutes** (PDF: 19:56, MD: 19:50). Confirms the PDF was regenerated after the most recent markdown edit. No regen needed this session.

6. **`.keras` archive inspection (manual, no harness-supplied tool):** Extracted `config.json` from the deliverable. Confirmed: `Functional` model, name `ecg_afib_classifier`, 78 layers, predictions layer `Dense(units=5, activation='softmax')`, loss `keras.losses.CategoricalFocalCrossentropy(gamma=2.0, label_smoothing=0.05)`, metric `keras.metrics.CategoricalAccuracy(name='categorical_accuracy')`. **All built-in classes** — `keras.models.load_model(path)` with no `custom_objects=` kwarg will succeed in the grader's environment. This is the strongest single piece of evidence that the submission is grader-safe.

## False-positive Vercel skill injection (noted per prompt)

The session start surfaced Vercel "workflow" and "vercel-sandbox" skill recommendations triggered by keywords in the field-test prompt itself ("workflow", "sandbox" appeared in agent descriptions and skill names). These were correctly ignored per prompt instructions. This is a project-environment-vs-prompt mismatch, not a harness flaw — the targeted harness contains zero Vercel content.
