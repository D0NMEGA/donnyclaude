---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Go Security

> Go-specific rules; the shared rules live in common/coding-style.md and common/testing.md.

## Secret Management

```go
apiKey := os.Getenv("OPENAI_API_KEY")
if apiKey == "" {
    log.Fatal("OPENAI_API_KEY not configured")
}
```

## Security Scanning

- Use **gosec** for static security analysis:
  ```bash
  gosec ./...
  ```

## Context & Timeouts

Always use `context.Context` for timeout control:

```go
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()
```
