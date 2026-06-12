# AGENTS.md

A dedicated guide for coding agents working on `cypress-sentry-reporter`. See the format rationale at [agents.md](https://agents.md/).

## Project overview

- Library: Cypress plugin that sends failing tests/context to Sentry via the `setupNodeEvents` run events (not a Mocha reporter — see [ADR-0001](docs/decisions/0001-integrate-via-plugin-events-not-a-mocha-reporter.md)).
- Runtime: Node >= 18; ESM output.
- Package manager: Bun (see `engines.bun`).
- Entry points: `src/index.ts` → builds to `dist/index.js`; type declarations emit to `dist/index.d.ts`.
- Layout: `src/core.ts` (runner-neutral Sentry side), `src/plugin.ts` (Cypress event wiring), `src/map-results.ts` (Cypress results → `FailureContext`), `src/ci-providers/` + `src/actor-detectors/` + `src/codeowners/` (environment enrichment).

## Setup commands

- Install deps (also installs git hooks): `bun install` (set `CYPRESS_INSTALL_BINARY=0` to skip the Cypress binary download)
- Build library: `bun run build`
- Run unit tests: `bun run test run`
- Run the e2e smoke test (needs the Cypress binary and a build): `bun run test:e2e`
- Lint + format check (what CI runs): `bun run check`
- Auto-fix lint + format: `bun run check:fix`

## Dev workflow tips

- Source lives in `src/`; build emits to `dist/` via Bun bundler (`bun build`).
- Type declarations are emitted to `dist/` by `tsc --emitDeclarationOnly` and referenced by `package.json` `types` (`dist/index.d.ts`).
- Keep the build green before publishing; `prepublishOnly` runs the build automatically.
- The `e2e/` directory is a fixture Cypress project (one passing, one deliberately failing spec) consumed by `scripts/assert-e2e-smoke.ts`; it imports the **built** `dist/index.js`, so rebuild before running it.

## Code style and conventions

- TypeScript, ESM modules.
- Favor explicit types for public APIs and meaningful, descriptive names.
- Use early returns, shallow control flow, and avoid swallowing errors.
- Linting and formatting are enforced by [Biome](https://biomejs.dev) — run `bun run check` (or `bun run check:fix`). A pre-commit hook (lefthook) runs Biome on staged files. See [docs/decisions/0006-adopt-biome-for-lint-and-format.md](docs/decisions/0006-adopt-biome-for-lint-and-format.md).
- Keep formatting consistent with existing files (single quotes are preferred where practical).
- Avoid adding dependencies unless necessary; prefer small, focused utilities.

## Commit message conventions

- Strictly follow the conventions defined in [docs/COMMIT_CONVENTION.md](docs/COMMIT_CONVENTION.md).
- Use [Conventional Commits](https://www.conventionalcommits.org/) with a Gitmoji placed immediately before the description.

## Testing instructions

- Unit test runner: Vitest (a dev-only tool — the published plugin has no Vitest coupling). Tests live alongside the source as `src/**/*.test.ts` (and `scripts/**/*.test.ts`).
- Run the suite with `bun run test run`; collect coverage with `bun run test:coverage`.
- The e2e smoke test runs a real `cypress run` over the `e2e/` fixture with `dryRun: true` and asserts the logged envelope; CI runs it on every PR.
- Prefer unit tests alongside source, and fast, deterministic tests with clear assertions.

## Security considerations

- Do not commit secrets; Sentry DSN and related config should be passed via environment variables in consuming projects.
- Reporter code should handle missing or invalid configuration gracefully and never throw in a way that breaks the test runner.

## Sibling project (intentional drift)

[`vitest-sentry-reporter`](https://github.com/cadesalaberry/vitest-sentry-reporter)
does the same job for Vitest. The two repositories are **intentionally
unlinked**: no shared package, no submodule — shared logic (ci-providers,
actor-detectors, codeowners, dry-run transport) was copied and is allowed to
evolve independently. When fixing a bug in one of those modules, check whether
the sibling needs the same fix and mirror it manually.

## PR checklist (for agents)

- Lint + format clean: `bun run check`.
- Build succeeds: `bun run build`.
- Tests pass: `bun run test run`.
- Types are accurate and exported via `dist/index.d.ts`.
- Keep changes minimal; update docs if behavior changes.

## Release notes

- Releases are automated with release-please from Conventional Commits. Do not bump `version` in `package.json` or edit `CHANGELOG.md` by hand — release-please maintains both via a release PR.
- Merging the release PR tags `vX.Y.Z`, creates a GitHub release, and publishes to npm with provenance (`.github/workflows/release.yml`).
- The version bump is derived from commit types: `feat` → minor, `fix` → patch, `!`/`BREAKING CHANGE:` → major. Use the correct type so the bump is correct.
- See `docs/decisions/0005-automate-releases-with-release-please.md` for details and required repo setup (npm Trusted Publishing, PR-creation permission).
