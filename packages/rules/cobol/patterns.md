---
paths:
  - "**/*.cob"
  - "**/*.cbl"
  - "**/*.cpy"
  - "**/*.CBL"
  - "**/*.COB"
  - "**/*.CPY"
---
# COBOL Patterns

> This file extends [common/patterns.md](../common/patterns.md) with COBOL-specific content.

## Repository Pattern

Use subprogram `CALL` interfaces to encapsulate data access:

```cobol
CALL 'CUSTREAD' USING LS-CUSTOMER-ID
                      LS-CUSTOMER-RECORD
                      LS-RETURN-CODE
IF LS-RETURN-CODE NOT = ZERO
    PERFORM HANDLE-DB-ERROR
END-IF
```

Define the interface in a shared copybook:

```cobol
01 LS-CUSTOMER-ID      PIC 9(8).
01 LS-CUSTOMER-RECORD.
   05 LS-CUST-NAME     PIC X(40).
   05 LS-CUST-BALANCE  PIC S9(7)V99.
01 LS-RETURN-CODE      PIC 9(4).
```

## Structured Programming

- Use `PERFORM ... THRU` sparingly — prefer `PERFORM paragraph-name` without THRU
- Use `EVALUATE` (case/switch) instead of nested `IF` chains:

```cobol
EVALUATE WS-TRANSACTION-TYPE
    WHEN 'D'  PERFORM PROCESS-DEPOSIT
    WHEN 'W'  PERFORM PROCESS-WITHDRAWAL
    WHEN 'T'  PERFORM PROCESS-TRANSFER
    WHEN OTHER PERFORM HANDLE-INVALID-TYPE
END-EVALUATE
```

## Copybook Composition

Use copybooks as COBOL's module/import system:

```cobol
COPY CUSTOMER.
COPY CONSTANTS.
COPY ERROR-CODES.
```

- One record layout per copybook
- Use `REPLACING` for generic copybooks:

```cobol
COPY AUDIT-LOG REPLACING ==:PREFIX:== BY ==WS-ORDER==.
```

## Batch Processing Pattern

Standard mainframe batch structure:

```cobol
PROCEDURE DIVISION.
    PERFORM INITIALIZE-PROGRAM
    PERFORM PROCESS-RECORDS UNTIL WS-EOF = 'Y'
    PERFORM FINALIZE-PROGRAM
    STOP RUN.

PROCESS-RECORDS.
    READ INPUT-FILE INTO WS-INPUT-RECORD
        AT END SET WS-EOF TO TRUE
        NOT AT END PERFORM PROCESS-SINGLE-RECORD
    END-READ.
```

## CICS Online Pattern

For transaction processing:

```cobol
EXEC CICS RECEIVE MAP('CUSTMAP')
                  MAPSET('CUSTSET')
                  INTO(WS-CUSTOMER-MAP)
END-EXEC

PERFORM VALIDATE-INPUT
PERFORM UPDATE-DATABASE

EXEC CICS SEND MAP('CUSTMAP')
               MAPSET('CUSTSET')
               FROM(WS-CUSTOMER-MAP)
               ERASE
END-EXEC
```

## Embedded SQL (DB2)

```cobol
EXEC SQL
    SELECT CUST_NAME, CUST_BALANCE
    INTO :WS-CUST-NAME, :WS-CUST-BALANCE
    FROM CUSTOMER
    WHERE CUST_ID = :WS-CUSTOMER-ID
END-EXEC

EVALUATE SQLCODE
    WHEN 0     CONTINUE
    WHEN 100   PERFORM HANDLE-NOT-FOUND
    WHEN OTHER PERFORM HANDLE-SQL-ERROR
END-EVALUATE
```

## Interoperability

- Use `CALL` for subprogram composition (COBOL's equivalent of function calls)
- Use `JSON GENERATE` / `JSON PARSE` (COBOL 2014+) for modern API integration
- Use `XML GENERATE` / `XML PARSE` for enterprise service bus communication
