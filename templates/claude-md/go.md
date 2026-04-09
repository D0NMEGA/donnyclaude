# Project Agent Instructions

## Installed Tool Stack

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
- `/everything-claude-code:security-scan` -- OWASP Top 10 audit
- `/everything-claude-code:verification-loop` -- Comprehensive verification per phase
- `/go-review` -- Go idiomatic patterns and concurrency review
- `/go-build` -- Fix Go build errors
- `/go-test` -- TDD for Go with table-driven tests

### Context7 MCP -- Live Documentation
- `mcp__context7__resolve-library-id` -- Resolve library IDs before lookup
- `mcp__context7__query-docs` -- Fetch current, version-specific API docs
- **MUST use before writing ANY code that touches external packages**

## Execution Rules
1. Run all phases autonomously. Do NOT pause unless genuinely ambiguous.
2. Use GSD for every phase: plan -> execute -> verify -> next.
3. Use Context7 before writing ANY package code. No exceptions.
4. TDD: write tests BEFORE implementation. Always.
5. Use go-review on ALL code before marking a phase done.

## Project Architecture

### Go
- **Version:** Go 1.22+
- **Build:** Go modules
- **Linting:** golangci-lint
- **Testing:** go test + go tool cover

## Code Conventions

### Go
- Follow Effective Go and Go Code Review Comments
- Table-driven tests
- Error wrapping with `fmt.Errorf("context: %w", err)`
- No `panic` in library code
- Interfaces at the consumer, not the producer
- Short variable names in small scopes, descriptive in large ones

## Constraints
- Go 1.22+
- go vet and golangci-lint must pass
- All exported functions documented
