---
paths:
  - "**/*.cob"
  - "**/*.cbl"
  - "**/*.cpy"
  - "**/*.CBL"
  - "**/*.COB"
  - "**/*.CPY"
---
# COBOL Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with COBOL-specific content.

## Standards

- Use **COBOL-85** or later standard (prefer **COBOL 2002/2014** features when the compiler supports them)
- Use **free-format** source when the compiler supports it (GnuCOBOL `-free`)
- Fall back to **fixed-format** (columns 7-72) when targeting mainframe compilers (IBM Enterprise COBOL)
- Use uppercase for COBOL reserved words, lowercase or mixed-case for user-defined names

## Immutability

- COBOL is inherently imperative with mutable WORKING-STORAGE — the common immutability rule does not apply
- **OO override note**: Minimize mutation scope — keep data items as local as possible using `LOCAL-STORAGE SECTION`
- Use `78`-level constants for fixed values
- Avoid reusing data items for multiple unrelated purposes

## Naming Conventions

- Use **hyphenated-names** (COBOL standard): `WS-CUSTOMER-NAME`, `PROCESS-ORDER`
- Prefix WORKING-STORAGE items with `WS-`
- Prefix FILE-SECTION items with `FS-`
- Prefix LINKAGE-SECTION items with `LS-`
- Paragraph names should describe the action: `VALIDATE-INPUT`, `CALCULATE-TOTAL`

## File Organization

- One program per source file
- Use **copybooks** (`.cpy`) for shared data definitions and common paragraphs
- Organize copybooks by domain: `CUSTOMER.cpy`, `ORDER-RECORD.cpy`
- Keep paragraphs short and focused (< 50 lines)

## Formatting

- **Fixed format**: Code in columns 8-72, sequence numbers in 1-6, indicator in 7
- **Free format**: 4-space indentation, no column restrictions
- One statement per line
- Align `PIC` clauses vertically in data definitions:

```cobol
01 WS-CUSTOMER-RECORD.
   05 WS-CUSTOMER-ID      PIC 9(8).
   05 WS-CUSTOMER-NAME    PIC X(40).
   05 WS-CUSTOMER-BALANCE PIC S9(7)V99.
```

## Error Handling

- Always check `FILE STATUS` after every file I/O operation
- Use `DECLARATIVES` for file error handling procedures
- Check `RETURN-CODE` / `SQLCODE` after database operations
- Never silently continue after an error — log and handle explicitly

## Compiler

Use **GnuCOBOL** for open-source development:

```bash
cobc -x -free -Wall program.cob        # compile free-format to executable
cobc -x -Wall -std=ibm program.cob     # IBM compatibility mode
```
