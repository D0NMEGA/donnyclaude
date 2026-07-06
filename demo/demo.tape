# DonnyClaude demo - deterministic verification gate.
# Render with: vhs demo/demo.tape   (from the repo root; needs `npx donnyclaude`
# installed once so the engine exists at ~/.claude/donny). The tape copies the
# bundled fixture to a temp dir, so re-rendering never dirties the repo.

Output demo/demo.gif

Set FontSize 16
Set Width 960
Set Height 540
Set Padding 12
Set TypingSpeed 40ms

Type "# DonnyClaude: the model generates the work - the engine decides 'done'."
Enter
Sleep 1.5s

Type "alias donny='node ~/.claude/donny/bin/donny-tools.cjs'"
Enter
Type "rm -rf /tmp/donny-demo && cp -r demo/fixture /tmp/donny-demo && cd /tmp/donny-demo"
Enter
Sleep 800ms

Type "# Claude says phase 1 is finished. Is it?"
Enter
Sleep 1s
Type "donny verify phase-verified 01"
Enter
Sleep 2.5s

Type "# No. VERIFICATION.md on disk says failed (3 of 5 requirements open)."
Enter
Type "# The phase cannot ship - not because a model said so, but because the gate read the file."
Enter
Sleep 2s

Type "# ...the fixes land, the skeptical verifier re-runs and rewrites VERIFICATION.md:"
Enter
Type "cp passed-VERIFICATION.md .planning/phases/01-auth/01-VERIFICATION.md"
Enter
Sleep 800ms

Type "donny verify phase-verified 01"
Enter
Sleep 2.5s

Type "# status: passed, parsed from disk. Now it ships."
Enter
Type "# npx donnyclaude  ->  github.com/d0nmega/donnyclaude"
Enter
Sleep 3s
