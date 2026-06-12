# Architectural Decision Records (ADR)

This directory contains Architectural Decision Records using MADR (Markdown Architectural Decision Records).

- Format: MADR. See the docs at [adr.github.io/madr](https://adr.github.io/madr/) and the repository at [github.com/adr/madr](https://github.com/adr/madr).
- Template: `adr-template.md`
- Each ADR carries its metadata (`title`, `status`, `date`, `authors`) in YAML front matter, followed by `## Context`, `## Decision`, and `## Consequences` sections.

## Index

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [0000](0000-use-markdown-architectural-decision-records.md) | Use Markdown Architectural Decision Records (MADR) | accepted | 2026-06-12 |
| [0001](0001-integrate-via-plugin-events-not-a-mocha-reporter.md) | Integrate via Cypress plugin events instead of a Mocha reporter | accepted | 2026-06-12 |
| [0002](0002-adopt-bun-as-package-manager.md) | Adopt Bun as the package manager and runtime | accepted | 2026-06-12 |
| [0003](0003-add-dry-run-transport.md) | Add dry-run transport to log Sentry envelopes instead of sending | accepted | 2026-06-12 |
| [0004](0004-commit-conventions.md) | Adopt Conventional Commits and Gitmoji | accepted | 2026-06-12 |
| [0005](0005-automate-releases-with-release-please.md) | Automate releases with release-please and Conventional Commits | accepted | 2026-06-12 |
| [0006](0006-adopt-biome-for-lint-and-format.md) | Adopt Biome for linting and formatting | accepted | 2026-06-12 |
| [0007](0007-resolve-codeowners-into-sentry-tags.md) | Resolve CODEOWNERS into Sentry tags | accepted | 2026-06-12 |

ADRs are numbered sequentially in the chronological order in which they were decided.
Several of these decisions were ported from the sibling
[`vitest-sentry-reporter`](https://github.com/cadesalaberry/vitest-sentry-reporter)
repository and re-adopted here; the two repositories are intentionally unlinked
(see `CONTRIBUTING.md`).

## How to create a new ADR

1. Choose the next zero-padded number (e.g., `0008`).
2. Copy the template:

```
cp adr-template.md 0008-short-title.md
```

3. Fill in the front matter (`title`, `status`, `date`, `authors`) and the `## Context` / `## Decision` / `## Consequences` sections.
4. Add a row to the [Index](#index) above.
5. Commit the ADR following the project [commit convention](../COMMIT_CONVENTION.md), e.g. `docs(adr): 📝 add ADR for X`.

## Front matter

```yaml
---
title: Short imperative title
status: proposed
date: YYYY-MM-DD
authors:
  - your-github-handle
---
```

## Naming

- File name: `NNNN-short-title.md` where `NNNN` is the zero-padded sequence number.
- Title: Use a short imperative phrase.

## Status values

- `proposed`: Under discussion
- `accepted`: Agreed and to be implemented (or already implemented)
- `rejected`: Considered but not adopted
- `deprecated`: No longer recommended for new work
- `superseded`: Replaced by another ADR (link the successor)
