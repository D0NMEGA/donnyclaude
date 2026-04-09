# Project Agent Instructions

## Installed Tool Stack

You have the following tools installed. Use them proactively -- they are requirements, not suggestions.

### GSD (Get Shit Done) -- Workflow Engine
- `/gsd:new-project` -- Initialize project structure
- `/gsd:plan-phase N` -- Plan EVERY phase before execution
- `/gsd:execute-phase N` -- Execute with fresh subagent contexts
- `/gsd:verify-work` -- Verify after EVERY phase completion
- `/gsd:progress` -- Check status between phases
- `/gsd:quick "task"` -- Ad-hoc task with GSD guarantees

### Superpowers -- Development Methodology
- `/superpowers:brainstorming` -- BEFORE any creative or design work
- `/superpowers:writing-plans` -- BEFORE any multi-step implementation
- `/superpowers:test-driven-development` -- BEFORE writing implementation code (red-green-refactor)
- `/superpowers:verification-before-completion` -- BEFORE claiming any phase is done
- `/superpowers:systematic-debugging` -- ON any bug or unexpected result (4-phase root cause)
- `/superpowers:dispatching-parallel-agents` -- WHEN 2+ independent tasks exist
- `/superpowers:requesting-code-review` -- AFTER completing major features

### Everything Claude Code (ECC) -- Review & Quality
- `/everything-claude-code:plan` -- Generate implementation blueprints
- `/everything-claude-code:tdd` -- Test-driven development enforcement
- `/everything-claude-code:code-review` -- Code review via reviewer agent
- `/everything-claude-code:security-scan` -- OWASP Top 10 audit
- `/everything-claude-code:verification-loop` -- Comprehensive verification per phase

### Context7 MCP -- Live Documentation
- `mcp__context7__resolve-library-id` -- Resolve library IDs before lookup
- `mcp__context7__query-docs` -- Fetch current, version-specific API docs
- **MUST use before writing ANY code that touches external libraries**

### Playwright MCP -- Browser Automation
- `mcp__playwright__browser_navigate` -- Navigate to URLs
- `mcp__playwright__browser_snapshot` -- Capture page state
- Use for visual QA, data discovery, verifying rendered output

## Tool Integration Protocol

**BEFORE planning any phase:**
1. Superpowers brainstorming for design decisions
2. Context7 resolve-library-id + query-docs for every library the phase touches
3. ECC plan for implementation strategy

**BEFORE executing any phase:**
1. ECC tdd -- write tests FIRST (red-green-refactor)
2. Context7 query-docs for exact API signatures

**DURING execution:**
1. Context7 before ANY library API call
2. ECC code-review after writing code

**AFTER each phase:**
1. Superpowers verification-before-completion
2. ECC verification-loop
3. GSD verify-work

## Execution Rules
1. Run all phases back-to-back autonomously. Do NOT pause to ask unless genuinely ambiguous.
2. Use GSD for every phase: plan -> execute -> verify -> next.
3. Use Context7 before writing ANY library code. No exceptions.
4. TDD: write tests BEFORE implementation. Always.
5. Use code review on ALL code before marking a phase done.

## Project Architecture

<!-- Fill in your project's stack, database, deployment target -->

## Code Conventions

<!-- Fill in your language-specific conventions -->

## Deployment & CI/CD

<!-- Fill in your deployment setup -->

## Constraints

<!-- Fill in project constraints (e.g., "No TypeScript", "Python 3.12+") -->
