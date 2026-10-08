---
name: dream-vault
description: "Launch a bounded vault-refresh run: detect stale ~/vault notes and PROPOSE source-anchored refreshes to a review branch you merge — never auto-editing the live vault. Wraps cco-vault-dream --apply."
command: true
---

# /dream-vault — Propose-to-Review-Branch Vault Refresh

`/dream-vault` runs `~/.claude/bin/cco-vault-dream --apply` — a **bounded**,
**propose-only**, **review-branch-bounded** vault-refresh loop (the v4.0 capstone,
DREAM-03). It detects stale `~/vault` notes — **aged** (`updated:` past a per-folder
TTL), **broken/orphaned** (the `cco-vault-audit` curated-orphan + broken-link
detectors), and **source-drift** (a note that has fallen behind its source of truth,
the `cco-source-drift` detector) — and **proposes** surgical, source-anchored refreshes
onto a **review branch you merge**. The live vault is never edited in place.

This is the operator entry point over the already-built Phase-14..17 machinery: it
**composes the byte-unchanged `cco-dream` runner** (the same timeout / `--max-cost` /
permission-guard / keep-discard / crash-idempotency boundary) and adds nothing new —
it is a documented launch surface with the same safety muscle-memory as `/dream`.

## What it is (parameterized, never hardcoded — D-01)

You supply, **at run time**:

- a **review branch** = the named git branch proposals land on (`--branch <name>`).
  It is **required** under `--apply` (see below); the run commits one refresh per note
  onto it and **never merges it** — your review + merge is the final gate.
- optional **per-run caps** = how many notes a run processes (`--max-notes`, default 5)
  and the max changed-line count any single note's proposal may have (`--diff-cap`,
  default 40).
- an optional **folder scope** = restrict this run's worklist to named folders
  (`--folders a,b,…`; delivered by Plan 02).

Nothing about which notes get refreshed is baked in: the detectors rank the worklist
and the `.cco/vault-dream.yaml` config (per-folder TTL / thresholds / `pinned`) shapes
it. A timestamped review-branch default ships below, but it is illustrative — you
choose the branch + scope when you run it.

## Usage

CLI form (flags override `.cco/vault-dream.yaml`):

```
/dream-vault --apply --branch vault-review/<ts> [--max-notes N] [--diff-cap N] [--folders a,b,…]
```

`--apply` is the **ONLY write path** and **REQUIRES `--branch <name>`** — without it the
CLI prints `cco-vault-dream: --apply requires --branch <name> …` and **exits 2** (no
review branch, no run). The recommended default branch convention is a timestamped
**`vault-review/<UTC-ts>`** (e.g. `vault-review/20260621T120000Z`) so each run's
proposals land on a **distinct**, `reconcile_orphans`-spared named branch — never an
auto `dream/run-*` the orphan-sweep reaps, and never a static branch that clobbers a
prior run's unmerged proposals.

Config form — a `.cco/vault-dream.yaml` in the vault (the same file Phase 15/16 parse
for `defaults` / `thresholds` / `pinned`):

```yaml
defaults:
  ttl_days: 180            # default per-folder aged-ness TTL
thresholds:                # per-folder TTL overrides (MERGES onto the built-in table)
  Projects: 30             # Projects/ notes age after 30 days
  Reference: null          # evergreen — never age-flagged
pinned:                    # notes hard-excluded from ALL classes (never proposed)
  - "00 Hub.md"
scope:                     # the persistent folder-scope default (--folders overrides it; Plan 02)
  folders:
    - Projects
    - Reference
```

**CLI flags override the yaml.** `--branch` is REQUIRED (via CLI) under `--apply`; the
vault path defaults to `~/vault`.

## Start with --detect-only (the zero-write preview)

**Always start with `--detect-only`** — it is the `/dream-vault` analog of `/dream`'s
"start with `--dry-run`" guardrail:

```
cco-vault-dream --detect-only
```

It runs the **full detect+merge+rank pipeline with ZERO vault writes** — no note edits,
no commits, no branch is created — and prints the ranked worklist so you preview exactly
which notes a real `--apply` run would touch (and in what order) before any write
happens. This is the firm "start here" step; only once the worklist looks right do you
run `--apply --branch …`.

## Per-run caps (D-04)

The run is bounded by the **existing** conservative caps the highest-risk phase
(Phase 17) shipped — surfaced here, not re-invented:

- **`--max-notes`** (default **5**) — process at most the top-N ranked worklist notes.
  Combined with `--folders`, the cap applies to the in-scope notes (e.g.
  `--folders Projects --max-notes 5` = the top-5 *Projects* notes).
- **`--diff-cap`** (default **40**) — reject any single note's proposal whose
  changed-line count exceeds this (enforced by the byte-stable apply helper). A proposal
  that would rewrite more than a surgical slice of a note is refused, not applied.

## Safety — the propose-to-branch gate (inherited, never re-implemented)

`/dream-vault` is an unattended autonomous *editor of canonical memory*, so safety is
paramount. It rides the **byte-unchanged `cco-dream` runner boundary** unchanged — the
same Phase-11 RUNNER-01/02 enforcement: a wall-clock timeout per attempt, a `--max-cost`
ceiling, the catastrophe `--disallowedTools` denylist + the wrapper pre-flight
catastrophe screen, and the git-worktree write boundary (the agent may only write inside
its worktree). Nothing about that boundary is forked or weakened here.

Two refresh-specific gates make it safe to point at the vault:

- **The source-of-truth anchor (PROPOSE-03 — the load-bearing anti-model-collapse
  precondition).** Every refresh **re-derives from a verifiable external SOURCE**. A note
  with **no resolvable source is FLAG-ONLY** — it is never read, never sent to `claude -p`,
  and never rewritten. This is what stops the vault from drifting into a model-collapse
  spiral of the LLM rewriting its own prior output.
- **The propose-only gate (PROPOSE-01 / D-15).** `cco-vault-dream --apply --branch
  <name>` lands proposals **ONLY on the named review branch**; the live working tree is
  **never edited in place**, and the run **never merges the branch for you** — the human
  merge is the final gate. A post-proposal `cco-vault-audit` regression check reverts any
  refresh that introduces new broken links / orphans (PROPOSE-04), so a bad proposal
  cannot even reach your review clean.

## The deliverable

A `/dream-vault` run leaves you, all under `~/.claude/cco-memory/dream/<run-ts>.*`:

- **the review branch** — the proposed refreshes, **one commit per note, never merged**.
- **a kept/discarded LEDGER** (`<log>.md` + `<log>.jsonl`) — one metadata-only row per
  processed note in the **same fixed 7-field schema as the `/dream` log** (emitted via
  `cco-dream-log`): a kept refresh is `keep`, a rejected / audit-reverted / flag-only note
  is `discard`, with the reason in the `why` field. No note bodies, no diffs, no file
  contents — metadata only.
- **a ~5-minute morning-review DIGEST** (`<log>.digest.md`) — per touched note it states
  **what changed** (the changed-line count + a one-line summary), **why** (the staleness
  class), and **the external source it was re-derived from** — so the anti-model-collapse
  anchor is auditable by you at merge time. It also lists the **flag-only (source-less)**
  notes needing manual attention and the **audit-regression verdict** (clean / reverted /
  run-rejected).

(The ledger + digest are delivered by Plan 03; documented here as the intended
deliverable.) A one-line stdout pointer prints at run end — `DONE — … log=… digest=…` —
mirroring `cco-dream`'s `DONE` line. Then review with `git -C ~/vault diff <branch>`
only where the digest tells you to look, and merge what you trust.

## Reversibility

Removing `~/.claude/commands/dream-vault.md` **FULLY disarms** `/dream-vault`, leaving
`cco-vault-dream` intact. It registers **no settings.json hook** — it is a command file
+ a bin script, not a hook; **nothing auto-fires**. (Mirrors `/dream`'s
reversibility-by-deletion contract, D-01.)
