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
- `/superpowers:test-driven-development` -- BEFORE writing implementation code
- `/superpowers:verification-before-completion` -- BEFORE claiming any phase is done
- `/superpowers:systematic-debugging` -- ON any bug or unexpected result
- `/superpowers:dispatching-parallel-agents` -- WHEN 2+ independent tasks exist
- `/superpowers:requesting-code-review` -- AFTER completing major features

### Everything Claude Code (ECC) -- Review & Quality
- `/everything-claude-code:plan` -- Generate implementation blueprints
- `/everything-claude-code:tdd` -- Test-driven development enforcement
- `/everything-claude-code:code-review` -- Code review via reviewer agent
- `/everything-claude-code:python-review` -- Python-specific review
- `/everything-claude-code:security-scan` -- OWASP Top 10 audit
- `/everything-claude-code:verification-loop` -- Comprehensive verification per phase
- `/everything-claude-code:python-testing` -- pytest strategies
- `/everything-claude-code:python-patterns` -- PEP 8 and Pythonic patterns

### Context7 MCP -- Live Documentation
- `mcp__context7__resolve-library-id` -- Resolve library IDs before lookup
- `mcp__context7__query-docs` -- Fetch current, version-specific API docs
- **MUST use before writing ANY code that touches external libraries**

## Tool Integration Protocol

**BEFORE planning any phase:**
1. Superpowers brainstorming for design decisions
2. Context7 for every library the phase touches
3. ECC plan for implementation strategy

**BEFORE executing any phase:**
1. ECC tdd -- write tests FIRST (red-green-refactor)
2. Context7 for exact API signatures

**DURING execution:**
1. Context7 before ANY library API call
2. ECC python-review after writing code

**AFTER each phase:**
1. Superpowers verification-before-completion
2. ECC verification-loop
3. GSD verify-work

## Execution Rules
1. Run all phases autonomously. Do NOT pause unless genuinely ambiguous.
2. Use GSD for every phase: plan -> execute -> verify -> next.
3. Use Context7 before writing ANY library code. No exceptions.
4. TDD: write tests BEFORE implementation. Always.
5. Use python-review on ALL code before marking a phase done.

## Project Architecture

### Backend
- **Stack:** Python + FastAPI + Pydantic
- **Database:** PostgreSQL via asyncpg (or SQLite for dev)
- **Testing:** pytest + pytest-asyncio
- **Linting:** ruff
- **Type checking:** mypy or pyright

## Code Conventions

### Python
- FastAPI + Pydantic models for all request/response
- Async by default -- use asyncpg, not sync Session
- pytest for testing, ruff for linting
- Type hints on all public functions
- No bare except clauses -- always specify exception types

## Deployment & CI/CD

<!-- Fill in: VPS, Docker, Vercel, etc. -->

## Constraints
- Python 3.12+
- No global mutable state
- All secrets via environment variables
