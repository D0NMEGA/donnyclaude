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
- `/rust-review` -- Rust ownership, lifetimes, and safety review
- `/rust-build` -- Fix Rust build errors
- `/rust-test` -- TDD for Rust

### Context7 MCP -- Live Documentation
- `mcp__context7__resolve-library-id` -- Resolve library IDs before lookup
- `mcp__context7__query-docs` -- Fetch current, version-specific API docs
- **MUST use before writing ANY code that touches external crates**

## Execution Rules
1. Run all phases autonomously. Do NOT pause unless genuinely ambiguous.
2. Use GSD for every phase: plan -> execute -> verify -> next.
3. Use Context7 before writing ANY crate code. No exceptions.
4. TDD: write tests BEFORE implementation. Always.
5. Use rust-review on ALL code before marking a phase done.

## Project Architecture

### Rust
- **Edition:** 2021+
- **Build:** Cargo
- **Linting:** clippy (deny warnings)
- **Formatting:** rustfmt
- **Testing:** cargo test + cargo-llvm-cov for coverage

## Code Conventions

### Rust
- Use `thiserror` for error types, `anyhow` for application errors
- Prefer `&str` over `String` in function parameters
- No `unwrap()` in library code -- use `?` operator
- All public items documented with `///` doc comments
- Clippy with `#![deny(clippy::all)]`

## Constraints
- Rust edition 2021+
- No unsafe unless documented and justified
- All errors must be handled (no silent unwrap)
