---
paths:
  - "**/*.cob"
  - "**/*.cbl"
  - "**/*.cpy"
  - "**/*.CBL"
  - "**/*.COB"
  - "**/*.CPY"
---
# COBOL Security

> This file extends [common/security.md](../common/security.md) with COBOL-specific content.

## Input Validation

- Validate all `ACCEPT` and `CICS RECEIVE` data before processing
- Check numeric fields with `IS NUMERIC` before arithmetic:

```cobol
IF WS-AMOUNT IS NUMERIC
    COMPUTE WS-TOTAL = WS-TOTAL + WS-AMOUNT
ELSE
    MOVE 'Invalid amount' TO WS-ERROR-MSG
    PERFORM HANDLE-VALIDATION-ERROR
END-IF
```

- Validate field lengths — COBOL truncates silently on `MOVE` overflow
- Check for embedded nulls and low-values in string fields

## SQL Injection Prevention

Always use host variables — never concatenate SQL strings:

```cobol
*> CORRECT: parameterized
EXEC SQL
    SELECT * FROM CUSTOMER
    WHERE CUST_ID = :WS-CUSTOMER-ID
END-EXEC

*> WRONG: string concatenation (never do this)
*> STRING 'SELECT * FROM CUSTOMER WHERE CUST_ID = '
*>        WS-CUSTOMER-ID INTO WS-SQL-STMT
```

## Buffer Overflow

- COBOL `PIC` definitions enforce field sizes — but `MOVE` silently truncates
- Always define receiving fields large enough for the source data
- Use `FUNCTION LENGTH` to validate before `MOVE` or `STRING`:

```cobol
IF FUNCTION LENGTH(WS-INPUT-DATA) > 40
    MOVE 'Input too long' TO WS-ERROR-MSG
    PERFORM HANDLE-VALIDATION-ERROR
END-IF
```

## Secret Management

- Never hardcode passwords, API keys, or connection strings in COBOL source
- Use JCL `SYSIN` parameters, environment variables, or secure credential stores
- For GnuCOBOL: read secrets from environment with `ACCEPT WS-SECRET FROM ENVIRONMENT`

```cobol
ACCEPT WS-DB-PASSWORD FROM ENVIRONMENT 'DB_PASSWORD'
IF WS-DB-PASSWORD = SPACES
    DISPLAY 'DB_PASSWORD environment variable not set'
    STOP RUN
END-IF
```

## File Security

- Always specify `FILE STATUS` on every file definition
- Check status codes after every I/O operation — never assume success
- Use `ORGANIZATION IS SEQUENTIAL` or `INDEXED` explicitly — never rely on defaults
- Validate file paths when using dynamic `ASSIGN`

```cobol
SELECT CUSTOMER-FILE
    ASSIGN TO WS-CUSTOMER-PATH
    ORGANIZATION IS INDEXED
    ACCESS MODE IS DYNAMIC
    RECORD KEY IS FS-CUSTOMER-ID
    FILE STATUS IS WS-FILE-STATUS.
```

## CICS Security

- Use CICS `EXEC CICS ASSIGN USERID` to verify authorization
- Check transaction security before processing sensitive operations
- Use `EXEC CICS ASKTIME` / `FORMATTIME` for audit timestamps
- Never expose internal error details in user-facing CICS maps

## Audit Trail

- Log all data modifications with timestamp, user ID, and before/after values
- Use a standard audit copybook across all programs:

```cobol
COPY AUDIT-LOG.
MOVE FUNCTION CURRENT-DATE TO WS-AUDIT-TIMESTAMP
MOVE WS-USER-ID            TO WS-AUDIT-USER
MOVE 'UPDATE'              TO WS-AUDIT-ACTION
PERFORM WRITE-AUDIT-RECORD
```
