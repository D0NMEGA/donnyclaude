# AHOL Contracts

JSON Schema contracts for the return values produced by each tier of the AHOL
(Adaptive Hierarchical Orchestration Loop) subagent tree. Every subagent MUST
validate its output against the relevant schema immediately before exit. Prose
returns are bugs; validation failures are treated as infrastructure errors by
the calling tier, NOT as task failures.

## Tier map

AHOL spawns three tiers of subagents per round:

| Tier | Role              | Returns to parent?                  | Schema                                |
| :--: | :---------------- | :---------------------------------- | :------------------------------------ |
|  1   | Orchestrator      | No (top of tree, writes to disk)    | `orchestrator-output.schema.json`     |
|  2   | Variant runner    | Yes (returns JSON to orchestrator)  | `variant-runner-return.schema.json`   |
|  3   | Task runner       | Yes (returns JSON to variant)       | `task-runner-return.schema.json`      |

The Tier 1 orchestrator is the only subagent that does not return a value. It
writes `CHAMPION.md` and a round summary JSON file conforming to
`orchestrator-output.schema.json`. Tier 2 and Tier 3 both return a dict that
their parent deserializes and re-validates defensively.

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

Each subagent executes this sequence immediately before exit:

1. Build the return dict in memory.
2. Load the matching schema from `packages/ahol/contracts/`.
3. Call `jsonschema.validate(instance=return_dict, schema=schema)`.
4. On success: serialize to stdout (Tier 2 and Tier 3) or write to disk
   (Tier 1), then exit 0.
5. On `jsonschema.ValidationError`: print a diagnostic to stderr including the
   failing JSON path and the schema message, then exit nonzero.

The calling tier treats a nonzero exit from a child subagent as an
infrastructure error, NOT a task failure. For the variant-runner this means a
crashing task-runner does NOT decrement `tasks_passed`; it is logged in
`error_log` and `tasks_completed` does not count the crashed task.

### Python validation pseudocode

```python
import json
import sys
from pathlib import Path

import jsonschema

CONTRACTS_DIR = Path(__file__).resolve().parent / "packages" / "ahol" / "contracts"

def validate_and_emit(return_dict: dict, schema_filename: str) -> None:
    schema_path = CONTRACTS_DIR / schema_filename
    with schema_path.open("r", encoding="utf-8") as fh:
        schema = json.load(fh)
    try:
        jsonschema.validate(instance=return_dict, schema=schema)
    except jsonschema.ValidationError as exc:
        print(
            f"[ahol] schema violation in {schema_filename}: "
            f"path={list(exc.absolute_path)} message={exc.message}",
            file=sys.stderr,
        )
        sys.exit(2)
    json.dump(return_dict, sys.stdout)
    sys.exit(0)

# Tier 3 example
validate_and_emit(task_return, "task-runner-return.schema.json")
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
