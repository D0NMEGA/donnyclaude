---
paths:
  - "**/*.py"
  - "**/*.pyi"
---
# Python Security

> Python-specific rules; the shared rules live in common/coding-style.md and common/testing.md.

## Secret Management

```python
import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.environ["OPENAI_API_KEY"]  # Raises KeyError if missing
```

## Security Scanning

- Use **bandit** for static security analysis:
  ```bash
  bandit -r src/
  ```
