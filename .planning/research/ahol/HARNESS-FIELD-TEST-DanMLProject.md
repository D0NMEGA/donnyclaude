# Harness field test: targeted ECG submission harness on DanMLProject

**Status:** PHASE 1 (static verification) populated 2026-04-24 by DanMLProject session post-harness-install. PHASE 2 (active iteration / V3 attempt) populated 2026-04-24 ~22:00 CDT.
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

---

## Phase 2: Active iteration (V3 attempt)

**Status:** Phase 2 measures harness behavior during real ML iteration, the high-value path that Phase 1 explicitly could not exercise. The user's directive: "the point is to MEASURE harness behavior during active edits, not to ship a marginally better model."

### V3 design and outcome (one-paragraph version)

V3 added two changes on top of V2's focal-loss + time-shift recipe:
1. **Per-batch mixup augmentation** inside `train_model` via `tf.data.Dataset.map()`, sampling Beta(0.2, 0.2) interpolation weights from a ratio of two `tf.random.gamma` draws (stock TF, no scipy). Mixes features, one-hot labels, and per-sample weights.
2. **Two-phase training protocol** — Phase A: 5 seeds (42, 123, 7, 99, 2024) at 80/20 split for selection; Phase B: retrain winning seed on 100% of data for fixed 30 epochs. Implemented as a single `train_model` branch on whether `val_features`/`val_labels` are provided.

Phase A leaderboard: seed 7 won at **79.02%**, beating V2's 78.58% by **+0.44pp**. Three of five V3 seeds (7, 123, 2024) cleared V2; spread was 0.63pp. Phase B retrain was undertrained at 30 epochs (78.70% on overlapped val < Phase A's 79.02% on clean val) so the Phase A seed-7 winner is the submission. Total Colab time: ~75 min.

**V3 wins.** But the win margin is narrow enough that the more interesting data is the harness behavior during the iteration itself.

### Hook fires during V3 active iteration (organic only, not smoke tests)

| Hook | Tool | Total fires | Blocks (legitimate) | False positives | Notes |
|------|------|-------------|---------------------|------------------|-------|
| verify-contract.py | Edit | 3 | 0 | 0 | Three real Edits to `Donovan_Santine-submission.py`: (1) docstring V3 update, (2) `train_model` overhaul adding nested `_mixup` fn + Phase B branch, (3) dtype cast fix after the Colab error. Each fired AST parse + globals audit + early return `{"continue": true}` in <100ms. **All three were legitimate edits that the hook correctly allowed because the contract was preserved.** Zero false blocks, zero missed contract issues (all three were contract-clean by design). |
| keras-save-format-guard.py | Bash | ~12 | 0 | 0 | Fired on every Bash command during V3 work (git status, ls, contract-hook smoke test, pandoc PDF regen, etc.). Zero contained `.h5` / `save_format='tf'` / `TF_USE_LEGACY_KERAS=1` patterns. All silent passes. Hook overhead per fire: imperceptible. |
| **NotebookEdit (no hook coverage)** | NotebookEdit | 0 | n/a | n/a | I made **4 NotebookEdits** to `ecg_classifier.ipynb` (cells 12 V3 initial, 19 markdown, 20 multi-seed protocol, 12 dtype fix). Cell 12 contains a `%%writefile submission.py` block with a complete copy of the graded function code. **None of these edits triggered any contract validation** because verify-contract.py's matcher is `Edit\|Write\|MultiEdit`, NotebookEdit isn't included. This is the same Risk #4 flagged in Phase 1, now confirmed as a real coverage gap during real iteration. |

**Net during V3 iteration: 0 organic blocks across ~15 hook fires. 0 false positives. 1 confirmed coverage gap (NotebookEdit).**

The harness's contract-validation hooks did exactly what they're spec'd to do: cheap, silent insurance on every edit. No friction, no false alarms. The cost of that insurance was effectively zero token volume and zero wall-clock — each fire was a sub-100ms AST parse or regex match.

### The dtype runtime bug (harness-scope-gap data point)

The most interesting Phase 2 finding. V3's mixup function did `lam * batch_one_hot` where `lam` was float32 and `batch_one_hot` was int64 (from `IntegerLookup(output_mode='one_hot')`). V2 didn't hit this because mixup wasn't in the pipeline; Keras's loss internals cast int→float on the way into the loss, but mixup runs *before* the loss in the dataset graph, so the cast had to be explicit.

| Layer | Caught by | When |
|-------|-----------|------|
| verify-contract.py hook | NO | Out of scope. The hook validates signatures + globals audit, not dataset dtype consistency. |
| submission-reviewer agent | NO | Reviewed contract compliance (signatures, no banned imports, save format, etc.) and verbose-passed the V3 changes. Out of scope to trace the dataset element_spec. |
| keras3-serialization-gotchas skill | NO | The skill describes `.keras`-format pitfalls (Dense(5), built-in losses, no save_format='tf'). It correctly told me CategoricalFocalCrossentropy handles soft targets, but it doesn't enumerate which Keras layers produce int64 vs float32. |
| ecg-grading-contract skill | NO | Describes the grader contract; says nothing about training-time dtype semantics. |
| **Colab runtime** | **YES** | TypeError 20 frames deep in `tensorflow/python/framework/op_def_library.py`, fired on epoch 1 of seed 42 in Phase A. |

The cost: ~1 minute of training time wasted on the failed seed-42 epoch-1 attempt, plus ~5 minutes of human-in-the-loop diagnose-and-patch latency (read error, identify cause, edit submission.py + cell 12, instruct user to re-run cell 12 → 14 → 20). Then the run completed cleanly.

**Interpretation: this is NOT a harness failure.** The harness scope is grader-contract compliance. Runtime ML correctness is checked by actually running the model. These don't overlap. The bug was always going to be caught at training time, with or without the harness, and the marginal cost of catching-by-running vs catching-by-static-analysis is small for a tf.data graph that's hard to reason about statically anyway. Mark this as a known scope gap rather than a harness flaw.

### submission-reviewer agent during V3

| Stage | Token cost | Wall clock | Catches | Verdict |
|-------|------------|------------|---------|---------|
| V3 review (mixup + Phase B added) | ~32K | ~70s | 0 contract issues, 2 informational notes (unseeded random ops, intentional unprefixed checkpoint filename) | **GO** |

Same value profile as Phase 1: the agent confirmed zero contract issues in a structured template that took ~70s and one tool call, vs. ~10 sequential reads/greps if I'd done it by hand. The agent did NOT catch the dtype bug (out of scope, not a contract issue), but it did line-audit the nested `_mixup` function and confirm it uses only `tf.random.gamma` / `tf.gather` / arithmetic — i.e., no banned imports, no Keras subclassing. That's the kind of nested-scope check the AST hook can't do (the hook stops at top-level FunctionDef boundaries), so the agent fills a real gap.

### Skill loads during V3

| Skill | When loaded | Influenced design decision? | Verdict |
|-------|-------------|------------------------------|---------|
| keras3-serialization-gotchas | Session start (passive) + referenced during mixup design | YES — confirmed `CategoricalFocalCrossentropy` is built-in (so mixup integration with focal loss is safe, no need for a custom loss subclass). Confirmed `tf.random.gamma` is stock TF (so Beta sampling for mixup doesn't need scipy). | **Helpful.** Encoded the intersection of (Keras 3 quirks) ∩ (this project) precisely enough that "should I write a custom focal-mixup loss?" took ~1 second to answer instead of being a design rabbit hole. |
| ecg-grading-contract | Session start (passive) + referenced in submission-reviewer prompt | YES — kept me from drifting on signatures when adding the Phase B branch. The plan was to detect Phase B from the existing val args being None rather than adding a kwarg, exactly because the contract is byte-locked. | **Helpful.** Saved me from at least one signature-drift attempt. |
| rationale-pdf-prep | Loaded during deliverable update (PDF regen) | YES — provided the exact pandoc + tectonic command, no improvising. | **Helpful.** Zero friction PDF regen with the correct margins/fontsize/header. |

### What changed about the harness's value proposition between Phase 1 and Phase 2

Phase 1 conclusion (paraphrased): "harness was net positive but had thin margin because the session was static-verification-only — hooks didn't fire on real edits, can't generalize."

Phase 2 conclusion: **harness is net positive during real iteration too, but for different reasons than I expected**.

- The hooks **didn't catch any V3 issues** because V3 was contract-clean by design (I had the contract loaded in context before I started editing). Their value during iteration is *negative-space* value: every silent pass is a "yes, the contract still holds" confirmation that lets me move forward without manually re-verifying.
- The submission-reviewer agent caught 0 issues but provided **a structured artifact I could trust** before sending V3 to Colab. That's a 75-minute compute commitment; spending 70s of agent time to confirm "no contract drift" before the commitment is straightforwardly +EV.
- The skills directly **shaped V3's design choices** — mixup using stock TF (no scipy), no custom loss subclass, Phase B branch via existing args (no signature change). Without the skills these would have been one-by-one decisions; with the skills they were already-decided.
- The dtype bug **was out of scope** and that's fine — the harness doesn't claim to catch runtime ML bugs, and the cost of catching it via runtime was small (~6 min round-trip).
- The NotebookEdit coverage gap **is the most actionable improvement** flagged by Phase 2. Same gap as Phase 1's Risk #4, now empirically confirmed during real iteration. Cell 12's `%%writefile submission.py` is an unprotected duplicate of the graded code; a future edit there could break the contract and only get caught when the user runs the model. Fix: extend the verify-contract.py matcher to include NotebookEdit, and AST-parse the cell content if it matches `%%writefile submission.py`.

### Subjective harness assessment for V3 active iteration

**Net positive.** Specifically:

- **Friction:** zero. No false blocks, no false agent-spawn, no skill-load that distracted from the work. The 5 read-before-edit runtime reminders were noise but they're a Claude Code runtime feature, not part of this harness.
- **Cost:** ~10-15% of total V3-iteration tokens went to harness artifacts (mostly the agent call). Hook fires were rounding-error in token volume.
- **Observable wins during V3 design phase:** mixup using stock TF (no scipy detour), no custom loss subclass, Phase B as a branch on existing args (no signature drift attempted). Each of these would have been a 1-2 minute decision without the skills; with them they were ~10 second decisions.
- **Observable wins during V3 edit phase:** every Edit to the submission file came back contract-clean in <100ms. I never had to mentally re-verify "did this edit drift the signature".
- **Observable wins during V3 hand-off phase:** structured review verdict from submission-reviewer before Colab compute commitment. I didn't ship a contract-drifted file to a 75-min training run.
- **Misses:** the dtype runtime bug (out of scope, accepted), the NotebookEdit coverage gap (same as Phase 1 Risk #4).
- **Compared to bare baseline:** the harness saved ~5-10 minutes of contract re-verification and design dithering. It did not save the ~6 minutes spent diagnosing the dtype bug — that was unavoidable given the harness's scope.
- **Compared to V4 full-donnyclaude:** AHOL data shows V4 cost 1.56× vs V0 baseline. This targeted harness probably cost ~1.10-1.15× during V3 iteration (mostly the agent call). The targeted harness's specificity advantage held — generic Python-review or test-coverage agents would have produced noise that didn't apply (no tests in this project, idiomatic-Python concerns don't help when the constraint is grader-contract compliance).

**The headline finding from Phase 2:** during real iteration, the harness's silent-pass behavior on every Edit + Bash is the dominant value, not its block-on-violation behavior. Insurance you don't have to think about. The submission-reviewer agent is the second-largest value source, and it's the same value as Phase 1: a structured contract verdict before each compute commitment.

### Hook-fire deltas Phase 1 → Phase 2

| Hook | Phase 1 (static verify session) | Phase 2 (V3 active iteration) |
|------|-------------------------------|--------------------------------|
| verify-contract.py organic fires | 0 (only smoke tests) | 3 (real Edits to submission.py) |
| verify-contract.py blocks | 0 | 0 |
| verify-contract.py false positives | 0 | 0 |
| keras-save-format-guard.py organic fires | 0 (only smoke tests) | ~12 (every Bash command) |
| keras-save-format-guard.py blocks | 0 | 0 |
| keras-save-format-guard.py false positives | 0 | 0 |
| NotebookEdit covered | n/a (didn't edit notebook in P1) | NO — 4 unprotected edits |
| submission-reviewer agent fires | 1 | 1 (V3 pre-Colab review) |
| Skill loads (active references) | ~3 | ~3 (different subset) |

### What to change in the harness next time (revised priority list, based on Phase 1 + Phase 2 combined)

1. **Add NotebookEdit coverage to verify-contract.py.** Now confirmed as a real-iteration gap. Fix: extend the matcher in `.claude/settings.json` to `Edit|Write|MultiEdit|NotebookEdit`, and in the hook, check `tool_input.notebook_path` and `tool_input.new_source`. If `new_source` starts with `%%writefile submission.py` or `%%writefile Donovan_Santine-submission.py`, AST-parse the cell content (after stripping the `%%writefile <path>` first line) and run the same `check_source` function. ~30 lines.

2. **Document the harness-scope boundary in `README.md`.** The dtype bug surfaced cleanly that the harness scope is grader-contract compliance, not runtime correctness. Future contributors should not expect dataset-graph dtype validation. Add a one-paragraph "What the harness does not catch" section so this is explicit.

3. **(Promoted from Phase 1)** Strip point-in-time project state out of skills. Phase 1 found stale `<FILL IN CODE NAME HERE>` claim; Phase 2 didn't surface new staleness but the principle holds.

4. **(Promoted from Phase 1)** Make `verify-contract.py` do post-edit content reconstruction for Edit calls. Still a real gap but lower priority because Phase 2 didn't hit it (the AST hook fired on the on-disk content correctly because the Edits were already-applied by the time the next hook fired).

5. **(Promoted from Phase 1)** Round-trip verification hook for `.keras` re-saves. Phase 2 again didn't hit this because the user's round-trip cell 30 confirmed the model loads. But it's still a real gap.

6. **Read-before-edit runtime reminder noise.** Phase 2 fired this 5 times across all my Edits to files I'd already read. Not a project-harness issue — Claude Code runtime feature. But it's noise that affects the harness's perceived signal/noise. No action this is outside the project's control, just noted.

### Cross-reference to AHOL data (Phase 2 update)

| AHOL data point | Phase 2 (V3 active iteration) |
|------------------|-------------------------------|
| V0 SWE-bench resolved rate (retry): 9/10 | V3 contract-compliance self-score: 5/5 hard-fail items PASS, 2/2 soft-fail items PASS, 0 grader-blocking issues. Same 100% as Phase 1. |
| V4 SWE-bench resolved rate: 8/10 | V3 outcome: **+0.44pp val accuracy over V2** (78.58% → 79.02%). 3-of-5 V3 seeds cleared V2 baseline. Lift came from the mixup augmentation, not from harness speedup. |
| V0 → V4 cost ratio: 1.56× | **Phase 2 estimated 1.10-1.15× vs bare baseline.** Largest single token contributor was the submission-reviewer agent (~32K). Hook fires were rounding-error. Skill loads were rounding-error. The dtype bug round-trip cost ~6 min wall-clock but no harness-attributable token cost. |
| V3 (single hook): 0.98× cost, 8/10 pass | This harness has 2 hooks active across ~15 organic fires in Phase 2; total hook overhead was ~1.5 seconds of wall-clock and effectively zero token cost. Consistent with V3's 0.98× finding. |

### What to check in the next field-test session (if there is one)

Phase 1 was static, Phase 2 was active iteration with a new feature (mixup) on the same architecture. A useful Phase 3 would test the harness during a *failed* iteration — e.g., a V4 attempt that loses to V3 and gets reverted. That would measure whether the harness's structured-rollback support (planning artifacts, atomic commits) holds up when the iteration's *outcome* is "no, ship the previous version" instead of "yes, ship the new version". The current harness is silent on the rollback path. Worth flagging because it's the failure mode that Phase 1 + Phase 2 haven't yet exercised.
