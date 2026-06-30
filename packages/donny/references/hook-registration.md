# Hook registration

Donny ships six hooks in `hooks/` and the installer deploys them to `~/.claude/hooks/` as
`donny-*.js`. Deploying a hook file does not make it fire: Claude Code only runs a hook that is
registered under an event in `~/.claude/settings.json`. This note records which donny hooks are
wired into the live environment, which are deferred and why, and how the wiring coexists with the
cco-* substrate without double-firing.

The donny install (`node install.mjs`) copies hook files only. It does not edit `settings.json`,
because that file is the user's global config across every project and the cco-* substrate owns most
of its hook events. Registration is therefore a deliberate, surgical step, not an install side
effect. Automating it in the installer is deferred to the Phase 7 cutover.

## What is wired

Two events, each a one-for-one replacement of the hook the original GSD registered. No event gains a
second donny hook, so nothing double-fires.

- `SessionStart` -> `donny-check-update.js` (replaces `gsd-check-update.js`). The donny version does
  a local git-tag version check and never queries npm; the GSD version ran `npm view` every session
  against a package the fork does not publish.
- `PreToolUse` matcher `Write|Edit` -> `donny-prompt-guard.js` (replaces `gsd-prompt-guard.js`).
  Advisory only: it scans content written to `.planning/` for prompt-injection patterns and surfaces
  a warning as `additionalContext`. It never blocks.

## What is deferred, and why

The other four donny hooks are deployed but intentionally left unregistered. The original GSD also
shipped these four unregistered (they were the "dead" GSD hooks); donny keeps them available without
forcing them on.

- `donny-statusline.js` (statusLine): the user runs their own `statusline.py`. Donny does not
  override another tool's statusline.
- `donny-context-monitor.js` (PostToolUse): reads context metrics from the statusline bridge file
  that `donny-statusline.js` writes. With the user's `statusline.py` active that bridge is absent, so
  the monitor has nothing to read. It only makes sense paired with `donny-statusline`.
- `donny-read-guard.js` (PreToolUse): injects read-before-edit guidance for runtimes that do not
  enforce it (OpenCode/MiniMax, Gemini). Claude Code already rejects an unread overwrite and Claude
  follows the pattern natively, so the guard is redundant here.
- `donny-workflow-guard.js` (PreToolUse): opt-in, gated behind `hooks.workflow_guard` (default
  false). Off unless a project asks for it.

## Coexistence with cco-*

The cco-* substrate owns most hook events (SessionStart, PostToolUse, PreCompact, SessionEnd,
PostCompact, PreToolUse, Stop, SubagentStop). The two donny registrations sit alongside the cco-*
hooks on their events and do different work:

- `SessionStart`: `donny-check-update` (version check) runs beside `cco-cerebrum-recall`,
  `cco-vault-audit-nudge`, `cco-autopilot-register`. Distinct purposes; ordered, not racing.
- `PreToolUse Write|Edit`: `donny-prompt-guard` (injection scan) runs beside `cco-cerebrum-check`
  (memory) and the `Bash`/`Read`-matched cco guards. Distinct purposes.

The cutover changed only the two GSD command paths. Every cco-* registration is byte-for-byte
unchanged, so no cco hook moved, dropped, or gained a sibling.

## Cutover procedure and revert

The wiring is two string swaps in `~/.claude/settings.json`, nothing structural:

    node ".../hooks/gsd-check-update.js"  ->  node ".../hooks/donny-check-update.js"
    node ".../hooks/gsd-prompt-guard.js"  ->  node ".../hooks/donny-prompt-guard.js"

Back up `settings.json` first (the install backup root, `~/.claude/.donny-backups/<stamp>/`, is the
convention). To revert, restore that backup: the six `gsd-*` hook files remain on disk and dormant,
so the old registration works again immediately.

## Deferred to Phase 7

- Deleting the dormant `gsd-*` hook files from `~/.claude/hooks/`. They are unregistered and harmless;
  keeping them is what makes the cutover reversible. They get retired with the rest of `gsd-*` once
  donny is proven.
- Teaching `install.mjs` to register the two donny hooks (and back up `settings.json`) so a fresh
  install wires them without this manual step.
