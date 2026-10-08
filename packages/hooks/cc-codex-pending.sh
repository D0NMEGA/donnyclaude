#!/usr/bin/env bash
# UserPromptSubmit / SessionStart hook: surface cc-codex jobs that finished while no turn was
# running (the turn ended, a usage limit hit, or the session restarted). Whatever this prints is
# added to Claude's context, so it reads as an instruction to review the output and ack the job.
out="$(bash "$HOME/.claude/bin/cc-codex" pending 2>/dev/null || true)"
[ -n "$out" ] && printf '%s\n' "$out"
exit 0
