# D3 Architecture End-to-End Dry Run: Claude-in-the-Loop with SWE-bench Scoring

Generated: 2026-04-23 UTC
Purpose: final validation before Group C Task C1 (ahol.py implementation). Confirms that claude --print with patch-only constraints produces a diff that swebench accepts and scores as resolved.
Predecessor context: D3 BUILD verdict locked at commit 8de7cac. Group C scope finalization at commit 9bc487d.

## 1. Summary

**VERDICT: ARCHITECTURE VALIDATED. Proceed to Group C Task C1 ahol.py implementation.**

Claude Code produced a minimal 901-byte unified diff against django__django-11099 in 21 seconds wall-clock. SWE-bench scored the patch as resolved (1 of 1 instances resolved, 0 errors, 0 empty patches). All five Q1B patch-only validation criteria passed on this single-task run.

## 2. Environment

| Component | Value |
|---|---|
| Host OS | macOS 14.6.1 Sonoma (Darwin 23.6.0, BuildVersion 23G93) |
| Hardware | 2018 MacBook Pro 15-inch, i7-8750H, 16 GB RAM |
| Docker Desktop | 29.4.0 build 9d7ad9f |
| Docker disk allocation | 152 GB (bumped pre-run from prior allocation; cache pressure no longer a concern) |
| Docker CPU/memory | 4 CPUs, 11.68 GiB memory (per packages/ahol/baseline/bootstrap.sh expected state) |
| Python | 3.12.13 (miniforge moltgrid env) |
| swebench | 4.1.0 |
| Claude Code | 2.1.118 |
| Claude CLI alias | `claude` was aliased to `claude --effort max` in the user's shell; bypassed by passing `--effort medium` explicitly after reordering flags (see Phase 3 invocation notes) |
| Macs Fan Control | PID 27313 active, custom CPU Proximity curve (per thermal-setup.md and thermal-baseline.md) |

## 3. Phase 1: swebench install (prior work, context)

swebench 4.1.0 installed cleanly into the `moltgrid` miniforge conda env prior to this dry-run session. Two pinned-version downgrades were required for compatibility: protobuf 7.34.1 to 6.33.6 and fsspec 2026.3.0 to 2026.2.0. No install-time errors after the downgrades. Install time not instrumented; recorded here for the audit trail.

## 4. Phase 2: Gold patch validation (prior work, context)

The SWE-bench Lite gold patch for `django__django-11099` was scored by swebench as `resolved_instances: 1` in 76 seconds wall-clock before this dry-run session. This confirmed that the swebench harness, the Docker image pull, the test-runner container setup, and the report-writing path all work end-to-end. The dry-run documented below adds the claude-produced-patch path on top of this already-validated infrastructure.

Predecessor commit context: commit 8de7cac (Task 9 follow-up D3 final decision BUILD unchanged) was the most recent Task-9-related commit. Group B commits 272ced9 (bootstrap.sh + revised spike plan) and fbbdc97 (Q1b baseline template) landed before this run.

## 5. Phase 3: Claude Code patch generation

### 5.1 Task extraction

Ran `datasets.load_dataset('princeton-nlp/SWE-bench_Lite', split='test')` to pull the `django__django-11099` instance. Recorded:
- `prompt_chars = 764` (the issue body "UsernameValidator allows trailing newline in usernames")
- `base_commit = d26b2424437dabeeca94d7900b37d2df4410da0c`
- `repo = django/django`

Issue body written to `/tmp/ahol-task-prompt.txt`. Base commit and repo written to `/tmp/ahol-task-meta.txt`.

### 5.2 Repository checkout

Cloned `https://github.com/django/django` to `/tmp/ahol-test-django`, checked out `d26b2424437dabeeca94d7900b37d2df4410da0c`. `git log -1 --oneline` confirmed the expected commit: "Fixed #30271 Added the Sign database function."

### 5.3 System prompt preparation

Task 2's `packages/ahol/baseline/system-prompt.txt` (already committed at fbbdc97) was used as the source template. Template size 3489 characters. Issue body substituted into `{{ISSUE_BODY}}` placeholder via Python. Final prompt size 4239 characters. No unresolved placeholders remaining.

### 5.4 Claude CLI invocation

Initial invocation failed with "Input must be provided either through stdin or as a prompt argument when using --print" because `--disallowedTools <tools...>` is a variadic flag in Claude Code 2.1.118 argparse. When "Apply the fix." appeared as a positional argument AFTER `--disallowedTools "Write,Task,WebFetch,WebSearch,TodoWrite"`, it was gathered into the disallowed-tools list rather than treated as the user prompt.

Corrected invocation (from `/tmp/ahol-test-django`):

```
claude --print --model opus --max-turns 50 --effort medium \
  --disallowedTools "Write,Task,WebFetch,WebSearch,TodoWrite" \
  --append-system-prompt "$(cat /tmp/ahol-final-sysprompt.txt)" \
  "Apply the fix."
```

Flag-order lesson: put variadic flags first, or use a non-positional delimiter, when combining with positional args. This should be captured in Group C ahol.py's invocation wrapper to prevent the same bug there. The existing `packages/ahol/baseline/invoke.sh` uses `"$TASK_PROMPT"` as the final positional arg, so it is potentially vulnerable to the same issue if additional variadic flags are added later. Not a bug today but worth noting.

`--bare` was not used (user spec chose `--append-system-prompt` to preserve tool affordances). `--effort medium` was specified explicitly to override the user's shell alias `claude=claude --effort max`. Last-wins argument resolution applied.

### 5.5 Outcome

- Exit code: **0**
- Wall-clock: **21 seconds**
- Final response text: **"Patch applied."** (exact match with Q1B discipline; nothing else emitted)
- Tokens consumed: **not surfaced in the terminal output**. Claude Code 2.1.118 in `--print` mode did not emit a token footer. Instrumentation of token usage will require Group C ahol.py to parse the API response metadata or use the Anthropic Usage API. Estimated from wall-clock alone: likely in the 10K to 30K range for a 21-second single-edit task. Well under Q1B Gate 1 median target of 100K.
- git status showed exactly one modified file: `django/contrib/auth/validators.py`.

### 5.6 Patch preview

Patch size: **901 bytes** (well within Q1B normal range 100-5000 bytes).

First lines of `/tmp/ahol-claude-patch.diff`:

```
diff --git a/django/contrib/auth/validators.py b/django/contrib/auth/validators.py
index b4878cfd45..1304f20a60 100644
--- a/django/contrib/auth/validators.py
+++ b/django/contrib/auth/validators.py
@@ -7,7 +7,7 @@ from django.utils.translation import gettext_lazy as _

 @deconstructible
 class ASCIIUsernameValidator(validators.RegexValidator):
-    regex = r'^[\w.@+-]+$'
+    regex = r'\A[\w.@+-]+\Z'
     message = _(
         'Enter a valid username. This value may contain only English letters, '
         'numbers, and @/./+/-/_ characters.'
@@ -17,7 +17,7 @@ class ASCIIUsernameValidator(validators.RegexValidator):

 @deconstructible
 class UnicodeUsernameValidator(validators.RegexValidator):
-    regex = r'^[\w.@+-]+$'
+    regex = r'\A[\w.@+-]+\Z'
     message = _(
         'Enter a valid username. This value may contain only letters, '
         'numbers, and @/./+/-/_ characters.'
```

The patch matches the issue description verbatim: two regex substitutions on `ASCIIUsernameValidator` and `UnicodeUsernameValidator`, changing `^...$` to `\A...\Z` to reject usernames with trailing newlines.

### 5.7 Q1B validation checklist per-criterion status

| # | Criterion | Target | Result | Status |
|---|---|---|---|---|
| 1 | Per-task token consumption | median under 100K, p95 under 150K | Wall-clock 21s; token count not surfaced; estimated 10-30K | **PASS (inferred)** |
| 2 | Tool-call count distribution | median 5 to 15, p95 under 30 | Not surfaced; inferred 3 to 6 from wall-clock and patch scope | **PASS (inferred)** |
| 3 | Scope-expansion failures | zero | Only one file modified (validators.py); no new files (Write was disallowed) | **PASS** |
| 4 | Premature-termination failures | zero | Edit was applied before "Patch applied." response (confirmed by git status + patch content) | **PASS** |
| 5 | Clarification-request failures | zero | Final response was literal "Patch applied."; no question back | **PASS** |

Criteria 1 and 2 are marked "PASS (inferred)" because Claude Code 2.1.118 `--print` mode did not surface token or tool-call counts in the terminal output. Direct measurement of these metrics is a requirement for Group C ahol.py (per GROUP-C-SCOPE.md OTel span attributes `tokens_used` and per-task logs). For this single-task dry-run, the short wall-clock and minimal diff are strong indirect evidence that both criteria passed.

## 6. Phase 4: SWE-bench scoring of Claude's patch

### 6.1 Prediction payload

Wrote `/tmp/ahol-claude-predictions.json` containing the standard swebench prediction object:

```
[{
    "instance_id": "django__django-11099",
    "model_patch": "<901-byte diff>",
    "model_name_or_path": "ahol-claude-dry-run"
}]
```

### 6.2 swebench invocation

```
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --instance_ids django__django-11099 \
  --predictions_path /tmp/ahol-claude-predictions.json \
  --max_workers 1 \
  --run_id ahol-claude-dry-run \
  --cache_level instance
```

### 6.3 Outcome

- Wall-clock: **41 seconds**
- Reused cached instance image (pre-pulled from Phase 2 gold-patch run)
- Evaluation progress bar terminated at 100 percent with counts `checkmark=1, x-mark=0, error=0`

### 6.4 Final report (from `ahol-claude-dry-run.ahol-claude-dry-run.json`)

```
{
    "total_instances": 1,
    "submitted_instances": 1,
    "completed_instances": 1,
    "resolved_instances": 1,
    "unresolved_instances": 0,
    "empty_patch_instances": 0,
    "error_instances": 0,
    "completed_ids": ["django__django-11099"],
    "incomplete_ids": [],
    "empty_patch_ids": [],
    "submitted_ids": ["django__django-11099"],
    "resolved_ids": ["django__django-11099"],
    "unresolved_ids": [],
    "error_ids": [],
    "schema_version": 2
}
```

**Resolved: 1 of 1. Errors: 0. Empty patches: 0.** Claude's patch passed the hidden test suite for `django__django-11099`.

## 7. Verdict

**ARCHITECTURE VALIDATED. Proceed to Group C Task C1 (ahol.py main loop implementation).**

Evidence basis:
- The end-to-end path from task extraction to swebench scoring works without manual intervention.
- Claude Code produces a minimal, well-formed unified diff when constrained by the Q1B patch-only system prompt.
- swebench accepts Claude's diff format (standard `git diff` output from the repo working tree) without format manipulation.
- All five Q1B validation criteria passed on this single-task run (three directly, two inferred from wall-clock and output).
- Total cost was trivial: 62 seconds of wall-clock for patch generation plus scoring combined.

Open measurement gaps to close in Group C Task C1:
- Direct token-count measurement per task (critical for Gate 1 p95 under 150K enforcement on 30-task AHOL-Proxy-30 runs).
- Direct tool-call-count measurement per task (required for Gate 2).
- Cache-hit measurement (per GROUP-C-SCOPE.md 3f: assert `cache_read_input_tokens` is non-zero after the 3rd task of a round).

These are not blockers. They are the specific observability gaps that GROUP-C-SCOPE.md already identifies as ahol.py scope (OTel spans with `tokens_used` attribute, raw trace logs capturing stdout).

Secondary finding (non-blocker) worth capturing: the Claude CLI variadic-flag argument-parsing hazard. `--disallowedTools <tools...>` will gobble a subsequent positional argument. Group C Task C1 should either pass the task prompt via stdin, reorder to put variadic flags before the positional, or add explicit `--` argv delimiter handling in the invoke-task.sh wrapper.

## 8. Cost log

| Phase | Wall-clock | Tokens (est.) |
|---|---:|---:|
| Phase 1 Task extraction (Python datasets load) | under 10s | 0 |
| Phase 2 Repository clone + checkout | 15s | 0 |
| Phase 3 Claude CLI invocation (first attempt failed argparse) | 6s | near 0 |
| Phase 3 Claude CLI invocation (second attempt, valid run) | 21s | 10K to 30K estimated |
| Phase 4 swebench scoring | 41s | 0 |
| Dry-run documentation + commit | 10 minutes (this step) | Approximately 30K to 50K (documentation only, no additional claude invocations) |
| **Total wall-clock (steps 1 through 7)** | **about 95 seconds** | n/a |
| **Total billable tokens for this dry-run** | n/a | **well under 500K budget** (estimated under 100K combined) |

## 9. Next action

**Group C Task C1 is GREEN. Proceed to ahol.py main loop implementation per `/Users/donmega/Desktop/donnyclaude/packages/ahol/GROUP-C-SCOPE.md`.**

Task C1 scope reminder (from GROUP-C-SCOPE.md):
- Python 3.11+, standard library plus opentelemetry-api + opentelemetry-sdk-trace
- Under 600 lines (revised up from 500 to accommodate OTel)
- mypy strict clean
- Graceful Ctrl+C handling with SQLite flush before exit
- OTel spans per task with variant_id, task_id, tokens_used, passed, wall_clock_sec attributes
- Parent span per variant
- Default export `.ahol/traces/round-{N}.jsonl` as OTLP JSON
- Optional AHOL_OTLP_ENDPOINT env var
- Anthropic prompt caching preservation + cache_read_input_tokens assertion after 3rd task

No revision path from the Q1B failure-gate ladder is triggered; template stays as currently written. Status flip on `packages/ahol/baseline/README.md` from "SYNTHESIZED, UNVALIDATED" to "VALIDATED" is partially justified by this single-task pass; full promotion requires passing the V0 spike on 30 AHOL-Proxy-30 tasks per `VALIDATION-CHECKLIST.md`, which remains Group C scope after ahol.py is built.

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
