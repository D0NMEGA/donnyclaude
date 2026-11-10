<purpose>
Disabled. `/donny-update` used to search a few default locations for a Donny source checkout and
reinstall over the live engine in `~/.claude/`. The first candidate was a stale directory, so a
run could redeploy old code over the working engine.

This workflow now installs nothing and changes nothing. It only prints the supported procedure.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="explain_and_stop">
Print the following message, then stop. Do not search for a source checkout, do not run
`install.mjs`, `npm`, `npx` or `git`, and do not write to `~/.claude/` or `~/.donny/`.

```
/donny-update is disabled.

Donny updates are deployed from the donnyclaude repository by copying the changed files
explicitly. In a checkout of that repository, review `git diff` and `git status` for the
files that changed, copy each one to its matching path under ~/.claude/ (engine files go
to ~/.claude/donny/), and diff the installed tree against the repository afterwards.
Never reinstall over the live engine: hand patches in ~/.claude/ would be reverted
without any signal.
```
</step>

</process>

<success_criteria>
- [ ] The message above is printed
- [ ] No source checkout is searched for and nothing is installed, copied or written
</success_criteria>
