#!/usr/bin/env bash
# SessionEnd: (1) stop this session's own browser-harness daemon (BU_NAME=cc-<pid>, set by the
# claude() wrapper so concurrent sessions never share one tab); (2) commit the vault's journal
# notes (Sessions/, _private/, cerebrum.md) so nothing written by hooks is left uncommitted.
if [[ "${BU_NAME:-}" == cc-* ]]; then
  rt="${BH_RUNTIME_DIR:-$HOME/.config/browser-harness/runtime}"
  pidf="$rt/bu-${BU_NAME}.pid"
  if [ -f "$pidf" ]; then kill "$(tr -dc 0-9 < "$pidf" | head -c 8)" 2>/dev/null || true; fi
  # fallback: the daemon that holds this session's socket
  for pid in $(pgrep -f 'browser_harness.daemon' 2>/dev/null); do
    lsof -U -a -p "$pid" 2>/dev/null | grep -q "bu-${BU_NAME}.sock" && kill "$pid" 2>/dev/null || true
  done
fi
if git -C "$HOME/vault" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$HOME/vault" add -A Sessions _private cerebrum.md 2>/dev/null || true
  git -C "$HOME/vault" diff --cached --quiet 2>/dev/null || git -C "$HOME/vault" commit -q -m "journal: session notes $(date +%F)" 2>/dev/null || true
fi
exit 0
