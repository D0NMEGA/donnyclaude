# WS-1 Dual-Trigger Refinement Smoke Test

Generated: 2026-04-23 UTC
Purpose: Verify the WS-1 dual-trigger fix (commit b85a972) actually fires both hook events live in a real Claude Code session.
Method: Project-local `.claude/settings.json` overlay at `/tmp/donny-smoke-ws1-fix/` registering both SessionStart and UserPromptSubmit triggers; `claude --print --model opus "help me set up a Django REST API"` subprocess; JSONL inspection.

## Setup

Index file at `~/.claude/.donnyclaude-skill-index.json` was updated before the smoke test to apply Path B autoInvoke flags (10 GSD workflow skills set to `autoInvoke: true`, the other 95 set to `false`). This simulates the post-install state that `applyInvocationFlags()` in `bin/donnyclaude.js` produces during a real `npx donnyclaude` install. Backup of the original index was preserved at `/tmp/donnyclaude-skill-index.backup.json` and restored after the smoke test (to avoid leaving the user's environment in an installer-without-installer-having-run state).

Note: `~/.claude/skills/*/SKILL.md` frontmatter was NOT modified during the smoke test. Only the index file was updated. To FULLY apply Path B the user must run `node bin/donnyclaude.js` so `applyInvocationFlags()` flips disable-model-invocation on the 95 non-top-K SKILL.md files.

## Smoke results

| Check | Result | Evidence (line numbers from smoke session JSONL) |
|---|---|---|
| WS-1 SessionStart fires | PASS | line 5: `{"attachment":{"type":"hook_success","hookName":"SessionStart:startup","hookEvent":"SessionStart","content":"","stdout":"{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"Relevant skills for this session (10 of 105 available, loaded on demand when referenced by name):...`. The hook ran with `SessionStart` argv, produced a valid `hookSpecificOutput` envelope with `hookEventName: "SessionStart"`, and the manifest content lists the 10 autoInvoke GSD skills. |
| WS-1 UserPromptSubmit fires | PASS | line 13: `{"attachment":{"type":"hook_additional_context","content":["Relevant skills for this session (10 of 105 available, loaded on demand when referenced by name):\n- gsd-autonomous: ...`. The hook ran with `UserPromptSubmit` argv after the user prompt landed. Note the attachment type is `hook_additional_context` (Claude Code routes UserPromptSubmit hook outputs differently than SessionStart hook outputs in the JSONL schema), but the content is the manifest. |
| No hook errors in stderr | PASS | grep for error/fatal/exception in JSONL only matches inside skill-description text (e.g. continuous-learning skill description includes the word "exception"), not actual hook stderr. |
| Session completes cleanly | PASS | Exit 0. Final assistant text response is normal (a Django REST API project was actually scaffolded; see Cost section below). |
| All 4 hook event types observed in JSONL | PASS | jq scan of `.attachment.hookEvent`: PostToolUse (21x Bash + 20x Write), PreToolUse (10x Write + 7x Bash + 6x Read), SessionStart (5x), UserPromptSubmit (1x). All expected events fired. |

## Behavioral finding (not a regression, but a refinement gap)

Both hooks fire and both emit the manifest, but they emit **identical content**: the 10 autoInvoke GSD skills. The Django prompt did not produce django-patterns, django-tdd, api-design, etc. in the WS-1 manifest, even though the prompt was unambiguously Django-themed.

**Root cause**: In `packages/hooks/skill-index.js` `pickTopK()`, the merged list starts with all autoInvoke skills, then fills remaining slots up to `TOP_K` (default 10) with prompt-matched skills. With Path B's 10 autoInvoke skills, the first 10 slots are taken before any prompt-matching skill can enter. `TOP_K = 10` plus `autoInvoke count = 10` means UserPromptSubmit refinement is dormant in the manifest output, even though the hook fires correctly.

The Django skills DID appear in the JSONL (1 occurrence each), but inside Claude Code's NATIVE `skill_listing` attachment (the always-on system-prompt skill catalog), not in the WS-1 manifest. So Claude could find them via the native catalog; the WS-1 hook just did not surface them as a refined recommendation.

**Three follow-up paths to surface refinement value**:
1. Raise `TOP_K` to 15 in `skill-index.js`. Leaves 5 slots for prompt-aware additions when 10 autoInvoke fill the first 10. Smallest change. Minor manifest size increase (~150 tokens).
2. Branch on `eventName` in `pickTopK()`: SessionStart returns autoInvoke only (orientation), UserPromptSubmit returns prompt-matched only (refinement, no autoInvoke padding since they are already in context from SessionStart). Cleaner separation. Requires plumbing eventName through to pickTopK.
3. Hybrid: SessionStart returns autoInvoke (10), UserPromptSubmit returns autoInvoke + 5 highest-scored prompt-matches (TOP_K = 15 just on UserPromptSubmit). Captures both orientation and refinement.

Path 1 is the smallest mechanical fix. Path 2 is the most architecturally clean. Path 3 is the most user-friendly.

Recommend Path 2 in a follow-up commit (`fix(hooks): WS-1 UserPromptSubmit returns prompt-matched only, not autoInvoke padding`) AFTER the AHOL spike completes. Out of scope for this turn (no further packages/ changes per spike scope).

## Cost note

The smoke test consumed approximately **2.66M tokens** in a single subprocess run. This is significantly higher than budgeted because `claude --print "help me set up a Django REST API"` interpreted the prompt as a real implementation request and proceeded to scaffold a working Django REST API project (settings.py, urls.py, models.py, views.py, serializers.py, tests, dev server) inside `/tmp/donny-smoke-ws1-fix/`. The smoke test became a real implementation session.

Implication for the AHOL D1 spike: per-task token budget control is critical. SWE-bench Lite tasks framed as "fix this issue" may similarly cause Claude Code to do extensive implementation work, escalating per-task cost from the projected 30K to potentially 200K-1M tokens. The 6M-token spike budget covers ~6 to 30 tasks at projected rates, but only ~6 to 30 tasks at observed rates. Recommend either:
- Tighter prompts in the SWE-bench Lite adapter (constrain Claude Code to ONLY produce a patch, not run extensive verification work).
- Smaller subset (5 tasks instead of 10 per run) for the noise-floor measurement.
- Larger budget authorization (~10M to 15M for the spike).

This finding is independent of the WS-1 trigger fix verification result. Surface for user decision.

## Index file restoration

Index file restored to its pre-smoke-test state (all autoInvoke=false) immediately after the smoke test completed. Reasoning: the user has not yet run `node bin/donnyclaude.js` to fully apply Path B, so the index file in their live environment should match the un-installed state. When the user is ready to fully apply Path B, running the installer will write the index AND flip `disable-model-invocation` on the 95 non-top-K SKILL.md files in one consistent operation.

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
