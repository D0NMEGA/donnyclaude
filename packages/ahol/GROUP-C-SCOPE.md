# AHOL Group C Scope Notes

Scope notes for Group C implementation tasks. This document specifies
observability and operational scope for the two primary Python/shell
components that AHOL introduces:

1. `ahol.py`: the Python orchestrator (Tier 1) that also invokes the Python
   variant-runner (Tier 2).
2. `invoke-task.sh`: the per-task shell wrapper (Tier 3 entry) that calls
   `claude --print` inside an isolated Docker container and returns a
   validated task-runner return payload.

This is separate from `packages/ahol/baseline/invoke.sh`, which is the Q1b
baseline CLI invocation wrapper. `invoke-task.sh` is a NEW wrapper that
AHOL's Python variant-runner uses per task.

## `ahol.py` scope

### OpenTelemetry side-channel

OpenTelemetry traces are emitted alongside SQLite writes (additive, not
replacing SQLite). SQLite remains the primary persistence layer and the
ground truth for the champion-promotion decision; OTel provides a parallel
stream suitable for export to Langfuse, Braintrust, Datadog, or other
observability backends without vendor lock-in.

#### Dependencies

- `opentelemetry-api` and `opentelemetry-sdk-trace` Python packages.
- Pinned to latest 1.x series; exact pin decision deferred to implementation
  time so that a concrete version can be selected against the stability of
  the 1.x API surface at the moment of implementation.

#### Span shape

One span per Tier 3 task invocation with attributes:

- `variant_id`: short canonical form (for example, `V0`, `V4`) or long slug
  form (`variant-baseline-01`).
- `task_id`: benchmark task identifier (for example,
  `swe-bench-lite-astropy-12345`).
- `tokens_used`: integer total tokens for the task.
- `passed`: boolean outcome.
- `wall_clock_sec`: floating-point seconds.
- `patch_sha`: 40-character lowercase SHA-1 hex string, OR the literal
  sentinel `no_patch`.
- `error_summary`: nullable string diagnostic.

One parent span per variant, with child task spans nested under it. Parent
span attributes:

- `variant_id`: matches the child spans.
- `tasks_completed`: integer.
- `tasks_passed`: integer, where `tasks_passed <= tasks_completed`.
- `total_tokens`: integer aggregate across child tasks.
- `wall_clock_sec`: floating-point seconds for the variant-level run.

#### Export targets

- **Default**: local file `.ahol/traces/round-{N}.jsonl` as OTLP JSON (one
  span per line). File-only by default so that a spike run produces a
  self-contained trace artifact on disk with no external dependency.
- **Optional endpoint**: if the environment variable `AHOL_OTLP_ENDPOINT`
  is set, also export via standard OTLP HTTP or gRPC to the given endpoint.
  When unset, export stays file-only.

#### Justification

Validated as a production standard by the Mastra book (Bhagwat, 2025,
chapter 16). OTel provides portability to Langfuse, Braintrust, Datadog,
and other backends without coupling AHOL to any single vendor.

Added implementation effort: 2 to 4 hours.

### Anthropic prompt caching verification

Claude's automatic prompt caching applies when the system prompt PREFIX is
preserved exactly across invocations. AHOL's patch-only template is the same
for every task in a round, so if the CLI preserves the prefix cache-stable,
the 2nd and subsequent tasks in a round should hit the cache.

#### Required behavior

- The Python runner's `claude --print` invocations MUST preserve the
  patch-only system prompt PREFIX exactly across tasks within a round.
- Verify by checking response metadata for `cache_read_input_tokens` on the
  2nd and subsequent task invocations in the same round.
- The first task should show `cache_creation_input_tokens` greater than 0
  and `cache_read_input_tokens` equal to 0.
- The 2nd and subsequent tasks should show `cache_read_input_tokens`
  greater than 0.

#### Cost implication

If caching is not firing, that is a 90 percent token discount left on the
table, and the 10M-per-variant budget projection in COST-MODEL.md will be
dramatically underestimated (reads cost 1/10 the creation price; missing the
cache means paying full price on every task).

#### Startup assertion

Add a startup assertion in `ahol.py`: after the 3rd task of a round, if
`cache_read_input_tokens` is zero on all invocations so far, log a WARNING
(not FATAL) that caching is not working. Continue the round but surface the
warning prominently in the round summary written alongside `CHAMPION.md`.

#### Implementation hint

Anthropic's `cache_control` parameter in the Messages API uses prefix-based
caching. The `claude --print --system-prompt-file` flag should preserve the
prefix cache-stable. If verification shows it is not, investigate whether
the CLI wraps the system prompt in additional context (session metadata,
timestamps, request IDs) that breaks the prefix match. If the CLI injects
dynamic content, consider switching to the direct Messages API with
explicit `cache_control` markers.

## `invoke-task.sh` scope

### Raw trace logging

`invoke-task.sh` writes human-readable per-task logs alongside the SQLite row.
This is the 3am-debugging file: when a task unexpectedly fails and the SQLite
row shows only `passed=false`, the log file has the actual terminal output so
the human can diagnose.

#### File path

`.ahol/logs/round-{N}/variant-{V}/task-{T}.log`

Where `{N}` is the round number, `{V}` is the variant identifier, and `{T}`
is the task identifier. One file per task invocation.

#### Log contents

Each file contains:

- Raw `claude --print` stdout.
- Raw `claude --print` stderr.
- Elapsed wall-clock time (seconds, floating-point).
- Exit code.
- Environment variables that were set for the invocation: `AHOL_BASELINE`,
  `TASK_PROMPT` hash (not the raw prompt, to keep log size bounded on tasks
  with large issue bodies).

#### Purpose

SQLite captures structured outcome data (passed, tokens, timing). The JSON
return payload captures validated fields defined by the schema. Neither is
sufficient when the failure mode is unexpected (for example, a crash inside
the tool loop, a permission denial from Docker, a malformed system prompt
that silently degrades output). The raw log preserves the untransformed
terminal output so a human can diagnose what the structured fields omit.

Added implementation effort: 30 minutes.

### Relationship to OpenTelemetry

OTel spans carry structured attributes derived from the return payload.
Raw task logs carry unstructured terminal output. The two are complementary:
OTel is for dashboards and aggregate queries; raw logs are for incident
forensics on a single task.
