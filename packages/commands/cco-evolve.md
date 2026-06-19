---
name: cco-evolve
description: "Operator-gated promotion of a recurring instinct into a learned skill (dry-run default; nothing is written without your confirmation)."
command: true
---

# /cco-evolve - Operator-Gated Instinct -> Skill Promotion

Reviews the recurring, high-confidence instincts that Plan 01's SessionEnd
observer accreted into `~/.claude/cco-memory/instincts/`, and -- only with your
explicit confirmation -- promotes one into a reusable
`~/.claude/skills/learned/<name>/SKILL.md` skill through the existing
`/learn-eval` quality gate.

**Default is a dry-run; no skill is written without your confirmation.** This is
the literal "be careful -- the harness is improving ITSELF" guardrail (D-04):
there is no silent self-modification here. The continuous-learning-v2 autonomous
skill-writer (its background self-generate path) is **never** invoked.

**The lifecycle (Phase 12, EVOLVE-03/04/05):** an instinct moves
`observed -> active -> demoted`. Frequency alone never promotes -- eligibility is
gated behind the **held-out deterministic green bar** (`cco-green-gate.js`'s
ruff/type/pytest), measured as `eval_wins` / `eval_opportunities`. **Promotion to
`active` is human-gated** (you run `cco-instinct.py promote <id>` after the
`/learn-eval` confirmation; it reasserts the eval-gate AND enforces the
`MAX_ACTIVE=7` hard cap). **Demotion is automatic** -- `cco-instinct.py decay`
auto-demotes any instinct that accrued opportunities but never correlated with a
green-bar win (the claude-recall "0 citations" failure mode designed out).
Demotion only ever **reduces** standing, so it is safe to automate; promotion --
the only thing that grants an instinct standing -- stays in your hands. A demoted
instinct is **not deleted**: its file persists and is re-promotable.

## Usage

```
/cco-evolve            # DRY-RUN: list candidate clusters + promotion-eligible instincts. Writes nothing.
/cco-evolve <id>       # PROMOTE one candidate, routed through the /learn-eval operator-gated verdict flow.
```

`<id>` is an instinct id (or a cluster's representative id) shown by the dry-run.

## 1. Default: DRY-RUN (writes nothing)

On `/cco-evolve` with no argument, run the pure-Python clustering reader and
present its output to the operator, then STOP:

```bash
python3 ~/.claude/cco-memory/cco-instinct.py evolve
```

`cco-instinct.py evolve` (the Task-1 CLI -- stdlib only, no external spawn, no
LLM) groups instincts by domain, clusters shared triggers (>=2 members), and
lists **promotion-eligible** instincts under the **green-bar eval gate**
(`eval_wins >= 1` AND `eval_opportunities >= 20`) -- NOT confidence/frequency. A
high-confidence but never-won instinct is listed separately under **"FREQUENT BUT
UNPROVEN -- not eligible, stays observed"** so you can see exactly what the old
confidence gate would have wrongly promoted. It reads the `cco-memory` store and
**writes nothing** under `~/.claude/skills/`.

Present the candidate clusters + the promotion-eligible list (and the
frequent-but-unproven list) and tell the operator: "This was a dry-run -- nothing
was written. To promote one to a learned skill, run `/cco-evolve <id>`; to grant
it `active` standing, run `cco-instinct.py promote <id>`." Then STOP. Do not write
any file in this path.

## 2. Promotion (only with `<id>` + operator confirmation)

When the operator names a candidate (`/cco-evolve <id>`), drive the EXISTING
`/learn-eval` quality gate verbatim for that single candidate. Do NOT skip a
step; the write happens only at the very end, after confirmation.

First, confirm the candidate exists and is **eval-eligible** (the green bar -- not
frequency -- must have measured an improvement correlated with it):

```bash
python3 ~/.claude/cco-memory/cco-instinct.py status   # locate <id>, see its wins/opps green-bar signal + status
python3 ~/.claude/cco-memory/cco-instinct.py evolve   # confirm <id> is under PROMOTION-ELIGIBLE, not FREQUENT BUT UNPROVEN
```

If `<id>` is only under "FREQUENT BUT UNPROVEN", STOP -- it is not promotable yet
(it stays `observed` until the green bar correlates a win). Then run the
`/learn-eval` flow (see `~/.claude/commands/learn-eval.md`):

### 2a. Required checklist (verify by actually reading files)

- [ ] Grep `~/.claude/skills/` (and the project's `.claude/skills/`) by keyword
      for content overlap with this instinct's trigger/domain.
- [ ] Check `MEMORY.md` (project and global) for overlap.
- [ ] Decide: would appending to an existing skill suffice, or is a new file right?
- [ ] Confirm this is a reusable pattern, not a one-off.

### 2b. Holistic verdict

Synthesize the checklist + the candidate's quality and choose ONE:

| Verdict | Meaning | Next action |
|---------|---------|-------------|
| **Save** | Unique, specific, well-scoped | -> Step 2c (write a new skill) |
| **Improve then Save** | Valuable but needs refinement | revise once, re-evaluate, then 2c |
| **Absorb into [X]** | Belongs in an existing skill | show target + additions -> 2c (append) |
| **Drop** | Trivial / redundant / too abstract | explain why, stop. No write. |

### 2c. Verdict-specific OPERATOR CONFIRMATION (the gate)

Before writing anything, present the chosen save path + checklist results + a
one-line verdict rationale + the full draft, and **wait for the operator's
explicit confirmation**. Only on a confirmed **Save** / **Absorb** do you write.
On **Drop** (or no confirmation) nothing is written.

### 2d. Write the skill (only after confirmation)

Validate the skill `name` BEFORE it becomes a directory path: it must match the
instinct-id rules (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, <=128 chars, no `..`, no `/`
or `\`, no leading `.`) -- the same `_validate_instinct_id` /
`_validate_file_path` guards the CLI uses. Reject any name that fails (no path
traversal into `~/.claude/skills/learned/<name>/`).

Write `~/.claude/skills/learned/<name>/SKILL.md` in the validated
`/learn-eval` / Hermes frontmatter shape:

```markdown
---
name: <validated-skill-name>
description: "Under 130 characters"
user-invocable: false
origin: auto-extracted (promoted from instinct <id>)
---

# [Descriptive Pattern Name]

**Promoted from instinct:** <id>  (<domain>, confidence <conf>)
**Context:** [when this applies]

## Pattern
[The reusable pattern, authored from the instinct's METADATA -- its trigger,
domain, and evidence summary. NEVER from raw transcript text, file contents,
or secrets.]

## When to Use
[Trigger conditions, from the instinct's trigger.]
```

Keep `description` <= 130 characters (Hermes prefers <=130; hard cap 1024).

### 2e. Grant `active` standing (the eval-gated, cap-enforced promote)

Promoting the instinct to a learned skill (2a-2d) and granting it `active`
standing in the store are distinct steps. After your confirmation, flip the
instinct `observed -> active` through the **eval-gated, hard-capped** promote
verb -- this is the ONLY `observed -> active` path and it never auto-runs:

```bash
python3 ~/.claude/cco-memory/cco-instinct.py promote <id>
```

`promote` reasserts the green-bar eval-gate (refuses a 0-win instinct --
"frequency alone never promotes") and enforces the **`MAX_ACTIVE = 7` hard cap**.
If the active set is already full it **refuses** and names the weakest active to
demote; free a slot first:

```bash
python3 ~/.claude/cco-memory/cco-instinct.py promote <id> --demote <weakest-active-id>
```

It never writes an 8th active row. To auto-demote instincts that accrued
opportunities but never won the bar (housekeeping; safe -- it only reduces
standing, never a behavior change), run the decay verb (dry-run first):

```bash
python3 ~/.claude/cco-memory/cco-instinct.py decay --dry-run   # list what WOULD demote
python3 ~/.claude/cco-memory/cco-instinct.py decay             # status -> demoted, confidence x0.8; files persist (restorable)
```

## 3. Guardrails (always)

- The promotion write happens ONLY after the Step-2c operator confirmation.
  Never write a skill on the default `/cco-evolve` (dry-run) path.
- `observed -> active` is human-gated by construction: only `cco-instinct.py
  promote <id>` flips it, it is never auto-run, and it reasserts the green-bar
  eval-gate + the `MAX_ACTIVE` cap. The engine is **metadata-only** -- it mutates
  only the YAML `status`/`confidence`/`eval_*` fields inside
  `~/.claude/cco-memory/instincts/` and NEVER writes `settings.json`, hooks, or
  skills (the load-bearing no-RSI-loop line; invariant-tested). Demotion (`decay`)
  is the only automatic mutation and only ever reduces standing.
- Never invoke the continuous-learning-v2 autonomous skill-writer (its
  background self-generate path). This command does promotion through
  `/learn-eval` only -- `cco-instinct.py` itself has no writer at all.
- Validate the skill `name` through the id rules before it becomes a directory
  name (path-traversal guard).
- The SKILL.md body is authored from the instinct's metadata
  (trigger/domain/evidence), never from raw transcript/code/secrets (D-05/D-11).
- Use `cco-instinct.py` for clustering/status -- NOT the dormant v2
  `/instinct-status` reader (it points at an absent store, not `cco-memory`).

## 4. Session-cache caveat (tell the operator)

The newly written `~/.claude/skills/learned/<name>/SKILL.md` is **available next
session** -- the skill loader is cached at session start, so a freshly promoted
skill is NOT visible to the current session's skills list. This is expected, not
a bug (D-06). After promoting, tell the operator: "the new skill is available
next session; start a fresh session to pick it up." Verification asserts the
file exists + the frontmatter validates (a `name` + a `description` <= 130
chars) -- it does NOT assert same-session tool visibility.

To confirm next session, the operator can run:

```bash
ls ~/.claude/skills/learned/<name>/SKILL.md && head -6 ~/.claude/skills/learned/<name>/SKILL.md
```
