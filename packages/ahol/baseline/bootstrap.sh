#!/usr/bin/env bash
#
# packages/ahol/baseline/bootstrap.sh
#
# Purpose:
#   Bootstrap a clean Tier-2 AHOL baseline directory that invoke.sh can drive
#   via the AHOL_BASELINE env var. The directory contains a minimal
#   settings.json (tool allowlist: Read, Bash, Edit), the Q1b patch-only
#   system prompt, and the invoke.sh CLI wrapper. Zero skills, zero agents,
#   zero rules, zero hooks, zero commands, zero MCP servers.
#
# Source files (must exist before running):
#   $REPO_ROOT/packages/ahol/baseline/system-prompt.txt
#   $REPO_ROOT/packages/ahol/baseline/invoke.sh
#
# Target:
#   Default: $REPO_ROOT/.ahol/baseline/
#   Override via env: AHOL_TARGET=/absolute/path
#
# Idempotency contract:
#   - Target missing: full bootstrap, validate, report "bootstrapped OK".
#   - Target present and valid (all 4 checks pass): report
#     "already bootstrapped, state valid" and exit 0 with no changes.
#   - Target present and invalid: exit nonzero with a specific diagnostic.
#     No auto-repair. Operator must rm -rf and re-run.
#
# Exit codes:
#   0  success (fresh bootstrap or pre-existing valid state)
#   non-zero  any error (missing sources, git issues, validation failure,
#             missing shasum tooling, invalid target)
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Embedded expected hashes. Computed at authoring time from the source files
# in packages/ahol/baseline/. If source files change, regenerate this script.
# ---------------------------------------------------------------------------
EXPECTED_SPROMPT_SHA256="d888c24b007968d1a42418fec37de34fa4bf99d4f1b613a94431493f5214a026"
EXPECTED_INVOKE_SHA256="8449de3443d3e683896b61ad9534d0379dbb568cdf837ac6e39f88c8c0fbae98"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

die() {
  printf '%s\n' "bootstrap.sh error: $*" >&2
  exit 1
}

resolve_repo_root() {
  # Prints the repo root on stdout, or empty string if not in a git repo.
  git rev-parse --show-toplevel 2>/dev/null || printf ''
}

compute_sha256() {
  # Prints the hex SHA256 digest of the file at $1 on stdout.
  # Portable between macOS (shasum) and Linux coreutils (sha256sum).
  local path="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  else
    die "neither shasum nor sha256sum available on PATH"
  fi
}

check_no_extra_dirs() {
  # Returns 0 if none of the forbidden subdirectories exist under
  # $TARGET/.claude/, nonzero otherwise.
  local claude_dir="$1/.claude"
  local forbidden
  for forbidden in skills agents rules hooks commands mcp; do
    if [ -e "$claude_dir/$forbidden" ]; then
      printf 'forbidden path present: %s\n' "$claude_dir/$forbidden" >&2
      return 1
    fi
  done
  return 0
}

check_settings_allowlist() {
  # Returns 0 if settings.json parses as JSON and the tool allowlist is
  # exactly {Read, Bash, Edit} (no more, no less), nonzero otherwise.
  # Uses python3 for portable JSON parsing without requiring jq.
  local settings="$1/.claude/settings.json"
  if [ ! -f "$settings" ]; then
    printf 'settings.json missing at %s\n' "$settings" >&2
    return 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    die "python3 required for settings.json allowlist verification"
  fi
  python3 - "$settings" <<'PYEOF'
import json, sys
path = sys.argv[1]
try:
    with open(path, 'r') as f:
        data = json.load(f)
except Exception as e:
    print("settings.json parse error: " + str(e), file=sys.stderr)
    sys.exit(1)
perms = data.get("permissions", {})
allow = perms.get("allow", [])
expected = {"Read", "Bash", "Edit"}
actual = set(allow)
if actual != expected:
    print("settings.json allowlist mismatch: expected " + str(sorted(expected)) + " got " + str(sorted(actual)), file=sys.stderr)
    sys.exit(1)
if len(allow) != len(actual):
    print("settings.json allowlist has duplicates: " + str(allow), file=sys.stderr)
    sys.exit(1)
sys.exit(0)
PYEOF
}

check_sprompt_hash() {
  local target="$1"
  local path="$target/system-prompt.txt"
  if [ ! -f "$path" ]; then
    printf 'system-prompt.txt missing at %s\n' "$path" >&2
    return 1
  fi
  local actual
  actual="$(compute_sha256 "$path")"
  if [ "$actual" != "$EXPECTED_SPROMPT_SHA256" ]; then
    printf 'system-prompt.txt sha256 mismatch: expected %s got %s\n' \
      "$EXPECTED_SPROMPT_SHA256" "$actual" >&2
    return 1
  fi
  return 0
}

check_invoke_hash_and_exec() {
  local target="$1"
  local path="$target/invoke.sh"
  if [ ! -f "$path" ]; then
    printf 'invoke.sh missing at %s\n' "$path" >&2
    return 1
  fi
  local actual
  actual="$(compute_sha256 "$path")"
  if [ "$actual" != "$EXPECTED_INVOKE_SHA256" ]; then
    printf 'invoke.sh sha256 mismatch: expected %s got %s\n' \
      "$EXPECTED_INVOKE_SHA256" "$actual" >&2
    return 1
  fi
  if [ ! -x "$path" ]; then
    printf 'invoke.sh not executable: %s\n' "$path" >&2
    return 1
  fi
  return 0
}

validate_state() {
  # Runs all 4 final-state validation checks against $1 (target dir).
  # Returns 0 only if every check passes. Emits per-check diagnostics to
  # stderr on failure.
  local target="$1"
  local ok=0

  if ! check_no_extra_dirs "$target"; then
    ok=1
  fi
  if ! check_settings_allowlist "$target"; then
    ok=1
  fi
  if ! check_sprompt_hash "$target"; then
    ok=1
  fi
  if ! check_invoke_hash_and_exec "$target"; then
    ok=1
  fi

  return "$ok"
}

write_settings_json() {
  # Writes the minimal settings.json to $1 (settings path). Allowlist
  # locked to Read, Bash, Edit. Model pinned to opus. Nothing else.
  local settings_path="$1"
  cat >"$settings_path" <<'JSONEOF'
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "model": "opus",
  "permissions": {
    "allow": ["Read", "Bash", "Edit"]
  }
}
JSONEOF
}

bootstrap() {
  # Creates the target layout from source files. Assumes source files have
  # already been verified to exist by the caller. Validation runs after.
  local target="$1"
  local src_sprompt="$2"
  local src_invoke="$3"

  mkdir -p "$target/.claude"

  write_settings_json "$target/.claude/settings.json"

  cp "$src_sprompt" "$target/system-prompt.txt"
  cp "$src_invoke" "$target/invoke.sh"
  chmod +x "$target/invoke.sh"
}

# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------

main() {
  local repo_root
  repo_root="$(resolve_repo_root)"

  local target
  if [ -n "${AHOL_TARGET:-}" ]; then
    target="$AHOL_TARGET"
  elif [ -n "$repo_root" ]; then
    target="$repo_root/.ahol/baseline"
  else
    die "not inside a git repo and AHOL_TARGET env var not set"
  fi

  # Source files live in the repo packages directory. Even when AHOL_TARGET
  # overrides the destination, the sources are read from the repo.
  if [ -z "$repo_root" ]; then
    die "cannot locate repo root to read source files (run inside donnyclaude repo)"
  fi
  local src_dir="$repo_root/packages/ahol/baseline"
  local src_sprompt="$src_dir/system-prompt.txt"
  local src_invoke="$src_dir/invoke.sh"

  if [ ! -f "$src_sprompt" ]; then
    die "source file missing: $src_sprompt"
  fi
  if [ ! -f "$src_invoke" ]; then
    die "source file missing: $src_invoke"
  fi

  # Early check: confirm shasum or sha256sum is available before any work.
  if ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1; then
    die "neither shasum nor sha256sum available on PATH"
  fi

  local fresh=0
  if [ ! -d "$target" ]; then
    fresh=1
    bootstrap "$target" "$src_sprompt" "$src_invoke"
  fi

  if validate_state "$target"; then
    if [ "$fresh" -eq 1 ]; then
      printf 'bootstrapped OK: %s\n' "$target"
    else
      printf 'already bootstrapped, state valid: %s\n' "$target"
    fi
    exit 0
  else
    die "target exists but state is invalid at $target. Remove it (rm -rf) and re-run."
  fi
}

main "$@"
