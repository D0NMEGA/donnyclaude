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
# Argparse safety: the Claude Code 2.1.118 --disallowedTools flag is variadic
# (gathers args until the next flag). A positional user prompt placed AFTER
# --disallowedTools is silently gobbled into the disallowed-tools list, which
# makes claude --print error with "Input must be provided either through
# stdin or as a prompt argument." See .planning/research/ahol/DRY-RUN-NOTES.md
# section 5.4 for the full post-mortem. Mitigation applied here:
#   1. --disallowedTools is listed BEFORE --system-prompt-file so the variadic
#      terminates on the next flag.
#   2. The user turn "Apply the fix." is piped via stdin rather than passed as
#      a positional argument. This makes the positional-gobbling bug unreachable.
#   3. {{ISSUE_BODY}} substitution into the system prompt template happens
#      inside this wrapper via a python3 subprocess so the caller only has to
#      set TASK_PROMPT and AHOL_BASELINE; no manual substitution required.
#
# Status: SYNTHESIZED, UNVALIDATED. V0 spike is the validation gate.

set -euo pipefail

: "${AHOL_BASELINE:?AHOL_BASELINE must be set to the baseline directory containing system-prompt.txt}"
: "${TASK_PROMPT:?TASK_PROMPT must be set to the issue body to fix}"

SYSPROMPT_TEMPLATE="$AHOL_BASELINE/system-prompt.txt"
if [[ ! -r "$SYSPROMPT_TEMPLATE" ]]; then
  echo "invoke.sh error: system-prompt.txt not readable at $SYSPROMPT_TEMPLATE" >&2
  exit 2
fi

# Substitute {{ISSUE_BODY}} with the actual issue body into a temp file.
FILLED_SYSPROMPT=$(mktemp -t ahol-sysprompt-XXXXXX.txt)
trap 'rm -f "$FILLED_SYSPROMPT"' EXIT

AHOL_SYSPROMPT_TEMPLATE="$SYSPROMPT_TEMPLATE" \
  AHOL_SYSPROMPT_FILLED="$FILLED_SYSPROMPT" \
  python3 -c '
import os
with open(os.environ["AHOL_SYSPROMPT_TEMPLATE"]) as fh:
    template = fh.read()
with open(os.environ["AHOL_SYSPROMPT_FILLED"], "w") as fh:
    fh.write(template.replace("{{ISSUE_BODY}}", os.environ["TASK_PROMPT"]))
'

# Feed user turn via stdin (avoids positional-arg gobbling by --disallowedTools).
# --bare was removed (commit fixing C5 integration-test-single FAIL): in Claude
# Code 2.1.119 --bare bypasses project-level auth discovery and returns
# "Not logged in" from any CWD outside an authenticated session. See
# .planning/research/ahol/DRY-RUN-NOTES.md line 72: the dry-run already noted
# --bare was not used; C1 added it inadvertently and mock-only self-tests
# masked the regression until C5's first real-claude invocation.
printf 'Apply the fix.\n' | claude \
  --disallowedTools "Write,Task,WebFetch,WebSearch,TodoWrite" \
  --print \
  --model opus \
  --max-turns 50 \
  --effort medium \
  --system-prompt-file "$FILLED_SYSPROMPT"
