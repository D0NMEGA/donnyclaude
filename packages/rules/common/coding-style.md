# Coding style

- Write the minimum code that solves the problem in front of us now. Copy twice before you
  abstract, and hardcode a value until there is a real reason to configure it.
- Keep the diff as small as the task allows. Leave unrelated code and formatting alone and match
  the surrounding style. A line that is there only because you were nearby gets reverted.
- Prefer returning a new value over mutating a shared one where the language makes that natural.
- Handle errors explicitly at system boundaries and validate external input there (user input,
  API responses, file content). Skip handling for errors that cannot occur.
- Keep files focused; split one when it passes a few hundred lines or mixes concerns.
- Stop and say so when a fix starts cascading across files, or when you are abstracting from a
  single example.

Adapted from Andrej Karpathy's CLAUDE.md field notes; rationale in the vault note
`Reference/Karpathy-CLAUDE-md-Field-Notes`.
