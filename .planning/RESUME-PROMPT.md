# Resume Prompt for Fresh Claude Code Session

Paste the block below into a new Claude Code session in `~/Desktop/donnyclaude` after restart.

---

## Resume context: donnyclaude AHOL spike, paused for context

We're mid-AHOL D1 spike pre-flight. Context filled in the previous session; saved here for clean continuation. Read this whole prompt before acting. Hard constraints: no em dashes anywhere (commits, code, prose, markdown); no amending commits, always new commits; AHOL writes go to `.planning/research/ahol/` only; v1.2 RC publish + d0nAI separation + cobol rules + return-contract rollout on 44 agents + multi-candidate patch pipeline are all out of scope for this session.

### What shipped tonight (origin/main)

15 commits, latest = `996e93b fix(installer): scope applyInvocationFlags to donnyclaude-shipped skills only`. Plus the GSD update commit just landed (1.32.0 to 1.38.3 install). To list: `git log --oneline -16`.

Top hits:
- WS-1 (Path B): per-skill disable-model-invocation flip at install time on 95 non-top-K skills, runtime top-K manifest. Measured 78.4% always-loaded skill-catalog reduction.
- WS-2: PostToolUse verify-edit hook with false-success text-pattern detection (the BASELINE.md is_error-unreliable intel).
- WS-3: PreCompact active backup + SessionStart restore advisor; PASS on synthetic round-trip.
- WS-4: SessionStart inline 2,288-char one-liner refactor to script; 83.4% block reduction, 83 ms median cold-start.
- Rec #10: proactive 60% compaction override in settings-template.json env.
- WS-1 dual-trigger fix: skill-index.js reads event from argv, hooks.json adds UserPromptSubmit registration.
- Installer scope fix: applyInvocationFlags() now scopes to donnyclaude-shipped skills only (was overshooting and disabling 22 non-donnyclaude plugin skills, restored manually before the fix landed).

### What is open

1. **Deep research**: external Claude web run launched with Option 2 scope (public benchmarks + proxy-benchmark co-equal Q1b). Package at `~/Downloads/ahol-deep-research-20260423-0308.zip`. When findings return, paste them or summarize so I can fold into a revised AHOL spec and update `.planning/research/ahol/spike-results.md`.

2. **AHOL D1 spike runs (Step 6) blocked on**:
   - Deep research return (need patch-only template answer to size SWE-bench Lite per-task cost)
   - Spike budget decision: (a) tighten prompts at nominal 6M, (b) reduce subset to 5x3=15 runs at ~3M, (c) authorize 10-15M, (d) defer until tighter cost control. Pick after research returns.

3. **Macs Fan Control**: PID 27313 confirmed running last session. Re-verify with `pgrep -x "Macs Fan Control"`. Step 5 (thermal baseline capture via `sudo powermetrics --samplers smc,cpu_power -n 1 -i 1`) ready when you want it.

4. **Docker**: tuned to CPUs 4, Memory 11.68 GiB. Verified via `docker info`. Ready for SWE-bench Lite once spike kicks off.

5. **WS-1 refinement-overlap follow-up**: per `.planning/research/ahol/ws1-refinement-smoke.md`, both SessionStart and UserPromptSubmit triggers fire correctly but emit identical content because `pickTopK` fills 10 slots with autoInvoke before any prompt-match enters. Three fix paths documented; recommended is Path 2 (branch on eventName so UserPromptSubmit returns prompt-matched only). One-commit follow-up after spike completes; out of scope for spike turn.

6. **GSD just updated to 1.38.3**: restart Claude Code to pick up new commands (`/gsd-spec-phase`, `/gsd-spike`, `/gsd-sketch`, `/gsd-progress --forensic`, etc.). The injection-scanner hook + agent size-budget enforcement + shared-reference extraction may meaningfully reduce per-dispatch context overhead in subagent spawns going forward.

7. **Path B install dogfood completed**: ran `node bin/donnyclaude.js`. Currently 96 skills disabled (95 donnyclaude non-top-K + 1 cruft), 10 GSD top-K + 22 restored non-donnyclaude skills enabled. Net effect on this session: lower system-prompt skill-catalog overhead, but you may notice some less-frequently-used donnyclaude skills (humanizer, plankton-code-quality, etc.) no longer auto-invoke. Override per skill via `~/.claude/settings.json` `skills.autoInvoke[skillName] = true`.

### Cosmetic noise to ignore

- `/doctor` reports 1 plugin error: vercel + vercel-plugin both register the same MCP server, vercel was skipped. Cosmetic. Disable one of the two duplicate plugins in `~/.claude/settings.json` `enabledPlugins` if it bothers you.
- Claude Code 2.1.117 -> 2.1.118 patch available. Not urgent.
- Skill injection hooks fired ~6 times during session for vercel-plugin matches on lexical token recall (workflow, verification, sandbox, ai-sdk, etc.). All false positives because donnyclaude is not a Vercel project. The injections are advisory, not blocking; safe to keep ignoring.

### Suggested first action on resume

Run `git log --oneline -20` and `cat .planning/research/ahol/spike-results.md` to confirm state matches what is described above. Then either (a) paste deep research findings if they have returned, or (b) say "fan baseline" to do Step 5 thermal capture while we wait, or (c) say "WS-1 path 2" to do the one-commit refinement-overlap follow-up.

Do NOT run the AHOL D1 spike runs (Step 6) until deep research returns and we resolve the patch-only-template question. Per-task cost is unknown without it; smoke test surprised at 2.66M tokens vs 50K nominal.

---

End of resume prompt.
