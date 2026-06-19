#!/usr/bin/env python3
"""
cco-instinct.py - review / cluster / prune the cco-memory instinct store.

Phase 06 Plan 02 (EVOLVE-02), Task 1.

A stdlib-only CLI over the machine-owned per-instinct YAML store written by
Plan 01's SessionEnd observer (cco-instinct-observe.js) at:

    ~/.claude/cco-memory/instincts/<id>.yaml

Subcommands:
  status   review the store: every instinct grouped by domain, sorted by
           confidence, showing id / confidence / status / occurrences / trigger.
  evolve   cluster recurring instincts (group by domain, normalize trigger,
           >=2-member trigger clusters, avg confidence) and list promotion-
           eligible (confidence >= 0.7) instincts. PRINT ONLY -- writes nothing.
  prune    delete `status: pending` instincts whose `created` date is > 30 days
           old (supports --dry-run). NEVER prunes operator-reviewed
           active/dropped instincts.

PORTED from continuous-learning-v2's scripts/instinct-cli.py -- but ONLY the
pure-Python logic: the `_validate_instinct_id` / `_validate_file_path` guards,
the frontmatter parser, the evolve clustering, and the 30-day pending TTL.
Every external-process spawn, background-LLM call, and network fetch from the
source is DROPPED, and the autonomous skill-writer (the v2 silent-generate
path) is deliberately NOT ported (D-04: no silent self-modification --
promotion happens only through the operator-gated /cco-evolve + /learn-eval
flow). This CLI reads the cco-memory store, NOT the dormant v2 store tree.

stdlib only: argparse, re, sys, os, pathlib, datetime, collections. NO third-
party deps, NO external-process spawn, NO network.
"""

import argparse
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import NamedTuple, Optional


class Cluster(NamedTuple):
    """A trigger-cluster candidate (typed so field accesses stay concrete)."""
    trigger: str
    instincts: list[dict]
    avg_confidence: float
    domains: list[str]

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

# The NEW machine-owned store (NOT the dormant v2 store under ~/.claude/).
STORE = Path.home() / ".claude" / "cco-memory" / "instincts"

ALLOWED_INSTINCT_EXTENSIONS = (".yaml", ".yml")

# Frequency confidence threshold (D-03). NO LONGER the promotion gate (EVOLVE-03): it now only
# classifies a frequent-but-unproven instinct for the "FREQUENT BUT UNPROVEN" call-out. Promotion
# eligibility is gated by the held-out green bar (EVAL_WIN_THRESHOLD / MIN_OPPORTUNITIES) below.
PROMOTE_CONFIDENCE_THRESHOLD = 0.7

# EVOLVE-03 eval gate — the held-out deterministic GREEN BAR, not bigram frequency, makes an instinct
# promotion-eligible. An instinct is eligible only when it has at least EVAL_WIN_THRESHOLD green-bar wins
# AND at least MIN_OPPORTUNITIES measured opportunities (sessions where the trigger was present and the
# bar was evaluated). MIN_OPPORTUNITIES mirrors claude-recall's proven MIN_LOADS=20. (The action-boundary
# `promote` verb + the hard cap land in Plan 02; this plan delivers the measurement + eligibility gate.)
EVAL_WIN_THRESHOLD = 1
MIN_OPPORTUNITIES = 20

# EVOLVE-04 (decay/demotion) + EVOLVE-05 (hard cap). The action set is bounded small while observation is
# unbounded; an instinct that accrues opportunities but never correlates with a green-bar win is auto-
# demoted (the claude-recall "0 citations" failure mode designed out). MIN_AGE_DAYS / the opportunity
# floor mirror claude-recall's proven MIN_AGE_DAYS=7 / MIN_LOADS=20; CONFIDENCE_DECAY multiplicatively
# decays a never-correlated instinct's confidence so flat-high-confidence accretion is impossible.
MAX_ACTIVE = 7           # hard cap on status:active (EVOLVE-05); promotion past it requires a demotion
MIN_AGE_DAYS = 7         # last_eval must be this old before a 0-win instinct is decay-eligible
CONFIDENCE_DECAY = 0.8   # multiplicative confidence decay applied on demotion

# 30-day pending TTL (ported from v2 PENDING_TTL_DAYS).
PENDING_TTL_DAYS = 30

# Trigger-normalization stopwords (ported from v2 cmd_evolve clustering).
_TRIGGER_STOPWORDS = ("when", "creating", "writing", "adding",
                      "implementing", "testing")


# ─────────────────────────────────────────────
# Validators  (ported verbatim from continuous-learning-v2; no external spawn)
# ─────────────────────────────────────────────

def _validate_instinct_id(instinct_id: str) -> bool:
    """Validate instinct IDs / skill names before using them in filenames.

    Ported from instinct-cli.py: regex ^[A-Za-z0-9][A-Za-z0-9._-]*$, <=128,
    reject '/', '\\', '..', and a leading '.'. Used as the skill-name -> path
    traversal guard before a name becomes a skills/learned/<name>/ directory.
    """
    if not instinct_id or len(instinct_id) > 128:
        return False
    if "/" in instinct_id or "\\" in instinct_id:
        return False
    if ".." in instinct_id:
        return False
    if instinct_id.startswith("."):
        return False
    return bool(re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]*$", instinct_id))


def _validate_file_path(path_str: str, must_exist: bool = False) -> Path:
    """Validate and resolve a file path, guarding against path traversal.

    Ported from instinct-cli.py: blocked-prefix list of system directories
    (incl. the macOS /private/etc … resolutions). Reused as the skill-name ->
    path guard so a promoted skill can never land in a system directory.
    Raises ValueError if the path is invalid or suspicious.
    """
    path = Path(path_str).expanduser().resolve()

    blocked_prefixes = [
        "/etc", "/usr", "/bin", "/sbin", "/proc", "/sys",
        "/var/log", "/var/run", "/var/lib", "/var/spool",
        # macOS resolves /etc -> /private/etc
        "/private/etc",
        "/private/var/log", "/private/var/run", "/private/var/db",
    ]
    path_s = str(path)
    for prefix in blocked_prefixes:
        if path_s.startswith(prefix + "/") or path_s == prefix:
            raise ValueError(f"Path '{path}' targets a system directory")

    if must_exist and not path.exists():
        raise ValueError(f"Path does not exist: {path}")

    return path


# ─────────────────────────────────────────────
# Single-instinct frontmatter parser
#   (adapted from instinct-cli.py parse_instinct_file: walk lines, toggle on
#    '---', split 'key: value'. The cco store is ONE frontmatter block per file,
#    so we read just the first block and stop.)
# ─────────────────────────────────────────────

def load_instinct(path: Path) -> Optional[dict]:
    """Parse a single-instinct YAML file (one '---' frontmatter block).

    Returns a dict of the frontmatter keys (+ '_source_file'), or None if the
    file can't be read / has no id. Malformed `confidence` coerces to 0.5 and
    missing keys are tolerated (T-06-12: a poisoned file degrades to a low-
    confidence / ignored candidate, never a crash).
    """
    try:
        content = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None

    data: dict = {}
    in_frontmatter = False
    seen_frontmatter = False

    for line in content.split("\n"):
        if line.strip() == "---":
            if in_frontmatter:
                # End of the (single) frontmatter block.
                break
            if seen_frontmatter:
                break
            in_frontmatter = True
            seen_frontmatter = True
            continue
        if in_frontmatter and ":" in line:
            key, value = line.split(":", 1)
            key = key.strip()
            value = value.strip()
            # Unescape simple quoted YAML strings.
            if len(value) >= 2 and value.startswith('"') and value.endswith('"'):
                value = value[1:-1].replace('\\"', '"').replace("\\\\", "\\")
            elif len(value) >= 2 and value.startswith("'") and value.endswith("'"):
                value = value[1:-1].replace("''", "'")
            if key == "confidence":
                try:
                    data[key] = float(value)
                except ValueError:
                    data[key] = 0.5  # default on malformed confidence
            elif key in ("occurrences", "eval_opportunities", "eval_wins"):
                # EVOLVE-03: the eval counts int-coerce exactly like occurrences; a poisoned/missing
                # value degrades to 0 (never a crash) so a malformed row can never spoof eligibility.
                try:
                    data[key] = int(value)
                except ValueError:
                    data[key] = 0
            else:
                # last_eval and the rest stay strings (last_eval defaults to '' simply by being absent).
                data[key] = value

    if not data.get("id"):
        return None
    data["_source_file"] = str(path)
    return data


def load_all() -> list[dict]:
    """Glob STORE/*.yaml + *.yml and return the parsed instinct dicts."""
    instincts: list[dict] = []
    if not STORE.exists():
        return instincts
    files = sorted(
        f for f in STORE.iterdir()
        if f.is_file() and f.suffix.lower() in ALLOWED_INSTINCT_EXTENSIONS
    )
    for f in files:
        inst = load_instinct(f)
        if inst is not None:
            instincts.append(inst)
        else:
            print(f"Warning: skipped unparseable instinct file: {f.name}",
                  file=sys.stderr)
    return instincts


# ─────────────────────────────────────────────
# _rewrite_instinct  -- the ONLY Python writer (EVOLVE-04/05). Atomic temp+rename,
#   confined to STORE, guarded by _validate_instinct_id at the FS boundary. Serializes
#   the CANONICAL schema in the EXACT field order cco-instinct-observe.js buildInstinct
#   emits (id, trigger, confidence, domain, source, created, evidence, status,
#   occurrences, eval_opportunities, eval_wins, last_eval) so an observer upgrade and a
#   CLI rewrite round-trip identically. METADATA-ONLY: it only ever rewrites the loaded
#   dict's status / confidence / eval_* fields — it NEVER writes settings.json/hooks/skills
#   and is the single mutation point the metadata-only invariant test pins.
# ─────────────────────────────────────────────

def _yaml_quote(value: str) -> str:
    """Double-quote a string the way load_instinct reads it back (mirrors the JS
    observer's JSON.stringify): escape backslash then double-quote, wrap in '"'."""
    s = str(value)
    s = s.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{s}"'


def _rewrite_instinct(inst: dict, **updates) -> bool:
    """Atomically rewrite one instinct's YAML with the given field updates.

    Re-validates the id at the FS boundary (defense-in-depth, mirrors cmd_prune),
    applies `updates` to a copy of the loaded dict, serializes the canonical schema
    in buildInstinct's field order, and writes via temp-file + os.replace (mode
    0o600). Returns True on success, False if the id is invalid or the target path
    is missing. Typed exceptions only — never a bare except.
    """
    iid = str(inst.get("id", ""))
    if not _validate_instinct_id(iid):
        print(f"Warning: refusing to rewrite instinct with invalid id: {iid!r}",
              file=sys.stderr)
        return False
    src = inst.get("_source_file")
    if not src:
        # Fall back to the canonical STORE path for this id.
        src = str(STORE / f"{iid}.yaml")

    merged = dict(inst)
    merged.update(updates)

    # Canonical field order — IDENTICAL to cco-instinct-observe.js buildInstinct.
    trigger = _yaml_quote(merged.get("trigger", ""))
    confidence = merged.get("confidence", 0.5)
    domain = merged.get("domain", "general")
    source = merged.get("source", "session-observation")
    created = merged.get("created", "")
    evidence = _yaml_quote(merged.get("evidence", ""))
    status = merged.get("status", "observed")
    occurrences = int(merged.get("occurrences", 0))
    eval_opportunities = int(merged.get("eval_opportunities", 0))
    eval_wins = int(merged.get("eval_wins", 0))
    last_eval = _yaml_quote(merged.get("last_eval", ""))

    body = (
        "---\n"
        f"id: {iid}\n"
        f"trigger: {trigger}\n"
        f"confidence: {confidence}\n"
        f"domain: {domain}\n"
        f"source: {source}\n"
        f"created: {created}\n"
        f"evidence: {evidence}\n"
        f"status: {status}\n"
        f"occurrences: {occurrences}\n"
        f"eval_opportunities: {eval_opportunities}\n"
        f"eval_wins: {eval_wins}\n"
        f"last_eval: {last_eval}\n"
        "---\n"
    )

    tmp = src + ".tmp." + str(os.getpid())
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(body)
        os.chmod(tmp, 0o600)
        os.replace(tmp, src)
    except OSError as e:
        print(f"Warning: failed to rewrite {src}: {e}", file=sys.stderr)
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        return False
    return True


# ─────────────────────────────────────────────
# status  -- the operator's store-review surface
# ─────────────────────────────────────────────

def cmd_status(args) -> int:
    """Print every instinct grouped by domain, sorted by -confidence."""
    instincts = load_all()

    if not instincts:
        print("no instincts yet")
        print(f"  store: {STORE}")
        return 0

    print(f"\n{'=' * 60}")
    print(f"  CCO INSTINCT STATUS - {len(instincts)} total")
    print(f"  store: {STORE}")
    print(f"{'=' * 60}\n")

    by_domain: dict[str, list[dict]] = defaultdict(list)
    for inst in instincts:
        by_domain[inst.get("domain", "general")].append(inst)

    for domain in sorted(by_domain.keys()):
        group = by_domain[domain]
        print(f"## {domain.upper()} ({len(group)})\n")
        for inst in sorted(group, key=lambda x: -float(x.get("confidence", 0.5))):
            conf = float(inst.get("confidence", 0.5))
            bar = "█" * int(conf * 10) + "░" * (10 - int(conf * 10))
            occ = inst.get("occurrences", "?")
            status = inst.get("status", "?")
            # EVOLVE-03: surface the green-bar signal (wins/opportunities) so the operator can see why
            # an instinct is (or is not) promotion-eligible at a glance.
            wins = int(inst.get("eval_wins", 0))
            opps = int(inst.get("eval_opportunities", 0))
            print(f"  {bar} {int(conf * 100):3d}%  {inst.get('id', 'unnamed')}"
                  f"  [{status}]  ({occ}x, {wins}/{opps} green-bar)")
            print(f"            trigger: {inst.get('trigger', 'unknown')}")
            print()

    # Pending-TTL hygiene hint (review surface, no mutation).
    pending = [i for i in instincts if i.get("status") == "pending"]
    if pending:
        print(f"{'-' * 60}")
        print(f"  {len(pending)} pending awaiting review "
              f"(auto-expire after {PENDING_TTL_DAYS}d -- run `prune`).")
    print(f"\n{'=' * 60}\n")
    return 0


# ─────────────────────────────────────────────
# evolve  -- cluster + list candidates (PRINT ONLY; no autonomous writer/flag)
#   Ported from the v2 evolve clustering. The autonomous skill-writer is
#   intentionally NOT ported (D-04): no generate flag, no file writes.
# ─────────────────────────────────────────────

def _normalize_trigger(trigger: str) -> str:
    """Normalize a trigger for clustering (lower, strip stopwords)."""
    key = (trigger or "").lower()
    for word in _TRIGGER_STOPWORDS:
        key = key.replace(word, "").strip()
    return key


def cmd_evolve(args) -> int:
    """Analyze the store and list skill-promotion CANDIDATES. Writes nothing."""
    instincts = load_all()

    print(f"\n{'=' * 60}")
    print(f"  CCO EVOLVE ANALYSIS - {len(instincts)} instincts")
    print("  (candidates only -- writes NOTHING; promote via /cco-evolve)")
    print(f"{'=' * 60}\n")

    if not instincts:
        print("no instincts yet -- nothing to cluster.")
        print(f"\n{'=' * 60}\n")
        return 0

    # Cluster by normalized trigger (within the whole store).
    trigger_clusters: dict[str, list[dict]] = defaultdict(list)
    for inst in instincts:
        trigger_clusters[_normalize_trigger(inst.get("trigger", ""))].append(inst)

    # Keep clusters with >=2 members (good skill candidates).
    candidates: list[Cluster] = []
    for trig, cluster in trigger_clusters.items():
        if len(cluster) >= 2:
            avg_conf = sum(float(i.get("confidence", 0.5)) for i in cluster) / len(cluster)
            candidates.append(Cluster(
                trigger=trig,
                instincts=cluster,
                avg_confidence=avg_conf,
                domains=sorted({str(i.get("domain", "general")) for i in cluster}),
            ))

    # Sort by cluster size then avg confidence (ported v2 sort key).
    candidates.sort(key=lambda c: (-len(c.instincts), -c.avg_confidence))

    print(f"Potential skill clusters (>=2 shared-trigger instincts): {len(candidates)}\n")
    if candidates:
        print("## SKILL CANDIDATES\n")
        for i, cand in enumerate(candidates[:5], 1):
            print(f"{i}. cluster: \"{cand.trigger or '(empty trigger)'}\"")
            print(f"   members: {len(cand.instincts)}"
                  f"   avg confidence: {cand.avg_confidence:.0%}"
                  f"   domains: {', '.join(cand.domains)}")
            for inst in cand.instincts[:5]:
                print(f"     - {inst.get('id')}"
                      f" ({float(inst.get('confidence', 0.5)):.0%},"
                      f" {inst.get('status', '?')})")
            print()

    # Promotion-eligible instincts — EVOLVE-03: gated by the held-out GREEN BAR, NOT confidence.
    # Eligible = eval_wins >= EVAL_WIN_THRESHOLD AND eval_opportunities >= MIN_OPPORTUNITIES. Frequency
    # (confidence) alone NEVER makes an instinct eligible; sorted by green-bar wins (strongest first).
    eligible = sorted(
        (i for i in instincts
         if int(i.get("eval_wins", 0)) >= EVAL_WIN_THRESHOLD
         and int(i.get("eval_opportunities", 0)) >= MIN_OPPORTUNITIES),
        key=lambda x: -int(x.get("eval_wins", 0)),
    )
    print(f"## PROMOTION-ELIGIBLE (eval_wins >= {EVAL_WIN_THRESHOLD}, "
          f"opportunities >= {MIN_OPPORTUNITIES}): {len(eligible)}\n")
    for inst in eligible:
        print(f"  * {inst.get('id')}"
              f"  ({int(inst.get('eval_wins', 0))} win(s)/"
              f"{int(inst.get('eval_opportunities', 0))} opp,"
              f" {float(inst.get('confidence', 0.5)):.0%} conf,"
              f" {inst.get('domain', 'general')}, {inst.get('status', '?')})")
        print(f"      trigger: {inst.get('trigger', 'unknown')}")
    if not eligible:
        print(f"  (none yet -- needs >= {EVAL_WIN_THRESHOLD} green-bar win and "
              f">= {MIN_OPPORTUNITIES} measured opportunities)")

    # FREQUENT BUT UNPROVEN — high frequency (confidence >= threshold) but 0 green-bar wins. These are
    # NOT eligible (frequency is not evidence, EVOLVE-03) and stay `observed`; surfaced so the operator
    # sees what the old confidence gate would have wrongly promoted. The held-out bar has not measured an
    # improvement correlated with them, so they remain observation-only.
    unproven = sorted(
        (i for i in instincts
         if float(i.get("confidence", 0.5)) >= PROMOTE_CONFIDENCE_THRESHOLD
         and int(i.get("eval_wins", 0)) < EVAL_WIN_THRESHOLD),
        key=lambda x: -float(x.get("confidence", 0.5)),
    )
    print()
    print("## FREQUENT BUT UNPROVEN (high confidence, 0 green-bar wins -- "
          f"NOT eligible, stays observed): {len(unproven)}\n")
    for inst in unproven:
        print(f"  - {inst.get('id')}"
              f"  ({float(inst.get('confidence', 0.5)):.0%} conf,"
              f" {int(inst.get('eval_wins', 0))} win(s)/"
              f"{int(inst.get('eval_opportunities', 0))} opp,"
              f" {inst.get('domain', 'general')}, {inst.get('status', '?')})")
        print(f"      trigger: {inst.get('trigger', 'unknown')}")
    if not unproven:
        print("  (none -- no high-confidence instinct is missing green-bar wins)")

    print()
    print("To PROMOTE a candidate into a skill, run /cco-evolve <id> -- it routes")
    print("the candidate through the operator-gated /learn-eval quality gate")
    print("(overlap checklist -> Save/Improve/Absorb/Drop -> your confirmation)")
    print("before writing ~/.claude/skills/learned/<name>/SKILL.md. This command")
    print("itself writes NOTHING.")
    print(f"\n{'=' * 60}\n")
    return 0


# ─────────────────────────────────────────────
# prune  -- 30-day pending TTL  (ported from instinct-cli.py cmd_prune +
#           _parse_created_date; only `pending` rows, never active/dropped)
# ─────────────────────────────────────────────

def _parse_date_string(value: str) -> Optional[datetime]:
    """Parse a date frontmatter value (YYYY-MM-DD or ISO) -> tz-aware datetime.

    The SINGLE source of the accepted date formats — reused by both
    `_parse_created_date` (the prune TTL) and `cmd_decay` (the last_eval age gate)
    so the format list is never duplicated. Returns None on an empty/unparseable
    value (the caller decides the fallback / skip).
    """
    date_str = str(value or "").strip().strip('"').strip("'")
    if not date_str:
        return None
    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            dt = datetime.strptime(date_str, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


def _parse_created_date(inst: dict) -> Optional[datetime]:
    """Parse a 'created' frontmatter value (YYYY-MM-DD or ISO) -> datetime.

    Falls back to the file mtime if `created` is missing/unparseable.
    """
    dt = _parse_date_string(inst.get("created", ""))
    if dt is not None:
        return dt
    # Fallback: file mtime.
    src = inst.get("_source_file")
    if src:
        try:
            return datetime.fromtimestamp(Path(src).stat().st_mtime, tz=timezone.utc)
        except OSError:
            return None
    return None


def cmd_prune(args) -> int:
    """Delete `status: pending` instincts older than the TTL (--dry-run safe)."""
    max_age = args.max_age
    dry_run = args.dry_run
    now = datetime.now(timezone.utc)

    instincts = load_all()
    expired = []
    for inst in instincts:
        # NEVER prune operator-reviewed instincts.
        if inst.get("status") != "pending":
            continue
        created = _parse_created_date(inst)
        if created is None:
            print(f"Warning: could not parse 'created' for {inst.get('id')}; "
                  "skipping (not pruned).", file=sys.stderr)
            continue
        age_days = (now - created).days
        if age_days >= max_age:
            expired.append((inst, age_days))

    if dry_run:
        if expired:
            print(f"\n[DRY RUN] Would prune {len(expired)} pending instinct(s) "
                  f"older than {max_age} days:\n")
            for inst, age in expired:
                print(f"  - {inst.get('id')} (age: {age}d) -- {inst.get('_source_file')}")
        else:
            print(f"No pending instincts older than {max_age} days.")
        print(f"\n[DRY RUN] Nothing deleted. {len(expired)} would be pruned.")
        return 0

    pruned = 0
    for inst, age in expired:
        src = inst.get("_source_file")
        if not src:
            continue
        # Re-validate the id before deleting (defense-in-depth at the FS boundary).
        if not _validate_instinct_id(str(inst.get("id", ""))):
            print(f"Warning: refusing to prune instinct with invalid id: "
                  f"{inst.get('id')!r}", file=sys.stderr)
            continue
        try:
            os.remove(src)
            pruned += 1
            print(f"  pruned: {inst.get('id')} (age: {age}d)")
        except OSError as e:
            print(f"Warning: failed to delete {src}: {e}", file=sys.stderr)

    if pruned == 0:
        print(f"No pending instincts older than {max_age} days.")
    else:
        print(f"\nPruned {pruned} pending instinct(s) older than {max_age} days.")
    return 0


# ─────────────────────────────────────────────
# decay  -- EVOLVE-04: auto-DEMOTE instincts that accrued opportunities but never
#   correlated with a green-bar win (the claude-recall "0 citations" mode designed
#   out). Mirrors prune's shape (--dry-run safe, age-gated) but REWRITES status ->
#   demoted + decays confidence instead of deleting (demotion != deletion; a demoted
#   instinct's file persists and is re-promotable). NEVER touches `dropped`/`demoted`.
# ─────────────────────────────────────────────

# Candidate statuses for decay: machine/observed rows + already-active rows that went
# stale. `dropped` (operator-rejected) and `demoted` (already demoted) are NEVER decayed.
_DECAY_CANDIDATE_STATUSES = ("observed", "pending", "active")


def cmd_decay(args) -> int:
    """Auto-demote never-correlated instincts (opportunities >= floor, 0 wins, aged)."""
    min_age = args.min_age
    min_opportunities = args.min_opportunities
    dry_run = args.dry_run
    now = datetime.now(timezone.utc)

    instincts = load_all()
    to_demote = []
    for inst in instincts:
        status = inst.get("status", "")
        # Only observed/pending/active are candidates; never dropped/demoted.
        if status not in _DECAY_CANDIDATE_STATUSES:
            continue
        opportunities = int(inst.get("eval_opportunities", 0))
        wins = int(inst.get("eval_wins", 0))
        # Must have measured enough opportunities AND never won.
        if opportunities < min_opportunities or wins != 0:
            continue
        # Age gate on last_eval: an unparseable/empty last_eval is NOT yet eligible
        # (skip, mirroring how prune skips an unparseable `created`).
        last_eval = _parse_date_string(inst.get("last_eval", ""))
        if last_eval is None:
            continue
        age_days = (now - last_eval).days
        if age_days >= min_age:
            to_demote.append((inst, age_days))

    if dry_run:
        if to_demote:
            print(f"\n[DRY RUN] Would demote {len(to_demote)} never-correlated "
                  f"instinct(s) (>= {min_opportunities} opportunities, 0 wins, "
                  f"last_eval >= {min_age}d old):\n")
            for inst, age in to_demote:
                conf = float(inst.get("confidence", 0.5))
                print(f"  - {inst.get('id')} "
                      f"({int(inst.get('eval_wins', 0))}/"
                      f"{int(inst.get('eval_opportunities', 0))} green-bar, "
                      f"last_eval age {age}d, conf {conf:.0%} -> "
                      f"{round(conf * CONFIDENCE_DECAY, 3):.0%}) "
                      f"-- {inst.get('_source_file')}")
        else:
            print(f"No never-correlated instincts past the decay gate "
                  f"(>= {min_opportunities} opportunities, 0 wins, "
                  f"last_eval >= {min_age}d).")
        print(f"\n[DRY RUN] Nothing demoted. {len(to_demote)} would be demoted.")
        return 0

    demoted = 0
    for inst, age in to_demote:
        conf = float(inst.get("confidence", 0.5))
        new_conf = round(conf * CONFIDENCE_DECAY, 3)
        if _rewrite_instinct(inst, status="demoted", confidence=new_conf):
            demoted += 1
            print(f"  demoted: {inst.get('id')} "
                  f"(0/{int(inst.get('eval_opportunities', 0))} green-bar, "
                  f"age {age}d, conf {conf:.0%} -> {new_conf:.0%})")

    if demoted == 0:
        print(f"No never-correlated instincts past the decay gate "
              f"(>= {min_opportunities} opportunities, 0 wins, "
              f"last_eval >= {min_age}d).")
    else:
        print(f"\nDemoted {demoted} never-correlated instinct(s). "
              "Demoted instincts persist and are re-promotable.")
    return 0


# ─────────────────────────────────────────────
# promote  -- EVOLVE-05: the ONLY observed->active path. Operator-run (human-gated):
#   cco-evolve.md drives it AFTER the /learn-eval confirmation. Reasserts the EVOLVE-03
#   eval-gate at the action boundary (frequency alone never promotes) AND enforces the
#   MAX_ACTIVE hard cap — promotion past the cap REFUSES unless an explicit --demote frees
#   a slot. It NEVER writes the (MAX_ACTIVE+1)-th active row. The engine never auto-runs
#   this; demotion (decay) is the only automatic mutation and only ever reduces standing.
# ─────────────────────────────────────────────

def _is_eval_eligible(inst: dict) -> bool:
    """The EVOLVE-03 green-bar gate, reasserted at the promote action boundary."""
    return (int(inst.get("eval_wins", 0)) >= EVAL_WIN_THRESHOLD
            and int(inst.get("eval_opportunities", 0)) >= MIN_OPPORTUNITIES)


def _weakest_active(actives: list[dict]) -> Optional[dict]:
    """Pick the weakest active instinct to suggest for demotion: lowest eval_wins,
    then oldest last_eval (an unparseable last_eval sorts oldest)."""
    if not actives:
        return None

    def _key(inst):
        wins = int(inst.get("eval_wins", 0))
        dt = _parse_date_string(inst.get("last_eval", ""))
        # oldest first: None (unparseable) sorts oldest; otherwise by timestamp.
        ts = dt.timestamp() if dt is not None else float("-inf")
        return (wins, ts)

    return sorted(actives, key=_key)[0]


def cmd_promote(args) -> int:
    """Promote one observed/demoted instinct to active (eval-gated + cap-bounded)."""
    iid = str(args.id)
    instincts = load_all()
    by_id = {str(i.get("id", "")): i for i in instincts}

    inst = by_id.get(iid)
    if inst is None:
        print(f"promote: instinct not found: {iid!r}")
        return 1

    if inst.get("status") == "active":
        print(f"promote: {iid} is already active -- nothing to do.")
        return 0

    # Eval-gate (EVOLVE-03 at the action boundary): frequency alone never promotes.
    if not _is_eval_eligible(inst):
        print(f"promote: {iid} is not eligible: needs the green-bar eval "
              f"(eval_wins >= {EVAL_WIN_THRESHOLD}, opportunities >= "
              f"{MIN_OPPORTUNITIES}); frequency alone never promotes. "
              f"(has {int(inst.get('eval_wins', 0))} win(s)/"
              f"{int(inst.get('eval_opportunities', 0))} opportunities)")
        return 1

    # Hard cap (EVOLVE-05): count current actives; refuse the (MAX_ACTIVE+1)-th.
    actives = [i for i in instincts if i.get("status") == "active"]
    if len(actives) >= MAX_ACTIVE:
        demote_id = getattr(args, "demote", None)
        if demote_id:
            demote_target = by_id.get(str(demote_id))
            if demote_target is None or demote_target.get("status") != "active":
                print(f"promote: --demote target {str(demote_id)!r} is not an "
                      f"active instinct; cannot free a slot.")
                return 1
            if not _rewrite_instinct(demote_target, status="demoted"):
                print(f"promote: failed to demote {demote_id}; aborting.")
                return 1
            print(f"  demoted: {demote_id} (freed an active slot)")
        else:
            weakest = _weakest_active(actives)
            weakest_id = weakest.get("id") if weakest else "<id>"
            print(f"promote: active set is full (MAX_ACTIVE={MAX_ACTIVE}); "
                  f"demote one first (e.g. --demote {weakest_id}).")
            return 1

    if not _rewrite_instinct(inst, status="active"):
        print(f"promote: failed to write {iid}.")
        return 1
    print(f"\nPromoted {iid} -> active.")
    return 0


# ─────────────────────────────────────────────
# Main  (argparse: status | evolve | prune | decay | promote.)
# ─────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cco-instinct.py",
        description="Review / cluster / prune the cco-memory instinct store "
                    "(pure-Python, no external spawn, no LLM).",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    subparsers.add_parser("status", help="Review the store (grouped by domain)")

    subparsers.add_parser(
        "evolve",
        help="Cluster + list promotion candidates (PRINT ONLY -- writes nothing)",
    )

    prune_parser = subparsers.add_parser(
        "prune", help="Delete pending instincts older than the TTL")
    prune_parser.add_argument(
        "--max-age", type=int, default=PENDING_TTL_DAYS,
        help=f"Max age in days before pruning (default: {PENDING_TTL_DAYS})")
    prune_parser.add_argument(
        "--dry-run", action="store_true",
        help="List what WOULD be pruned; delete nothing")

    decay_parser = subparsers.add_parser(
        "decay",
        help="Auto-demote never-correlated instincts (>= opportunities, 0 wins, aged)")
    decay_parser.add_argument(
        "--min-age", type=int, default=MIN_AGE_DAYS,
        help=f"Min last_eval age in days before demoting (default: {MIN_AGE_DAYS})")
    decay_parser.add_argument(
        "--min-opportunities", type=int, default=MIN_OPPORTUNITIES,
        help=f"Min measured opportunities before demoting (default: {MIN_OPPORTUNITIES})")
    decay_parser.add_argument(
        "--dry-run", action="store_true",
        help="List what WOULD be demoted; write nothing")

    promote_parser = subparsers.add_parser(
        "promote",
        help="Promote an observed/demoted instinct to active (eval-gated + capped)")
    promote_parser.add_argument(
        "id", help="The instinct id to promote to active")
    promote_parser.add_argument(
        "--demote", default=None,
        help="An active instinct id to demote first, freeing a slot when the "
             f"active set is at MAX_ACTIVE ({MAX_ACTIVE})")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "status":
        return cmd_status(args)
    if args.command == "evolve":
        return cmd_evolve(args)
    if args.command == "prune":
        return cmd_prune(args)
    if args.command == "decay":
        return cmd_decay(args)
    if args.command == "promote":
        return cmd_promote(args)
    # Default (no args) -> status.
    return cmd_status(args)


if __name__ == "__main__":
    sys.exit(main())
