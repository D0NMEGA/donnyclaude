---
name: cco-panel
description: "Route an important deliverable through a cost-gated multi-lens judge-panel -> one SHIP/REVISE/BLOCK verdict."
command: true
---

# /cco-panel - Operator-Gated Anonymized Judge-Panel Review

Routes ONE important deliverable through a panel of parallel, diverse-lens
reviewers, pools and **anonymizes** their findings (peer-ranking de-bias), and a
**separate synthesizer** emits exactly ONE verdict: **SHIP / REVISE / BLOCK**.

This is the expensive, **opt-in** quality layer. It is the deliberate complement
to the cheap always-on green-gate: it runs **ONLY** when you explicitly type
`/cco-panel <target>`. It **never** fires on routine edits, has **no**
PostToolUse/Stop/any-hook trigger, and spends nothing in the background. Routine
edits keep using only the v1 lint/test loop (and the green-gate) — never the
panel (the QUALITY-02 cost-gate, in plain words). Reserve it for deliverables
that are worth a multi-reviewer jury.

The design is PoLL ("Replacing Judges with Juries"): a panel of *diverse*
reviewers correlates better with human judgment and shows less self-preference
bias than a single reviewer. Locally we cannot vary the MODEL (all subagents run
the configured model), so **diversity is by LENS** and **de-bias is by
anonymization**.

## Usage

```
/cco-panel <path>         # panel-review a file or directory
/cco-panel --staged       # panel-review the git staged diff
/cco-panel --diff <ref>   # panel-review the diff vs <ref>
```

`<target>` is the deliverable to review. This is an **EXPLICIT, operator-invoked**
review — it runs ONLY when you type it.

## 1. Resolve the target

Resolve `<target>` to a concrete, READ-only review scope:

- a **path** (file or directory) -> the files under it;
- `--staged` -> `git diff --staged`;
- `--diff <ref>` -> `git diff <ref>`.

If the target is **empty or ambiguous**, ASK the operator which deliverable to
review — do NOT guess and spend tokens on the wrong scope. The target resolves
to a read scope only (a path / a diff), never an arbitrary shell command.

## 2. Fan out the diverse lenses IN PARALLEL (the Workflow tool; parallel subagents as fallback)

Drive the **Workflow tool**'s documented **"Judge panel" / "perspective-diverse
verify"** pattern: launch **3-4 reviewers in PARALLEL** over the **SAME** resolved
target, each a **DISTINCT lens**, REUSING the installed review subagents (do NOT
reimplement review logic — the lenses ARE these subagents and carry their own
checklists):

| Lens | Subagent | Reviews for |
|------|----------|-------------|
| Correctness / quality | **code-reviewer** | bugs, error handling, maintainability, dead code |
| Security | **security-reviewer** | OWASP Top 10, secrets, injection, authn/z, unsafe crypto |
| Architecture | **architect** | design, coupling, scalability, structural smells |
| Tests / verification | **code-reviewer** or **donny-verifier** (tests-focused) | are there tests, do they cover this change, do they pass |

For a **Python** target (`.py` files), include **python-reviewer** (PEP8 / type
hints / Pythonic idiom / perf) as an additional or substitute lens.

Rules for the fan-out:

- **PARALLEL** — run the lenses concurrently (Workflow `parallel()`, or parallel
  Task-tool calls) so **no lens sees another's findings first** (position bias).
- **SUBSTANCE over length** — instruct each lens to score on substance, not
  verbosity (verbosity bias). A short precise finding outranks a long vague one.
- **FALLBACK** — if the Workflow tool is unavailable this session, fan the same
  reviewers out as **parallel Task-tool subagent calls** and synthesize in the
  main thread. Same shape, same anonymization, same single verdict.

## 3. Pool + ANONYMIZE the findings (peer-ranking de-bias)

Collect every lens's findings into ONE pool and **STRIP reviewer identity**:
relabel the sources **"Reviewer A / B / C / D"** — NOT "the security reviewer
said", NOT the lens name. Carry each finding's **file/location** and **severity**;
drop the lens identity entirely. This prevents the synthesis from weighting a
finding by lens prestige/identity (the PoLL identity/position de-bias). No lens
is the sole judge of its own output — the synthesis is a separate pass over the
anonymized pool (self-preference de-bias).

## 4. Synthesize ONE verdict (de-dupe, rank by severity)

A **single, SEPARATE SYNTHESIZER pass** over the anonymized pool: de-dupe
overlapping findings (the same issue raised by two Reviewers collapses to one),
**rank by SEVERITY** (critical / high / medium / low), and emit **EXACTLY ONE**
verdict from this fixed schema:

- **SHIP** — no blocking issues; list any optional nits.
- **REVISE** — a severity-ordered list of issues to fix, each with the
  **file/location** + the **concrete fix**.
- **BLOCK** — a critical issue (security hole, data loss, broken contract) that
  MUST be fixed before merge.

Present, in order: **the verdict**, then **the ranked issues** (Reviewer A/B/C
attributions only — no lens names), then a **one-line rationale**. The verdict +
ranked issues ARE the deliverable; the panel **writes no source files**.

Example output shape:

```
VERDICT: REVISE

1. [CRITICAL] src/api/client.py:42 — hardcoded API key in source.
   Fix: move to os.environ["API_KEY"]; add to .env.example.        (Reviewer B)
2. [HIGH]     src/api/client.py:55 — unbounded query, no LIMIT.
   Fix: add LIMIT + pagination on the user-facing endpoint.        (Reviewer A, C)
3. [LOW]      src/api/client.py:12 — unused import `json`.          (Reviewer A)

Rationale: one critical secret-exposure blocks SHIP; fix the ranked issues and re-run.
```

## 5. Guardrails (always)

- **COST-GATED:** runs ONLY on explicit `/cco-panel`. NEVER auto-fire; NEVER wire
  this to a hook / PostToolUse / Stop / any settings.json event. Routine edits use
  the **v1 lint/test loop** + the green-gate, **not** the panel (QUALITY-02). This
  command file is the ONLY surface — it registers no hook and edits no settings.
- **READ-ONLY:** the panel produces a verdict + ranked issues and **writes no
  source files**. The operator acts on the verdict (or invokes a separate,
  explicit edit). No silent self-modification.
- **REUSE, don't reinvent:** the lenses ARE the installed review subagents; the
  orchestrator IS the Workflow tool (with a parallel-subagent fallback). Do NOT
  build a bespoke panel runtime, and do NOT add an external eval framework
  (autoevals / DeepEval / openevals are prior-art reference only — never installed).
- **SINGLE-MODEL diverse-lens:** all lenses run the configured model; diversity is
  by LENS. Multi-model panels and per-reviewer cross-ranking of the anonymized
  pool are **DEFERRED** — do NOT add them in v1.
- **DISTINCT from `/code-review ultra`:** that is the heavyweight cloud review —
  keep it as the separate option. `/cco-panel` is the local, cost-controlled,
  anonymized-jury panel. Do not merge or replace it.
- **Optional, OFF by default:** a "consider a panel" hint on a very large diff is
  permitted ONLY as a no-spend suggestion (a `systemMessage`-style note); the
  panel ITSELF runs only on explicit `/cco-panel`. Default is no hint at all.
