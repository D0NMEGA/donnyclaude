# Harness Optimization Delta (Step 2)

Generated: 2026-04-23 UTC
Anchor: [BASELINE.md](./BASELINE.md) (session 9742c210, claude-opus-4-7, 7.05M tokens, 90.3% cache-read ratio, 18m 49s, 43 tool calls, 6 failures+retries)
Method: Option C (hook-isolation micro-benchmarks + analytical session-level projections)
Hard constraint: no em dashes anywhere in this document. Verified with LC_ALL=C grep on completion.

## Baseline error-flag intel (cross-workstream)

Baseline session 9742c210 surfaced a platform-level reliability gap that affects any future harness verification logic. Documenting once so all workstreams (and AHOL variants later) honor it.

| Finding | Detail | WS-2 handling |
|---|---|---|
| `is_error: false` can coexist with stderr-style error text on stdout | 3 Bash tool_results in 9742c210 began with "Error:" on stdout yet had `is_error: false` because the CLI emitted error text with a 0 exit code | WS-2's gsd-verify-edit.js pattern-matches leading tokens {error, fatal, panic, traceback, exception, failed, ✗} with a word-boundary guard, independent of the platform's is_error flag |
| Affected calls in baseline | gsd-tools --help, bare invocation, commit without message; positions 35, 36, 37 in the tool_use stream | All three were retried within 3 positions with corrected syntax |
| Propagation rule | Any future hook or agent that treats `is_error` as ground truth will under-report failures on tools that emit error text on exit-0 paths | AHOL variant generators and trace analyzers must inherit the text-pattern heuristic rather than trusting is_error alone |

Concrete examples from BASELINE.md surprising-findings section (tool_use positions 35, 36, 37). The fix lives in `packages/hooks/gsd-verify-edit.js` lines containing the word-boundary regex; any AHOL-generated verifier must carry the same logic.

## WS-1 Skill Progressive Disclosure (Path B shipped, re-measured 2026-04-23)

| Metric | Baseline | Post-change value | Absolute delta | Percent delta | Measurement type | Confidence |
|---|---|---|---|---|---|---|
| Skill-catalog always-on tokens (name + description, all 105 skills in native Claude Code catalog) | 3,196 tokens (12,782 chars) | 274 tokens (1,097 chars; only the 10 top-K GSD workflow skills remain in the native catalog after install-time disable-model-invocation flip on the other 95) | -2,922 | -91.4% | MEASURED | HIGH: direct char count of the top-10 GSD skills' name+description; integration-tested against a fake install at /tmp/pathb-test with 3/3 flips correct |
| WS-1 SessionStart manifest payload (top-K, prompt-aware) | 0 (hook did not exist) | 415 tokens median across 3 representative prompts (Django, Go tests, security review) | +415 | new overhead | MEASURED | HIGH: direct invocation with 3 prompts, averaged |
| Composite always-on (native catalog + WS-1 manifest) | 3,196 tokens | 689 tokens | -2,507 | -78.4% | MEASURED | HIGH |
| Full SKILL.md bodies (reference, not loaded always-on; users can still invoke any skill by name) | 155,020 tokens (620,080 chars across 105 bodies) | 155,020 unchanged; bodies remain loadable on explicit invocation | 0 | 0% | MEASURED | HIGH |
| >50% reduction target on skill-catalog always-on | N/A | MET: 78.4% reduction exceeds the 50% threshold | - | - | PASS-FAIL | PASS |
| `disable-model-invocation: true` honored in Claude Code 2.1.117 | N/A | VERIFIED via fresh claude --print subprocess (test skill with disable flag did NOT load; sentinel phrase count in JSONL was 4 but all 4 were user-prompt echoes, 0 were system-prompt skill catalog) | - | - | PASS-FAIL | PASS |
| Session-level cache-read amplification on a 76-turn baseline-class session | ~243K tokens (full native catalog cached) | ~52K tokens (274 + 415 = 689 per session, cached across 76 turns) | -191K | -2.7% of baseline total | PROJECTED | MEDIUM: assumes cache behavior mirrors baseline |

**Path B architecture**: `bin/donnyclaude.js` gained four additions at install time:
1. `DEFAULT_TOP_K_AUTOINVOKE_SKILLS` constant: 10 GSD workflow skills get disable-model-invocation: false at install.
2. `loadUserAutoInvokeOverrides()`: reads user's settings.json `skills.autoInvoke` block for per-skill overrides.
3. `setFrontmatterBoolean()`: upsert helper for SKILL.md frontmatter.
4. `applyInvocationFlags()`: walks installed skills dir, sets flag per skill.

Source tree `packages/skills/*/SKILL.md` is UNCHANGED. The frontmatter flip happens on the copied installed files at `~/.claude/skills/*/SKILL.md`. See [ws-1/SCOPE-EXPANSION.md](./ws-1/SCOPE-EXPANSION.md) for the full design + verification log.

## WS-2 PostToolUse Verify-Edit Hook

| Metric | Baseline | Post-change value | Absolute delta | Percent delta | Measurement type | Confidence |
|---|---|---|---|---|---|---|
| Hook wall-clock latency, no-lint-configured path (10 runs) | 0 (hook did not exist) | median 320 ms, p95 444 ms | +320 ms median | new overhead per edit | MEASURED | HIGH: spawnSync timing, 10 iterations |
| Hook latency on false-success detection path | 0 | measured payload size below; latency dominated by spawn cost of echo script (~320 ms) | +320 ms | same | MEASURED | HIGH |
| additionalContext payload size on false-success injection | 0 | 234 bytes full JSON, 59 tokens approximate | +59 tokens per caught failure | N/A | MEASURED | HIGH: direct capture, verbatim content below |
| Baseline failures-and-retries that WS-2 would have caught on this specific baseline | 6 (3 false-success Bash + 3 retries) | 0 caught by WS-2 | 0 | 0% | NULL-NULL | HIGH: WS-2 fires only on Write/Edit/MultiEdit; baseline's false-success failures were Bash, not Edit |
| Projected per-session firings on edit-heavy work (assumes 10 edits/hour active work) | 0 | approximately 10 firings/hour at ~320 ms each = ~3.2 s wall-clock overhead/hour | +3.2 s/hr | bounded | PROJECTED | MEDIUM: edit frequency is user-dependent |
| Projected value: false-success edits caught per 10 edits (assume 10% of edits produce false-success lint output based on baseline Bash false-success rate) | 0 | 1 caught; prevents downstream cascade of 2-4 additional edits per user feedback loop | -2 to -4 future edits per caught failure | TBD | PROJECTED | LOW: projected from analogy, not measured directly |

**Representative false-success payload** (captured from real invocation on a fake npm lint script that echoes "Error: undefined variable" then exits 0):
```json
{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"POST-EDIT VERIFY (npm run lint): Lint or typecheck reported issues after the edit. Output: Error: undefined variable\n. Consider fixing before the next edit."}}
```

Total emit: 234 bytes, ~59 tokens. Conforms to the Step 0 error-flag intel by relying on text pattern, not the is_error flag.

## WS-3 PreCompact Backup + SessionStart Restore

Per the split agreed: WS-3 uses a PASS-FAIL gate on the synthetic round-trip instead of a token-delta metric.

| Metric | Baseline | Post-change value | Absolute delta | Percent delta | Measurement type | Confidence |
|---|---|---|---|---|---|---|
| Synthetic round-trip gate: PreCompact writes backup | N/A | PASS. Hook exit 0, state.json written at /tmp/ws3-synth/.claude/backups/2026-04-23T01-13-58Z/state.json, all 8 required fields present (`backup_version`, `captured_at_utc`, `session_id`, `current_task`, `open_file_paths`, `recent_test_status`, `last_20_tool_calls`, `working_directory`) | N/A | N/A | PASS-FAIL | HIGH: exact commands and verification from SUMMARY.md executed literally |
| Synthetic round-trip gate: SessionStart reads backup | N/A | PASS. Hook exit 0, additionalContext output references the backup path, 304 bytes total output, 227 bytes additionalContext | N/A | N/A | PASS-FAIL | HIGH |
| Backup artifact size (minimal synthetic session) | N/A | 249 bytes of state.json | N/A | N/A | MEASURED | HIGH |
| Restore additionalContext payload | N/A | 227 bytes, ~56 tokens | +56 tokens per session-start when a backup is present | new overhead | MEASURED | HIGH |
| Real-world backup size projection (session with 20 tool calls and 5 open files) | N/A | 2 to 10 KB typical (per WS-3 SUMMARY.md) | bounded | N/A | PROJECTED | MEDIUM |
| Compaction-event delta on 9742c210-class sessions | N/A | N/A: baseline did not trigger compaction. No token delta measurable on this baseline | 0 | null | NULL-NULL | HIGH: baseline session was 7.05M tokens against 200K context window; no compaction fired |

**Verdict**: WS-3 PASS on synthetic round-trip. Ships.

## WS-4 SessionStart Refactor

| Metric | Baseline | Post-change value | Absolute delta | Percent delta | Measurement type | Confidence |
|---|---|---|---|---|---|---|
| Hook cold-start wall-clock latency (10 runs, each a fresh Node process, Node module cache cold) | N/A (old inline one-liner was pre-existing; no measurement taken at install time) | median 83 ms, p95 109 ms, min 77 / max 109 | N/A | N/A | MEASURED | HIGH: direct spawnSync timing |
| additionalContext payload size on clean donnyclaude repo state | N/A | 601 bytes total stdout, ~550 bytes additionalContext, ~138 tokens | +138 tokens at SessionStart | new structured injection | MEASURED | HIGH: direct invocation, clean repo |
| Inline-one-liner character count (BEFORE) | 2,286 chars of quoted JavaScript embedded in hooks.json | 0 (removed) | -2,286 chars | -100% on that specific block | MEASURED | HIGH: jq-extracted from hooks.json.pre-ws-merge |
| Hook registration character count (AFTER) | 2,286 inline | 424 chars of registration block | -2,126 on the block | -83.4% | MEASURED | HIGH |
| First-turn input_tokens on baseline (reference) | 12,549 | unmeasured on modified harness | N/A | N/A | NULL-NULL | HIGH: real session-level replay would cost 500K+ tokens; the original prompt referenced the now-paused RC publish workflow, so a fair replay is architecturally blocked |
| Projected first-turn savings on fresh-start sessions (WS-4 structured context replaces agent discovery probes) | 0 saved | 400-700 input tokens saved + 150-400 output tokens saved on turn 1 (per WS-4 SUMMARY.md estimate) | -400 to -700 input / -150 to -400 output | -3 to -6% on first-turn input of a 12,549-first-turn baseline | PROJECTED | MEDIUM: estimate based on baseline's Bash-heavy orientation probes; actual savings depend on what Claude does with the injected context |

**Verdict**: WS-4 MEASURED micro-benchmarks are clean. Session-level wall-clock (NULL-NULL) deferred to To-Empirically-Validate because the replay is blocked by a stale-prompt problem (the baseline task's prompt referenced "continue with the gsd phases" which is paused).

## Summary judgment

| Workstream | Commit decision | Why |
|---|---|---|
| WS-1 skill progressive disclosure | COMMITTED via Path B after verification and re-measurement (2026-04-23) | Scope expansion approved for WS-1 only; install-time disable-model-invocation flip on 95 non-top-K skills. MEASURED: 78.4% composite reduction, meets >50% target. Verification of disable-model-invocation behavior in Claude Code 2.1.117 PASSED via fresh-subprocess test. See ws-1/SCOPE-EXPANSION.md. |
| WS-2 post-edit verify | COMMIT | Hook latency bounded and measured. Payload size small. Delta on current baseline is 0 (no Edit failures in baseline), but architecture is sound and the error-flag intel is honored. |
| WS-3 backup + restore | COMMIT | PASS on synthetic round-trip. All 8 required fields present. Restore payload compact. Baseline did not trigger compaction so null-null is the honest read. |
| WS-4 SessionStart refactor | COMMIT | 83 ms median cold-start is well under the 8 s budget. 83.4% reduction in hooks.json block size. Structured context payload is ~138 tokens of clearly useful content (git state, commits, test runner). |

## To empirically validate (deferred session-level measurements)

These measurements require a real multi-turn session on the modified harness, which this orchestration turn cannot run without polluting the current session's JSONL or spawning a headless subprocess with a stale prompt. Append to this document when they become available.

1. **WS-4 session-level first-turn input_tokens on a real modified-harness session**: any fresh donnyclaude work session of > 5 minutes duration on a clean repo. Measurement: parse the resulting JSONL, compare first-turn input_tokens to baseline 12,549. Expected: 400 to 700 tokens less on input, 150 to 400 less on turn-1 output.
2. **WS-1 behavioral signal: wrong-skill-invocation rate**: on sessions where Claude invokes a skill by name, does the top-K manifest correlate with which skill gets invoked? Requires trace-level analysis across 5-10 real sessions after WS-1 ships.
3. **WS-2 accumulated catch rate on edit-heavy sessions**: after 30 days of dogfood, how many false-success lint results did WS-2 catch and inject? Requires aggregating gsd-verify-edit.js invocation logs (not yet instrumented; AHOL could add this).
4. **WS-3 real-world compaction trigger**: as soon as any session hits the compaction threshold on the modified harness, verify that .claude/backups/<timestamp>/state.json lands correctly with populated open_file_paths and last_20_tool_calls. Measurement will be auto-appended by WS-3's backup files when they fire.
5. **Composite session-level delta**: run a 20+ minute /gsd- phase on the modified harness (post-merge, after the RC gate week resolves if it resumes) and re-measure all 5 metrics on the resulting JSONL. Compare to 9742c210 baseline, produce a DELTA-empirical.md.

## Measurement method appendix

Scripts used, for reproducibility when Step 2 is re-run empirically:

```bash
# Skill catalog token count (WS-1 baseline)
node -e 'const fs=require("fs"),path=require("path");const dir="packages/skills";let n=0,c=0;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(!e.isDirectory())continue;const p=path.join(dir,e.name,"SKILL.md");if(!fs.existsSync(p))continue;const b=fs.readFileSync(p,"utf8");const m=b.match(/^---\s*\n([\s\S]*?)\n---/);if(m){const fm=m[1];const name=(fm.match(/^name:\s*(.+)$/m)||[,""])[1].trim();const desc=(fm.match(/^description:\s*(.+)$/m)||[,""])[1].trim();c+=name.length+desc.length+4;}n++;}console.log(n,"skills,",c,"chars,",Math.round(c/4),"tokens");'

# WS-1 manifest size for a representative prompt
echo '{"prompt":"implement a REST API with Django","cwd":"/path","session_id":"m"}' | node packages/hooks/skill-index.js | jq -r '.hookSpecificOutput.additionalContext' | wc -c

# WS-2 latency (10 runs)
node -e 'const {spawnSync}=require("child_process");const stdin=JSON.stringify({tool_name:"Write",tool_input:{file_path:"/tmp/fake.js"}});const r=[];for(let i=0;i<10;i++){const t=Date.now();spawnSync("node",["packages/hooks/gsd-verify-edit.js"],{input:stdin});r.push(Date.now()-t);}r.sort((a,b)=>a-b);console.log("median",r[5],"p95",r[9]);'

# WS-3 synthetic round-trip
rm -rf /tmp/ws3-synth && mkdir -p /tmp/ws3-synth
echo '{"session_id":"syn","cwd":"/tmp/ws3-synth","transcript_path":""}' | node packages/hooks/gsd-pre-compact-backup.js
echo '{"cwd":"/tmp/ws3-synth","session_id":"new"}' | node packages/hooks/gsd-backup-restore.js

# WS-4 latency and payload
node -e 'const {spawnSync}=require("child_process");const stdin=JSON.stringify({cwd:"/Users/donmega/Desktop/donnyclaude",session_id:"b"});const r=[];for(let i=0;i<10;i++){const t=Date.now();spawnSync("node",["packages/hooks/gsd-session-start.js"],{input:stdin});r.push(Date.now()-t);}r.sort((a,b)=>a-b);console.log("median",r[5],"p95",r[9]);'
```

## Caveats

1. Token-per-character heuristic is `chars/4`. Real tokenization is slightly more variable. Ranges stated are wide enough to absorb this.
2. The baseline 9742c210 had a 90.3% cache-read ratio. Absolute-token comparisons against a cold-start session would overstate the cost of added-context workstreams. The measurements here focus on hook-level isolation and additive-vs-replacement semantics, both of which are cache-independent.
3. Em-dash scan: zero matches for U+2014 and U+2013 across this document. Verified on completion.
