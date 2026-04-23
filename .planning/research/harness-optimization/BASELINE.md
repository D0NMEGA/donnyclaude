# Step 0 Baseline: harness-optimization

Generated at: 2026-04-22T (UTC, at measurement time)
Measured on: claude-opus-4-7 (Claude Code 2.1.117)
Purpose: Establish a pre-change measurement snapshot against which Step 2 DELTA.md can attribute gains to the four harness workstream changes (WS-1 always-loaded context, WS-2 tool-use invocation, WS-3 compaction, WS-4 session-start overhead).

## Session selected

- Session ID: 9742c210-2ead-4bf8-8f14-0f53d15635aa
- JSONL path: /Users/donmega/.claude/projects/-Users-donmega-Desktop-donnyclaude/9742c210-2ead-4bf8-8f14-0f53d15635aa.jsonl
- Initial user prompt (first 200 chars, verbatim): "Look into https://github.com/kyegomez/OpenMythos to see if it would be a better thing to use or implement in the harness, then continue with the gsd phases"
- Selection rationale: pure claude-opus-4-7 transcript (76 of 76 assistant turns on 4.7, zero mixed-model drift); multi-step /gsd run with real file-editing work (one Edit to package.json); clean run without error aborts. Selected per user decision after Option B was reframed in BLOCKERS.md: accept a 4.7-only session without subagent spawns and record metric 5 as a documented null-null comparison rather than cross-model confound (Option 2) or force a replay (Option 1).
- Start timestamp (UTC): 2026-04-21T00:20:14.800Z
- End timestamp (UTC): 2026-04-21T00:39:03.254Z
- Wall-clock duration: 1128.454 seconds (18m 48.454s, reported as 18m 49s)

## Baseline metrics

| # | Metric | Value |
|---|---|---|
| 1 | Total tokens consumed (all categories) | 7,045,650 |
| 2 | Total tool calls | 43 |
| 3 | Wall-clock duration | 1128.454s (18m 49s) |
| 4 | Tool-use failures and retries (sum) | 6 (3 failures + 3 retries) |
| 5 | Orchestrator re-reads of subagent artifacts | 0 (see criterion-5 note below) |

## Token breakdown

| Category | Tokens | Share of total |
|---|---:|---:|
| input_tokens | 12,549 | 0.18% |
| output_tokens | 111,855 | 1.59% |
| cache_creation_input_tokens | 559,289 | 7.94% |
| cache_read_input_tokens | 6,361,957 | 90.30% |
| Total | 7,045,650 | 100.00% |

Computed across 76 assistant-role entries. Cache-read dominance (90.3%) indicates the prompt prefix stayed warm across the session; this is the expected steady-state shape for a single multi-step /gsd run.

## Tool call breakdown

| Tool name | Count |
|---|---:|
| Bash | 28 |
| Read | 4 |
| TaskUpdate | 4 |
| TaskCreate | 3 |
| ToolSearch | 2 |
| Edit | 1 |
| WebFetch | 1 |
| Total | 43 |

Notes: TaskCreate and TaskUpdate here are local to-do UI operations (payload schema: subject, description, activeForm, status, taskId), not subagent spawns. Edit count (1) matches the scanned-pool triage row for 9742c210. Bash dominates at 28 of 43 calls (65%), consistent with a /gsd phase run that calls the gsd-tools CLI and git operations many times.

## Tool-use failures and retries

- is_error flagged results: 0 of 43
- Hidden failures (is_error: false, but content starts with "Error:"): 3
- Retries within 3 subsequent tool_use positions (same tool name): 3
- Sum reported in metric 4: 6

Concrete failures, all three consecutive Bash calls near the middle of the session:

1. `toolu_01Pz2r8DncPvzCUsc9cE92a5` (Bash) at position 35: `gsd-tools --help` returned "Error: Unknown flag: --help. gsd-tools does not accept help or version flags. Run gsd-tools with no arguments for usage." Retried within 3 positions.
2. `toolu_013V5EooTxTPVgvpVLXqqjA3` (Bash) at position 36: plain `gsd-tools` returned "Error: Usage: gsd-tools <command> [args] ..." (usage text dump after reading the command list). Retried within 3 positions.
3. `toolu_018xDp2EtWLt9t8y2wTrc7HJ` (Bash) at position 37: `gsd-tools commit` without message returned "Error: commit message required". Retried within 3 positions.

Observation: the three failures form a short probe-and-recover cluster while the session learned the gsd-tools CLI contract. None are harness-side errors; all are CLI-contract misuses caught by the tool itself and immediately corrected. The platform's is_error flag missed all three because the CLI returned its error text on stdout with exit 0 (or the harness did not surface the non-zero exit as is_error). This is relevant to WS-2: a post-change replay should surface these as flagged failures if WS-2 tightens tool-result error detection.

## Criterion 5 explanation

Metric 5 is 0 on this baseline because 9742c210 contains zero Agent or Task subagent spawns (confirmed via jq inspection of tool_use names and payload schemas; TaskCreate and TaskUpdate payloads carry fields subject/description/activeForm, identifying them as local to-do UI operations, not subagent spawns). On the Step 2 post-change replay of this same session's task, the spawn count remains 0 and the re-read count remains 0, yielding a legitimate null-null comparison rather than a missing-metric gap. A compaction-triggering or subagent-heavy benchmark can be added later if WS-specific impact on subagent orchestration needs to be measured directly.

Independent confirmation signals for the 0/0 finding:

- Zero `.isSidechain == true` entries in the JSONL.
- Zero tool_use entries whose `.input` contains a `subagent_type` field.
- Zero tool_use entries named `Agent` or `Task` (the two spawn tool names in Claude Code 2.1.x).
- No subagent sidecar directory exists for this session.

## Benchmark coverage

This baseline exercises always-loaded context (WS-1), tool-use invocation patterns (WS-2 and WS-4), and session-start overhead (WS-4). It does not exercise compaction (WS-3) or subagent orchestration. WS-3 measurement will require a compaction-triggering replay or a synthetic compaction event, deferred to Step 2 augmentation if needed.

## Measurement method

JSONL schema paths confirmed by inspection of the first entries:

- Entry-type discriminator at `.type` (values: assistant, user, attachment, file-history-snapshot, last-prompt, permission-mode, system).
- Token usage at `.message.usage` on assistant entries; keys include input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens.
- Tool uses at `.message.content[] | select(.type == "tool_use")` on assistant entries; name at `.name`, id at `.id`, input at `.input`.
- Tool results at `.message.content[] | select(.type == "tool_result")` on user entries; error flag at `.is_error`, matching tool_use by `.tool_use_id`, content at `.content` (string or array-of-text).
- Timestamps at `.timestamp` (ISO-8601 with millisecond precision and trailing Z).

Exact jq snippets executed (paths abbreviated here as $JSONL = /Users/donmega/.claude/projects/-Users-donmega-Desktop-donnyclaude/9742c210-2ead-4bf8-8f14-0f53d15635aa.jsonl):

Metric 1 (tokens):
```
jq -s '[.[] | select(.type == "assistant") | .message.usage] |
  { input: (map(.input_tokens // 0) | add),
    output: (map(.output_tokens // 0) | add),
    cache_creation: (map(.cache_creation_input_tokens // 0) | add),
    cache_read: (map(.cache_read_input_tokens // 0) | add) } |
  . + {total: (.input + .output + .cache_creation + .cache_read)}' $JSONL
```

Metric 2 (tool calls per name):
```
jq -c 'select(.type == "assistant") | .message.content[]? |
  select(.type == "tool_use") | .name' $JSONL | sort | uniq -c | sort -rn
```

Metric 3 (wall-clock):
```
jq -s '[.[] | select(.timestamp != null) | .timestamp] |
  {first: .[0], last: .[-1]}' $JSONL
```
Wall seconds computed in Python: `(datetime.fromisoformat(last) - datetime.fromisoformat(first)).total_seconds()` = 1128.454.

Metric 4 (failures plus retries):
```
jq -s '
  [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | {name, id}] as $tool_uses |
  ([.[] | select(.type == "user") | .message.content | if type == "array" then .[] | select(type == "object" and .type == "tool_result") | {id: .tool_use_id, is_error: (.is_error // false), content_text: (if (.content | type) == "string" then .content elif (.content | type) == "array" then (.content | map(if type == "object" and has("text") then .text else "" end) | join(" ")) else "" end)} else empty end] | map({(.id): .}) | add) as $results |
  [$tool_uses[] | . + {errored: (if $results[.id] then ($results[.id].is_error or (($results[.id].content_text // "") | test("^Error:"; "i"))) else false end)}] as $seq |
  [range(0; $seq | length) as $i | $seq[$i] | select(.errored) |
    {idx: $i, name: .name, id: .id,
     retried_within_3: ([$seq[$i+1: $i+4][] | select(.name == $seq[$i].name)] | length > 0)}]' $JSONL
```
This returns 3 errored entries, all with retried_within_3 = true, giving failure count 3 and retry count 3.

Metric 5 (subagent spawns and re-reads):
```
jq -s '
  { sidechain_count: ([.[] | select(.isSidechain == true)] | length),
    subagent_type_uses: ([.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and (.input | has("subagent_type")? // false))] | length) }' $JSONL
```
Both returned 0. Agent-or-Task tool_use scan returned 0 distinct Agent/Task entries (TaskCreate/TaskUpdate are local to-do UI and were excluded by payload-schema inspection, as documented in BLOCKERS.md).

## Caveats

- Wall-clock uses the first and last `.timestamp` across all entry types (262 of 292 entries carry a timestamp). Metadata entries (permission-mode, file-history-snapshot, last-prompt, system) can appear after the final assistant text; for this session the final timestamp is on an assistant tool_use, so the reading is tight. A stricter "last assistant text turn" anchor would yield a slightly smaller number, but the user accepted the 18m 49s figure in the unblock decision.
- The three "hidden" Bash failures (Error-prefix text on stdout with is_error: false) are counted in metric 4 as failures even though the platform did not flag them. Step 2 should apply the same detection heuristic so the comparison is apples-to-apples. If WS-2 changes cause the harness to start emitting is_error: true for these cases, the raw is_error count in Step 2 will appear to rise while the semantic failure count stays flat; the explanation-column must call this out.
- Token totals sum each category independently and do not deduplicate cache reads against the prompt prefix they represent. This is the convention the user specified in the task ("sum across assistant-role entries of all four usage fields"); it inflates the headline total relative to unique-input accounting but is stable for delta comparison.
- Per-tool breakdown treats tool names exactly as emitted. No aliasing applied.
- Baseline does not exercise compaction (WS-3) or subagent orchestration; see the benchmark-coverage section above.
- Session d0bb21bc (the currently running Step 0 session) is excluded from the measurement; all measurements are against 9742c210 only.
