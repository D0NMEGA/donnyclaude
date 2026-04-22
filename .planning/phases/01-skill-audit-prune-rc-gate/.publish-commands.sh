#!/usr/bin/env bash
# v1.2.0-rc.1 publish runbook — reference only, NOT auto-executed.
#
# Run interactively from the repo root on Donovan's machine, after:
#   - package.json is at 1.2.0-rc.1 (committed as dc61452: "chore(release): bump to 1.2.0-rc.1 for RC publish")
#   - HEAD~1 is the Plan 01 cruft-removal commit (0a1a913: "feat(skills): archive 2 cruft skills...")
#   - npm credentials are loaded (npm whoami returns your account)
#   - gh CLI is authenticated (gh auth status is green)
#
# Each step's pre-conditions and failure modes are documented inline.
# Do NOT skip the dist-tag isolation verification (Step 4) — it is the gate mechanism.

set -euo pipefail

REPO_ROOT="/Users/donmega/Desktop/donnyclaude"
cd "$REPO_ROOT"

# -----------------------------------------------------------------------------
# Step 0 — Pre-publish sanity checks.
# -----------------------------------------------------------------------------
# Verify package.json is at 1.2.0-rc.1 and HEAD is the version-bump commit.
# If either fails, abort — the upstream plans did not land correctly.

node -e "const p = JSON.parse(require('fs').readFileSync('package.json', 'utf-8')); if (p.version !== '1.2.0-rc.1') { console.error('ABORT: package.json version is ' + p.version + ', expected 1.2.0-rc.1'); process.exit(1); }"
git log -10 --format='%s' | grep -qF 'chore(release): bump to 1.2.0-rc.1' || { echo "ABORT: version-bump commit missing from last 10 commits"; exit 1; }
git log -10 --format='%s' | grep -qF 'feat(skills): archive' || { echo "ABORT: cruft-removal commit missing from last 10 commits"; exit 1; }

PRUNE_COMMIT_SHA=$(git log -10 --format='%H %s' | grep -F 'feat(skills): archive' | head -1 | awk '{print $1}')
BUMP_COMMIT_SHA=$(git log -10 --format='%H %s' | grep -F 'chore(release): bump to 1.2.0-rc.1' | head -1 | awk '{print $1}')
PUBLISH_COMMIT_SHA=$(git rev-parse HEAD)
echo "Prune commit:   $PRUNE_COMMIT_SHA"
echo "Bump commit:    $BUMP_COMMIT_SHA"
echo "Publish commit: $PUBLISH_COMMIT_SHA (HEAD — this tree is what npm packs)"

# -----------------------------------------------------------------------------
# Step 1 — Dry-run pack to verify tarball contents.
# -----------------------------------------------------------------------------
# Confirm docs/PRUNE-LOG.md, docs/CHANGELOG.md, docs/release-notes/v1.2.0-rc.1.md,
# and packages/_archived-skills/README.md are all included. The archived skill
# bodies are bundled too — that's intentional per D-23.

npm pack --dry-run

# -----------------------------------------------------------------------------
# Step 2 — Publish to npm under the rc dist-tag (D-19).
# -----------------------------------------------------------------------------
# The --tag rc flag is MANDATORY. Without it, the latest dist-tag moves to
# 1.2.0-rc.1 and the gate is broken — every `npx donnyclaude` invocation
# would pick up the pruned version regardless of opt-in.

npm publish --tag rc

# -----------------------------------------------------------------------------
# Step 3 — Capture the publish moment as the cooling-off gate start timestamp.
# -----------------------------------------------------------------------------
# Plan 03 reads this file to compute the 7×24h gate window endpoint.
# Do this IMMEDIATELY after `npm publish` returns — the publish moment is the
# anchor the rest of Phase 1 depends on.

date -u +%Y-%m-%dT%H:%M:%SZ > .planning/phases/01-skill-audit-prune-rc-gate/.gate-start-timestamp
GATE_START=$(cat .planning/phases/01-skill-audit-prune-rc-gate/.gate-start-timestamp)
echo "Gate start recorded: $GATE_START"

# -----------------------------------------------------------------------------
# Step 4 — Verify dist-tag isolation (critical gate-mechanism check per D-19).
# -----------------------------------------------------------------------------
# `@latest` MUST still return 1.1.x; `@rc` MUST return 1.2.0-rc.1.
# If `@latest` returns 1.2.0-rc.1, the --tag rc flag was missed — abort
# and contact npm to deprecate the bad publish before proceeding.

LATEST_VERSION=$(npm view donnyclaude@latest version)
RC_VERSION=$(npm view donnyclaude@rc version)
echo "npm latest → $LATEST_VERSION (must NOT be 1.2.0-rc.1)"
echo "npm rc     → $RC_VERSION (must be 1.2.0-rc.1)"

if [ "$LATEST_VERSION" = "1.2.0-rc.1" ]; then
  echo "FATAL: latest dist-tag points at 1.2.0-rc.1 — the gate is broken."
  echo "Action: deprecate 1.2.0-rc.1 and re-publish correctly."
  exit 1
fi
if [ "$RC_VERSION" != "1.2.0-rc.1" ]; then
  echo "FATAL: rc dist-tag does not point at 1.2.0-rc.1"
  exit 1
fi

# -----------------------------------------------------------------------------
# Step 5 — Create the annotated git tag pointing at the version-bump commit.
# -----------------------------------------------------------------------------
# Tag HEAD (the publish commit). HEAD's tree matches the published tarball;
# `npm publish` packs HEAD. Verify afterward with:
#   git log v1.2.0-rc.1 -1 --format='%s'

git tag -a v1.2.0-rc.1 "$PUBLISH_COMMIT_SHA" -m "v1.2.0-rc.1: cruft-only skill prune RC

Archives 2 cruft skills (configure-ecc + continuous-learning loser)
from packages/skills/. Count: 107 → 105.

See docs/PRUNE-LOG.md for per-skill rationale and restore commands.

The broader training-duplicate prune originally scoped for v1.2 is
deferred to v1.3 pending rubric redesign — the calibration gate
surfaced that clause (c) could not distinguish training duplicates
from catalog cross-links in the current distribution.

Cooling-off gate: 7×24h from publish moment, three obligations per
.planning/phases/01-skill-audit-prune-rc-gate/01-CONTEXT.md §D-21."

git push origin v1.2.0-rc.1

# -----------------------------------------------------------------------------
# Step 6 — Create the GitHub pre-release.
# -----------------------------------------------------------------------------
# Uses the pre-authored release notes at docs/release-notes/v1.2.0-rc.1.md.
# --prerelease flag is mandatory (this is an RC, not a stable release).
# --target pins the release to the version-bump commit (HEAD at publish time).

gh release create v1.2.0-rc.1 \
  --prerelease \
  --title "v1.2.0-rc.1: cruft-only skill prune" \
  --notes-file docs/release-notes/v1.2.0-rc.1.md \
  --target "$PUBLISH_COMMIT_SHA"

# -----------------------------------------------------------------------------
# Step 7 — Verify GitHub release landed and is marked prerelease.
# -----------------------------------------------------------------------------

gh release view v1.2.0-rc.1
gh release view v1.2.0-rc.1 --json isPrerelease
# Must include "isPrerelease": true

# -----------------------------------------------------------------------------
# Step 8 — Activate COOLING-OFF-LOG.md by substituting the timestamp placeholders.
# -----------------------------------------------------------------------------
# Plan 03 Task 1 commits the activated log. This step fills the placeholders
# so that commit is a single-file diff with concrete timestamps.

GATE_END=$(node -e "const d = new Date(process.argv[1]); d.setUTCHours(d.getUTCHours() + 168); console.log(d.toISOString())" "$GATE_START")
echo "Gate end calculated: $GATE_END"

sed -i.bak "s|{{GATE_START_TIMESTAMP_UTC}}|$GATE_START|g; s|{{GATE_END_TIMESTAMP_UTC}}|$GATE_END|g" \
  .planning/phases/01-skill-audit-prune-rc-gate/COOLING-OFF-LOG.md
rm .planning/phases/01-skill-audit-prune-rc-gate/COOLING-OFF-LOG.md.bak

# Sanity check: no placeholders remain.
if grep -qE '\{\{[A-Z_]+\}\}' .planning/phases/01-skill-audit-prune-rc-gate/COOLING-OFF-LOG.md; then
  echo "ERROR: placeholders still present in COOLING-OFF-LOG.md"
  exit 1
fi

echo ""
echo "======================================================================"
echo " v1.2.0-rc.1 publish complete."
echo "   npm rc tag:    $RC_VERSION"
echo "   npm latest:    $LATEST_VERSION (unchanged — dist-tag isolation intact)"
echo "   GitHub release: v1.2.0-rc.1 (prerelease)"
echo "   Gate start:    $GATE_START"
echo "   Gate end:      $GATE_END"
echo ""
echo " Next: commit the activated COOLING-OFF-LOG.md per Plan 03 Task 1,"
echo " then execute obligations (a), (b), (c) during the 168-hour window."
echo "======================================================================"
