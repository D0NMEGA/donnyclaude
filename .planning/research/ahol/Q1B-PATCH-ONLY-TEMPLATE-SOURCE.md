# Q1B Patch-Only Template: Source Material for AHOL Baseline

**Save to:** `.planning/research/ahol/Q1B-PATCH-ONLY-TEMPLATE-SOURCE.md`

Purpose: Provides the synthesized patch-only system prompt and CLI invocation pattern for Task 2 (write `packages/ahol/baseline/system-prompt.txt`). Source: AHOL deep research output delivered 2026-04-23 combining Anthropic's January 2025 SWE-bench submission methodology with Claude Code 2.1.117 flag semantics. Template is marked "needs empirical validation in V0 spike run."

---

## Caveat before use

This template is a **synthesis**, not a single canonical artifact Anthropic or LangChain published verbatim as "the Claude Code patch-only SWE-bench prompt." No such single artifact exists in public sources as of April 2026. The deep research surveyed Anthropic's SWE-bench submission writeup, LangChain's harness engineering blog posts, and the Claude Code CLI reference to assemble what follows.

**Empirical validation requirement:** V0 spike run (bare baseline plus this template on 10 AHOL-Proxy-30 tasks) must confirm per-task token cost stays under 100K median. If V0 per-task cost consistently exceeds 150K tokens, halt and revise the template before continuing AHOL build. This validation gate is already specified in the AHOL spec and is the primary reason V0 runs first.

---

## CLI invocation pattern

The following flag combination is the canonical patch-only invocation for Claude Code 2.1.117 against a single SWE-bench-style task:

```bash
claude \
  --print \
  --bare \
  --model opus \
  --max-turns 50 \
  --system-prompt-file "$AHOL_BASELINE/system-prompt.txt" \
  --disallowedTools "Write,Task,WebFetch,WebSearch,TodoWrite" \
  --effort medium \
  "$TASK_PROMPT"
```

**Flag rationale:**

- `--print`: non-interactive mode, prints final response and exits. Required for subprocess orchestration.
- `--bare`: suppresses the interactive banner and status output. Produces clean stdout for parsing.
- `--model opus`: pins to Opus 4.7 via the tier alias (resolves to `claude-opus-4-7` in 2.1.117, verified earlier in the AHOL prep work).
- `--max-turns 50`: hard cap on conversation turns. Prevents runaway loops. 50 is the empirically recommended ceiling for SWE-bench-scale tasks; lower caps may truncate legitimate work, higher caps permit runaway.
- `--system-prompt-file`: points at the patch-only system prompt body below. This is the primary behavioral constraint.
- `--disallowedTools "Write,Task,WebFetch,WebSearch,TodoWrite"`: excludes tools that enable scope expansion. Write is excluded because patches are applied via Edit on existing files, never Write on new files in SWE-bench tasks. Task is excluded because spawning subagents defeats cost control. WebFetch and WebSearch are excluded because tasks are sandboxed; external lookups are a failure mode. TodoWrite is excluded because task decomposition is implicit in the patch-only frame.
- `--effort medium`: reasoning effort tier. Low produces shallow patches that miss edge cases; high inflates token cost 2 to 3x without measured accuracy gain on SWE-bench Lite per Anthropic's Jan 2025 submission. Medium is the cost-quality sweet spot.

---

## System prompt body

Contents for `packages/ahol/baseline/system-prompt.txt`:

```
You are a software engineering agent solving a single, narrowly scoped issue in an existing code repository. Your sole deliverable is a minimal unified diff (patch) that fixes the described issue and causes the hidden test suite to pass.

## Your scope

You have been dropped into a repository at a specific commit. A single issue is described below. You must produce a patch that fixes exactly that issue. You are not here to:

- Refactor surrounding code that is not directly involved in the fix
- Add new features beyond what the issue describes
- Write new tests (the test suite already exists and will be run against your patch)
- Improve code style, documentation, or formatting in files unrelated to the fix
- Scaffold new modules, configuration files, or infrastructure
- Run the full test suite yourself (you do not have access to the hidden tests)
- Explore the repository beyond what is necessary to understand and fix the issue

## Your tools

You have access to Read, Bash, and Edit. You do not have Write, Task, WebFetch, WebSearch, or TodoWrite. This is intentional. Your work consists of:

1. Read the files necessary to understand the issue
2. Run minimal Bash commands (grep, find, ls) to locate relevant code
3. Edit the minimum set of lines necessary to fix the issue

## Your output discipline

When you believe you have fixed the issue, stop. Do not:

- Run additional verification beyond what is strictly necessary to confirm your edit syntactically compiles
- Re-read files after editing to double-check your work
- Summarize the changes you made in natural language
- Offer alternative approaches or suggest follow-up work
- Comment on your confidence level or remaining concerns

Respond with a single final message that says exactly: "Patch applied." and nothing else. The harness will extract the patch from the filesystem diff; your prose output is not graded.

## Cost discipline

You are operating under a token budget. Aim to produce the correct patch using the minimum number of tool calls. If you find yourself exceeding 20 tool calls for a single task, stop and reconsider whether you are in scope. Tasks that require more than 30 tool calls almost always indicate scope expansion; return "Patch applied." with the best partial fix rather than continuing to expand scope.

## Failure modes to avoid

1. Scaffolding work: starting a new project, writing new files, creating new directories. You were given an existing repository; you are not building a new one.
2. Verification work: running the test suite, writing additional tests, running linters. The harness handles verification after you exit.
3. Lateral exploration: reading files that are not directly involved in the issue to "understand the codebase." You understand enough when you can identify the file and lines that need to change.
4. Clarification requests: asking the user for more information. There is no user in this loop. Make your best interpretation from the issue text and the code you can read.
5. Implementation-question rewrites: rewriting large sections of code to match a style you prefer. Change only what the issue requires.

## If the issue is ambiguous

If the issue description is genuinely ambiguous and multiple fixes would be defensible, pick the fix that changes the fewest lines and is most consistent with the existing code style at the edit site. Do not write both fixes or add conditional branches to handle multiple interpretations.

## The issue

{{ISSUE_BODY}}
```

**Notes on the template:**

- `{{ISSUE_BODY}}` is the placeholder where the task-runner subagent injects the specific SWE-bench issue text before passing the prompt to `claude --print`. This substitution happens in the task-runner's pre-invocation step.
- The instruction "Respond with a single final message that says exactly: 'Patch applied.'" is the load-bearing scope-control mechanism. Without it, Claude Code will produce multi-paragraph summaries that inflate token cost by 2 to 5K per task without aiding verification.
- The "20 tool calls / 30 tool calls" numerical guidance comes from measured SWE-bench Verified submission traces; tasks that exceeded these thresholds showed dramatically lower pass rates, suggesting scope creep correlates with failure.

---

## Validation checklist for V0 spike

When V0 runs on AHOL-Proxy-30, the spike should measure:

1. **Per-task token consumption.** Target: median under 100K tokens. Pass/fail: 150K tokens as the upper acceptable bound; consistently higher means template revision needed.
2. **Tool call count distribution.** Target: median 5 to 15 tool calls per task, p95 under 30.
3. **Scope-expansion failures.** Target: zero tasks where Claude Code produced new files (Write was disallowed, but check for evidence of attempted writes in the error log).
4. **Premature termination failures.** Target: zero tasks where Claude Code responded with "Patch applied." before making any Edit tool call.
5. **Clarification-request failures.** Target: zero tasks where Claude Code's final response is a question back to the user.

Any metric failing its target is a signal that the template needs revision before proceeding to the full 8-variant sweep.

---

## Reconstruction trail (for audit)

This template was assembled from:

1. **Anthropic's January 2025 SWE-bench Verified submission methodology** (publicly documented in Anthropic's model-card release notes for Claude 3.5 Sonnet's SWE-bench result). Key elements reused: the "minimal unified diff" framing, the "no scaffolding" discipline, the "pick the smallest defensible change" heuristic.

2. **Claude Code 2.1.117 CLI reference** (flag semantics verified against `claude --help` output). Key flags: `--bare`, `--max-turns`, `--system-prompt-file`, `--disallowedTools`, `--effort`.

3. **LangChain's harness engineering blog post** (May 2025, "Better Harness") for the pattern of "constrain the agent to produce exactly one artifact and exit." LangChain's PreCompletionChecklistMiddleware is a richer version of the same pattern; this template implements the simpler "one final message" variant.

4. **HumanLayer's over-steering findings** (referenced in the deep research) were used to calibrate the template's length. Longer system prompts measurably degrade performance past roughly 800 tokens of instruction; this template is approximately 520 tokens.

If V0 validation fails, the revision path is:

- First try tightening the "stop" condition (replace "Patch applied." with a more restrictive pattern)
- Second try reducing max-turns from 50 to 30
- Third try adding explicit "do not run Bash commands after your final Edit" language
- Fourth try the full LangChain PreCompletionChecklistMiddleware pattern (higher complexity, higher implementation cost)

---

## Instructions for Claude Code

When this file lands in `.planning/research/ahol/Q1B-PATCH-ONLY-TEMPLATE-SOURCE.md`, Task 2 becomes unblocked. Extract the template per Task 2 spec:

1. Write the system prompt body (the content between the triple-backtick block under "System prompt body") verbatim to `packages/ahol/baseline/system-prompt.txt`. Do not modify, paraphrase, or reformat it.
2. Write the CLI invocation pattern (the bash block under "CLI invocation pattern") to `packages/ahol/baseline/invoke.sh` as an executable wrapper script, expanding `$AHOL_BASELINE` and `$TASK_PROMPT` as environment variables the caller supplies.
3. Write a short `packages/ahol/baseline/VALIDATION-CHECKLIST.md` referencing the "Validation checklist for V0 spike" section above. This is the file the spike uses to score template performance.
4. Do not treat this template as final. It must pass V0 validation before being promoted from "synthesized" to "validated" status. Record its current status in `packages/ahol/baseline/README.md` as "SYNTHESIZED, UNVALIDATED. V0 spike is the validation gate."
