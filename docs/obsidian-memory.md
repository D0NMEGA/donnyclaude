# Obsidian as persistent memory

DonnyClaude treats an [Obsidian](https://obsidian.md) vault as a durable, human-
readable memory layer that survives across sessions and `/clear`. The installer
offers to install Obsidian (via Homebrew on macOS) if it is not already present;
on other platforms, download it from https://obsidian.md/download.

This is optional. Nothing breaks without a vault - it is an upgrade to how Claude
remembers project decisions, lessons, and open questions between sessions.

## Why a vault

Plain markdown files in a folder, git-versioned, that both you and Claude read
and write continually. The value is not the app - it is the discipline:

- **Read first for context.** Start each session from a hub note that lists the
  active projects and practices, then open the specific project note before doing
  related work.
- **Write durable knowledge as you go** - a decision, a new practice, a fact, the
  outcome of a session, an open question. If it will matter next week, capture it.
- **Curated vs journal.** Keep a curated layer (projects, practices, references)
  with consistent frontmatter and no orphan notes, and an append-only session
  journal. Promote anything durable from the journal up into the curated layer -
  that promotion is how you fight write-only memory, the documented failure mode
  of agent memory systems (notes you never re-read).

## Suggested layout

```
vault/
  00 Hub.md            # map of content: who you are, active projects, practices
  Projects/            # one note per active project (curated)
  Practices/           # reusable how-to and conventions (curated)
  Reference/           # external resources, durable facts (curated)
  Sessions/            # append-only session journal
```

## Frontmatter convention

Put frontmatter on every curated note so it stays searchable and gradeable:

```yaml
---
type: project | practice | reference | session
status: active | archived
created: 2026-01-01
updated: 2026-01-01
tags: []
related: []
---
```

Link only where the connection is real and you would traverse it to answer a
future question. Avoid link-spam and mechanical similarity links - the failure
mode is hyperlinking everything to everything.
