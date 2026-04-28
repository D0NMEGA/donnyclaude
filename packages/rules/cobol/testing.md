---
paths:
  - "**/*.cob"
  - "**/*.cbl"
  - "**/*.cpy"
  - "**/*.CBL"
  - "**/*.COB"
  - "**/*.CPY"
---
# COBOL Testing

> This file extends [common/testing.md](../common/testing.md) with COBOL-specific content.

## Framework

Use **cobol-check** for unit testing COBOL programs:

```cobol
       TESTSUITE 'Customer validation tests'

       TESTCASE 'Valid customer ID is accepted'
           MOVE '12345678' TO WS-CUSTOMER-ID
           PERFORM VALIDATE-CUSTOMER-ID
           EXPECT WS-VALID-FLAG TO BE 'Y'

       TESTCASE 'Empty customer ID is rejected'
           MOVE SPACES TO WS-CUSTOMER-ID
           PERFORM VALIDATE-CUSTOMER-ID
           EXPECT WS-VALID-FLAG TO BE 'N'
```

## Runner

```bash
# Run all tests
cobol-check --programs src/*.cob

# Run tests for a specific program
cobol-check --programs src/customer.cob
```

## Alternative: Script-Based Testing

When cobol-check is unavailable, use shell-based integration tests:

```bash
#!/bin/bash
# Compile and run with test input
cobc -x -free program.cob
echo "TEST INPUT" | ./program > actual_output.txt
diff expected_output.txt actual_output.txt && echo "PASS" || echo "FAIL"
```

## Coverage

COBOL lacks native coverage tools in open-source. Track coverage through:
- Paragraph-level call tracing with `DISPLAY` or file logging
- GnuCOBOL `--debug` flag for runtime tracing
- Mainframe: IBM Debug Tool or Compuware Xpediter

## Mocking

- Use **copybook substitution** to swap data definitions for test doubles
- Use **stub programs** for `CALL` targets — compile test versions of called subprograms
- File I/O: redirect `ASSIGN` clauses to test data files

## Pitfalls

- Always initialize WORKING-STORAGE before tests — COBOL does not zero-initialize by default on all compilers
- Test both valid and boundary values for `PIC` fields (overflow, truncation)
- Test `COMP-3` (packed decimal) edge cases separately
