---
title: Resolve CODEOWNERS into Sentry tags
status: accepted
date: 2026-06-12
authors:
  - cadesalaberry
---

## Context

- Ownership and triage is a core value proposition of this reporter ("routes to
  the right team"), yet attaching the owning team to a failure would otherwise
  require every consumer to hand-roll a path→owner mapping inside `getTags`.
- A correct implementation is non-trivial: it needs gitignore-style glob
  matching with CODEOWNERS "last match wins" precedence, plus reliable discovery
  of the repository root across CI systems (where the checkout path varies).
- We want this to be first-class but optional, without bloating the dependency
  tree or changing default behavior.

## Decision

- Add an opt-in `codeowners` option (`boolean | { enabled?; root? }`),
  disabled by default. When enabled, each failing spec file is matched against
  the repository `CODEOWNERS` and tagged with `code_owners` (all matching
  owners, comma-joined) and `code_owner` (the primary owner); the raw owner
  array is also attached as a `code_owners` extra.
- Expose the checkout root from the CI provider layer: the `CIProvider`
  interface has `rootPath(env)`, implemented per provider (`GITHUB_WORKSPACE`,
  `CI_PROJECT_DIR`, `CIRCLE_WORKING_DIRECTORY`,
  `BUILDKITE_BUILD_CHECKOUT_PATH`, Jenkins `WORKSPACE`). The `repoRoot()`
  helper expands a leading `~`, verifies the path exists, and falls back to
  `process.cwd()`.
- **Vendor a small CODEOWNERS parser** (`src/codeowners/`) that depends only on
  [`ignore`](https://www.npmjs.com/package/ignore) for glob matching. We own the
  ~40 lines of line-parsing and last-match-wins precedence; `ignore` handles the
  hard glob semantics.
- Cypress reports spec paths relative to the project root, so the resolver
  accepts both absolute paths (relativized against the root) and already
  relative paths; the reporter prefers the spec's absolute path when Cypress
  provides one.
- Both tags are user-overridable: `code_owners`/`code_owner` are part of
  `MANUALLY_OVERRIDABLE_TAGS`, so values from `tags`/`getTags` win over the
  resolved owners.

## Dependency security analysis

The driving reason for vendoring rather than depending on an off-the-shelf
CODEOWNERS library:

- **`codeowners-utils@1.0.2`** — last published 2020-04-29 (unmaintained);
  CommonJS (no `type` field) despite being commonly described as ESM. Runtime
  deps: `cross-spawn@^7.0.2`, `find-up@^4`, `ignore@^5`, `locate-path@^5`.
  `cross-spawn` **spawns a child process at runtime** — unwanted attack surface
  for a test reporter — and its `^7.0.2` floor includes versions affected by
  **CVE-2024-21538** (ReDoS). Not practically exploitable here (inputs are local
  file paths), but avoidable.
- **`codeowners@5.1.1`** — last published 2021; CommonJS (needs `createRequire`
  interop); ~9 runtime deps including `commander`, three `lodash.*` packages,
  `true-case-path`, and a very old `ignore@^3.3.10`. Larger, older, unmaintained
  surface.
- **`ignore@^7` (chosen)** — MIT, **zero runtime dependencies**, actively
  maintained, and the same gitignore-glob engine the libraries above use
  internally. `bun pm ls` confirms it adds no transitive dependencies.

Conclusion: vendoring the parser over `ignore` minimizes supply-chain risk
versus pulling in an unmaintained transitive tree, at the cost of ~40
maintained, unit-tested lines.

## Consequences

- Zero-effort, accurate team routing in Sentry for repositories that adopt the
  option; behavior is unchanged for everyone else (off by default).
- One well-scoped, zero-dependency runtime dependency (`ignore`).
- Per-CI checkout-root handling lives in the provider layer and is reused by
  any future feature needing the repository root.
- We own a small parser we must keep correct — covered by unit tests (parsing,
  precedence, default owner, missing file, out-of-root, and tag
  emission/override).

## Alternatives

- **Leave it to user `getTags`**: rejected — every consumer would reimplement
  glob matching and precedence, usually incorrectly.
- **Depend on `codeowners` / `codeowners-utils`**: rejected — see the security
  analysis (unmaintained, CommonJS, heavier/risky transitive trees).
- **Enable by default**: rejected — avoids surprise tags and does not impose the
  behavior on repositories without a CODEOWNERS file.

## Tests

- `src/codeowners/index.test.ts` covers `parseCodeowners`, `matchOwners`
  precedence, and `resolveCodeOwners` (match, default owner, missing file,
  out-of-root, no path).
- Per-provider tests assert `rootPath` and `envSnapshot` keys; `repoRoot`
  fallback and `~`-expansion are covered in `src/utils.test.ts`; core tests
  assert tag emission and `getTags` override.

## References

- This feature and its analysis were ported from the sibling
  `vitest-sentry-reporter` repository (its ADR-0008); the two codebases are
  intentionally unlinked, see `CONTRIBUTING.md`.
