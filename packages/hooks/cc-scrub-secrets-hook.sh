#!/usr/bin/env bash
# SessionStart (async): redact known secret values from local transcripts and logs, at most once
# per 20 hours, skipping the transcript of the session that is starting (it is being written).
sid=$(python3 -I -c 'import json,sys
try: print(json.load(sys.stdin).get("session_id",""))
except Exception: print("")' 2>/dev/null)
if [ -n "$sid" ]; then
  python3 -I "$HOME/.claude/bin/cc-scrub-secrets" --daily --skip "$sid" >/dev/null 2>&1 || true
else
  python3 -I "$HOME/.claude/bin/cc-scrub-secrets" --daily >/dev/null 2>&1 || true
fi
exit 0
