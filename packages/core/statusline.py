#!/usr/bin/env python3
"""Claude Code statusline (3 lines).

  line 1 : Model · effort · think  ·  ⧉<window> context bar (┊ = auto-compact mark)
  line 2 : 5h session bar  · <countdown> to reset · <clock> CT
  line 3 : 7d weekly  bar  · <countdown> to reset · <clock> CT

5h and 7d are exactly stacked (same start column). Left-aligned on purpose:
Claude Code's statusline stdin carries NO terminal-width field and the renderer
strips leading whitespace + truncates to width, so reliable flush-right multi-line
isn't possible — left-stacked is the alignment that always holds with no runoff.
All fields verified in the 2.1.x binary / a live payload.
"""
import sys
import json
import os
import time
import tempfile
import re
import subprocess
from datetime import datetime
try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:
    CT = None

R = "\033[0m"
def c(x): return f"\033[{x}m"
DIM, BOLD = c("2"), c("1")
GREEN, YELLOW, RED, CYAN, GREY, MAG = c("38;5;77"), c("38;5;214"), c("38;5;203"), c("38;5;45"), c("38;5;244"), c("38;5;177")

def heat(p): return GREEN if p < 50 else (YELLOW if p < 80 else RED)

def bar(pct, width=6, marker=None):
    pct = max(0.0, min(100.0, float(pct)))
    filled = round(pct / 100 * width)
    cells = ["█"] * filled + ["░"] * (width - filled)
    if marker is not None:
        mi = min(width - 1, round(marker / 100 * width))
        cells[mi] = "┊" if cells[mi] == "░" else "▓"
    return "".join(cells)

def countdown(secs):
    secs = int(max(0, secs))
    d, r = divmod(secs, 86400)
    h, r = divmod(r, 3600)
    m, _ = divmod(r, 60)
    if d:
        return f"{d}d{h}h"
    if h:
        return f"{h}h{m}m"
    return f"{m}m"

def ct_clock(ts, far):
    if not CT:
        return ""
    return datetime.fromtimestamp(ts, CT).strftime("%a %-I:%M %p" if far else "%-I:%M %p") + " CT"

def rate_line(w, icon):
    pct = w.get("used_percentage")
    if pct is None:
        return None
    seg = f"{GREY}{icon}{R} {heat(pct)}{bar(pct,6)} {pct:>3.0f}%{R}"
    if w.get("resets_at"):
        secs = w["resets_at"] - time.time()
        seg += f"{DIM} · {countdown(secs)} to reset · {ct_clock(w['resets_at'], secs > 86400)}{R}"
    return seg

def git_branch(cwd, sid):
    """Branch name for cwd via a cached git subprocess. Never raises (D-03, C-1)."""
    if not cwd:
        return None
    try:
        cache = None
        if sid and not re.search(r'[/\\]|\.\.', sid):
            cache = os.path.join(tempfile.gettempdir(), f"claude-git-{sid}.json")
        now = time.time()
        if cache and os.path.exists(cache):
            try:
                cached = json.load(open(cache))
                if now - cached.get("t", 0) < 5:
                    return cached.get("branch")
            except Exception:
                pass
        out = subprocess.run(["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"],
                             capture_output=True, text=True, timeout=1.0)
        branch = out.stdout.strip() if out.returncode == 0 else None
        if cache:
            try:
                with open(cache, "w") as cf:
                    json.dump({"branch": branch, "t": now}, cf)
            except Exception:
                pass
        return branch
    except Exception:
        return None

def main():
    try:
        d = json.load(sys.stdin)
    except Exception:
        print("", end="")
        return
    try:  # capture last payload + width sources for diagnostics
        dbg = {"stdin_keys": sorted(d.keys()),
               "env_COLUMNS": os.environ.get("COLUMNS"),
               "get_terminal_size": None}
        try:
            import shutil
            dbg["get_terminal_size"] = list(shutil.get_terminal_size((0, 0)))
        except Exception:
            pass
        with open(os.path.expanduser("~/.claude/statusline-last.json"), "w") as f:
            json.dump({"payload": d, "_diag": dbg}, f)
    except Exception:
        pass

    lines = []

    # line 1: model · effort · think · context
    model = (d.get("model") or {}).get("display_name") or (d.get("model") or {}).get("id") or "?"
    l1 = f"{BOLD}{CYAN}{model}{R}"
    eff = (d.get("effort") or {}).get("level")
    if eff:
        l1 += f"{DIM} · {R}{(MAG if eff in ('max','xhigh') else GREY)}{eff}{R}"
    if (d.get("thinking") or {}).get("enabled"):
        l1 += f"{DIM} · think{R}"
    cw = d.get("context_window") or {}
    size = cw.get("context_window_size")
    pct = cw.get("used_percentage")
    if pct is None and size and cw.get("total_input_tokens"):
        pct = cw["total_input_tokens"] / size * 100
    if pct is not None:
        try:
            thr = float(os.environ.get("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE", "60"))
        except ValueError:
            thr = 60.0
        label = "1M" if (size or 0) >= 1_000_000 else (f"{size//1000}k" if size else "")
        ut = cw.get("total_input_tokens")
        tok = f" {DIM}{ut/1000:.0f}k/{label}{R}" if ut and ut >= 1000 else ""
        col = GREEN if pct < thr * 0.85 else (YELLOW if pct < thr else RED)
        warn = f" {RED}⚠compact{R}" if pct >= thr else ""
        l1 += f"{DIM}  ·  {R}{col}{bar(pct,10,marker=thr)} {pct:.0f}%{R}{tok}{warn}"

    # cost + lines polish (STATUS-02) — render only present fields, never crash (D-03)
    cost = d.get("cost") or {}
    tc = cost.get("total_cost_usd")
    la = cost.get("total_lines_added")
    lr = cost.get("total_lines_removed")
    if tc is not None:
        try:
            l1 += f"{DIM} · {R}{GREY}${float(tc):.2f}{R}"
        except (TypeError, ValueError):
            pass
    if la or lr:
        l1 += f"{DIM} · {R}{GREEN}+{la or 0}{R}/{RED}-{lr or 0}{R}"

    # git segment from cwd via a cached subprocess (STATUS-02, C-1: those workspace git keys are absent in 2.1.177)
    ws = d.get("workspace") or {}
    cwd = ws.get("current_dir") or os.getcwd()
    sid = d.get("session_id") or ""
    br = git_branch(cwd, sid)
    if br:
        l1 += f"{DIM} · {R}{CYAN}git:{br}{R}"

    # RAW context-usage bridge for the Plan 03 nudge (C-2: $TMPDIR not /tmp; RAW used %, not normalized)
    safe_sid = bool(sid) and not re.search(r'[/\\]|\.\.', sid)
    if safe_sid and pct is not None:
        try:
            rem = cw.get("remaining_percentage")
            if rem is None:
                rem = max(0.0, 100.0 - float(pct))
            bridge = os.path.join(tempfile.gettempdir(), f"claude-ctx-{sid}.json")
            with open(bridge, "w") as bf:
                json.dump({"session_id": sid, "remaining_percentage": rem,
                           "used_pct": round(float(pct)), "used_pct_raw": round(float(pct)),
                           "timestamp": int(time.time())}, bf)
        except Exception:
            pass

    lines.append(l1)

    # lines 2-3: 5h / 7d, exactly stacked
    rl = d.get("rate_limits") or {}
    for key, icon in (("five_hour", "5h"), ("seven_day", "7d")):
        seg = rate_line(rl.get(key) or {}, icon)
        if seg:
            lines.append(seg)

    sys.stdout.write("\n".join(lines))

if __name__ == "__main__":
    main()
