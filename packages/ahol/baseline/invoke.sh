#!/usr/bin/env bash
# packages/ahol/baseline/invoke.sh
#
# Q1b patch-only CLI invocation for AHOL baseline (Tier 2) and variants (Tier 3).
# Source: .planning/research/ahol/Q1B-PATCH-ONLY-TEMPLATE-SOURCE.md
#
# Caller must export:
#   AHOL_BASELINE = absolute path to this baseline directory (contains system-prompt.txt)
#   TASK_PROMPT   = issue body text to fix (single SWE-bench-style task description)
#
# Status: SYNTHESIZED, UNVALIDATED. V0 spike is the validation gate.

set -euo pipefail

: "${AHOL_BASELINE:?AHOL_BASELINE must be set to the baseline directory containing system-prompt.txt}"
: "${TASK_PROMPT:?TASK_PROMPT must be set to the issue body to fix}"

claude \
  --print \
  --bare \
  --model opus \
  --max-turns 50 \
  --system-prompt-file "$AHOL_BASELINE/system-prompt.txt" \
  --disallowedTools "Write,Task,WebFetch,WebSearch,TodoWrite" \
  --effort medium \
  "$TASK_PROMPT"
