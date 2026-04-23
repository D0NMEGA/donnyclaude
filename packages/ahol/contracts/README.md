# AHOL Contracts

JSON Schema contracts for the data produced by each tier of the AHOL
(Autonomous Harness Optimization Loop) runner hierarchy. These are
Python-to-Python data contracts enforced via `jsonschema.validate()`. The
orchestrator and variant-runner are Python processes; they produce and consume
JSON per the schemas in this directory. Prose returns are not even possible at
Tiers 1 and 2 because there is no LLM in the loop at those tiers. Every Python
process writing a contract-conforming JSON payload validates the payload
against its schema before writing to SQLite or returning to the caller.

Validation failures are treated as infrastructure errors by the calling tier,
NOT as task failures.

## Tier map

AHOL runs three tiers per round:

| Tier | Role              | Implementation                | Writes to                           | Schema                                |
| :--: | :---------------- | :---------------------------- | :---------------------------------- | :------------------------------------ |
|  1   | Orchestrator      | Python (`ahol.py`)            | `CHAMPION.md` plus round summary JSON | `orchestrator-output.schema.json`     |
|  2   | Variant runner    | Python (invoked by `ahol.py`) | SQLite row plus return dict          | `variant-runner-return.schema.json`   |
|  3   | Task runner       | Shell (`invoke-task.sh`) plus `claude --print` | SQLite row plus JSON file | `task-runner-return.schema.json`      |

The Tier 1 orchestrator writes `CHAMPION.md` and a round summary JSON file
conforming to `orchestrator-output.schema.json`. Tier 2 variant-runner
processes construct a dict, validate it, write a row to SQLite, and return the
dict to the orchestrator (as either a return value or a JSON file handoff,
depending on invocation style). Tier 3 task-runner invocations write a JSON
file per task that the Tier 2 process reads, validates, and aggregates into
SQLite.

## Schemas

### `orchestrator-output.schema.json`

Validates the round summary record the Tier 1 orchestrator writes to disk.
Captures the champion selection, the sigma and cost gate verdicts, the exact
SQL used for ranking, and aggregate round telemetry.

### `variant-runner-return.schema.json`

Validates the JSON object a Tier 2 variant-runner returns to the orchestrator
after fanning out Tier 3 task-runners and aggregating their results via SQLite.
The `variant_id` property matches either the short canonical form (`V7`) or
the long slug form (`variant-baseline-01`). Invariant documented on
`tasks_passed`: `tasks_passed <= tasks_completed`.

### `task-runner-return.schema.json`

Validates the JSON object a Tier 3 task-runner returns to its Tier 2 parent
after running exactly one benchmark task in an isolated container. The
`patch_sha` property accepts either a 40-character lowercase SHA-1 hex string
OR the literal sentinel `no_patch`. `tokens_used` is hard-capped at 2,000,000
to catch runaway loops.

## Validation flow

Each Python process executes this sequence before writing to SQLite or
returning to the caller:

1. Python function constructs a dict in memory.
2. Load the matching schema from `packages/ahol/contracts/`.
3. Call `jsonschema.validate(instance=return_dict, schema=schema)`.
4. On failure: raise `jsonschema.ValidationError` (Tier 1 and Tier 2 Python
   processes propagate the exception with a diagnostic; the orchestrator logs
   and treats it as infrastructure error).
5. On success: write the row to SQLite (Tier 2 aggregation) or write the JSON
   file (Tier 1 round summary; Tier 3 per-task output consumed by Tier 2).

For Tier 3: `invoke-task.sh` collects the `claude --print` output and exit
status, assembles the task-runner return dict, and passes it to the Tier 2
Python process which runs `jsonschema.validate()` before inserting the SQLite
row.

The calling tier treats a validation error or nonzero exit from a child
process as an infrastructure error, NOT a task failure. For the variant-runner
this means a crashing task-runner does NOT decrement `tasks_passed`; it is
logged in `error_log` and `tasks_completed` does not count the crashed task.

### Python validation pseudocode

```python
import json
import sqlite3
from pathlib import Path

import jsonschema

CONTRACTS_DIR = Path(__file__).resolve().parent / "packages" / "ahol" / "contracts"


def validate_payload(payload: dict, schema_filename: str) -> None:
    """Raise jsonschema.ValidationError on failure; return None on success."""
    schema_path = CONTRACTS_DIR / schema_filename
    with schema_path.open("r", encoding="utf-8") as fh:
        schema = json.load(fh)
    jsonschema.validate(instance=payload, schema=schema)


def persist_task_result(conn: sqlite3.Connection, task_payload: dict) -> None:
    """Tier 2 variant-runner persists a Tier 3 task result to SQLite."""
    validate_payload(task_payload, "task-runner-return.schema.json")
    conn.execute(
        "INSERT INTO task_results (task_id, passed, tokens_used, wall_clock_sec, "
        "patch_sha, error_summary) VALUES (?, ?, ?, ?, ?, ?)",
        (
            task_payload["task_id"],
            task_payload["passed"],
            task_payload["tokens_used"],
            task_payload["wall_clock_sec"],
            task_payload["patch_sha"],
            task_payload["error_summary"],
        ),
    )
    conn.commit()
```

## Examples

### `orchestrator-output.schema.json`

Valid payload:

```json
{
  "round_id": "2026-04-23T10:15:00Z",
  "champion_variant_id": "V7",
  "champion_score": 0.73,
  "prior_champion_score": 0.68,
  "sigma_gate_passed": true,
  "cost_gate_passed": true,
  "comparison_sql": "SELECT variant_id, AVG(passed) AS score FROM task_results WHERE round_id = ?1 GROUP BY variant_id ORDER BY score DESC",
  "timestamp": "2026-04-23T10:42:07Z",
  "variants_evaluated": ["V6", "V7", "variant-baseline-01"],
  "total_tokens": 842511,
  "total_wall_clock_sec": 1603.2
}
```

Invalid payload:

```json
{
  "round_id": "2026-04-23T10:15:00Z",
  "champion_variant_id": "V7",
  "champion_score": 1.4,
  "prior_champion_score": 0.68,
  "sigma_gate_passed": true,
  "cost_gate_passed": true,
  "comparison_sql": "SELECT ...",
  "timestamp": "2026-04-23T10:42:07Z",
  "variants_evaluated": ["V7"],
  "total_tokens": 100,
  "total_wall_clock_sec": 10.0
}
```

Failure reason: `champion_score` is 1.4, which violates the `maximum: 1.0`
constraint. Pass rates above 1.0 are impossible; this indicates an aggregation
bug upstream.

### `variant-runner-return.schema.json`

Valid payload:

```json
{
  "variant_id": "V7",
  "tasks_completed": 50,
  "tasks_passed": 37,
  "total_tokens": 412008,
  "wall_clock_sec": 812.4,
  "error_log": null,
  "sqlite_row_ids": [1042, 1043, 1044, 1045, 1046]
}
```

Invalid payload:

```json
{
  "variant_id": "variant_BASELINE_01",
  "tasks_completed": 50,
  "tasks_passed": 37,
  "total_tokens": 412008,
  "wall_clock_sec": 812.4,
  "error_log": null,
  "sqlite_row_ids": []
}
```

Failure reason: `variant_id` value `variant_BASELINE_01` fails the regex
`^(V[0-9]+|variant-[0-9a-z-]+)$`. The long form requires a lowercase slug
with hyphens, not underscores and uppercase letters.

### `task-runner-return.schema.json`

Valid payload:

```json
{
  "task_id": "swe-bench-lite-astropy-12345",
  "passed": true,
  "tokens_used": 84210,
  "wall_clock_sec": 42.7,
  "patch_sha": "a3b5c7d9e1f3b5c7d9e1f3b5c7d9e1f3b5c7d9e1",
  "error_summary": null
}
```

Invalid payload:

```json
{
  "task_id": "swe-bench-lite-astropy-12345",
  "passed": false,
  "tokens_used": 84210,
  "wall_clock_sec": 42.7,
  "patch_sha": "abc123",
  "error_summary": "verifier timeout after 600s"
}
```

Failure reason: `patch_sha` value `abc123` fails the pattern
`^([a-f0-9]{40}|no_patch)$`. A valid patch SHA is exactly 40 lowercase hex
characters, OR the literal sentinel `no_patch` when the variant produced no
patch. Use `null` only when the runner crashed before it could hash a patch.

## Conventions

- Every schema declares `"$schema": "https://json-schema.org/draft/2020-12/schema"`.
- Every schema uses `"additionalProperties": false`; callers MUST NOT ship
  extra fields.
- Every property carries a `description` explaining semantics and units.
- Numeric bounds are explicit on every numeric field.
- Timestamps are ISO-8601 strings; durations are seconds as numbers.
