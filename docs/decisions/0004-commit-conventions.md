---
title: Adopt Conventional Commits and Gitmoji
status: accepted
date: 2026-06-12
authors:
  - cadesalaberry
---

## Context

A consistent commit history is crucial for project maintainability, automated release generation, and developer collaboration. Without a strict convention, commit messages can become inconsistent, making it difficult to understand the history of changes, generate changelogs, or trigger automated workflows based on commit types.

We need a standardized way to format commit messages that is both machine-readable (for automation) and human-readable (for quick scanning).

## Decision

We will adopt **Conventional Commits v1.0.0-beta.4** combined with **Gitmoji**.

1.  **Conventional Commits**: Provides a structured format (`type(scope): description`) that is widely supported by tools for changelog generation and semantic versioning.
2.  **Gitmoji**: Adds a visual layer to commit messages, making it easier to scan the history and identify the nature of changes at a glance.

The required format is:
```
<type>(optional scope): <gitmoji> <description>
```

Example:
```
feat(plugin): ✨ add browser tags from before:run
```

We have documented the specific rules and the list of allowed Gitmojis in `docs/COMMIT_CONVENTION.md`.
All agents and contributors are expected to follow this convention.

## Consequences

**Positive:**
- **Automated Releases**: We can use tools like release-please to automatically determine the next version number and generate changelogs based on commit types (e.g., `feat` -> minor, `fix` -> patch, `BREAKING CHANGE` -> major).
- **Readability**: The history becomes easier to scan. Gitmojis provide instant visual cues about the commit's purpose.
- **Consistency**: All contributors (human and agents) will follow the same standard.

**Negative:**
- **Learning Curve**: Contributors need to learn the specific types and emojis.
- **Overhead**: Writing commit messages takes slightly more thought and time to look up the correct emoji.

## References

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Gitmoji](https://gitmoji.dev/)
- [Project Commit Convention](../COMMIT_CONVENTION.md)
