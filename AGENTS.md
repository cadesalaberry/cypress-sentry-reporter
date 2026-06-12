# AGENTS.md

A dedicated guide for coding agents working on `cypress-sentry-reporter`. See the format rationale at [agents.md](https://agents.md/).

## Project overview

- Library: Cypress plugin (via `setupNodeEvents` run events) that sends failing e2e/component tests and context to Sentry.
- Runtime: Node >= 18; ESM output.
- Package manager: Bun (see `engines.bun`).
- Entry points: `src/index.ts` → builds to `dist/index.js`; type declarations emit to `dist/index.d.ts`.
- Sibling project: `vitest-sentry-reporter` shares the tag shape and conventions but **no code** — fixes to `src/ci-providers/` or `src/actor-detectors/` must be mirrored manually (see `CONTRIBUTING.md`).

## Setup commands

- Install deps (also installs git hooks): `bun install`
- Build library: `bun run build`
- Run tests: `bun run test run`
- Run the Cypress dry-run smoke test (needs a build first): `bun run test:e2e`
- Lint + format check (what CI runs): `bun run check`
- Auto-fix lint + format: `bun run check:fix`

## Dev workflow tips

- Source lives in `src/`; build emits to `dist/` via Bun bundler (`bun build`).
- Architecture: `src/plugin.ts` registers Cypress run events → `src/map-results.ts` maps results payloads to `FailureContext` → `src/core.ts` owns the Sentry lifecycle (lazy init, dedup, cap, flush). `src/types.ts` defines minimal structural types for the Cypress payloads on purpose — do not add a compile-time dependency on Cypress's global types.
- Type declarations are emitted to `dist/` by `tsc --emitDeclarationOnly` and referenced by `package.json` `types` (`dist/index.d.ts`).
- Keep the build green before publishing; `prepublishOnly` runs the build automatically.
- The `e2e/` directory is a smoke-test fixture project, not part of the published package.

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

- Test runner: Vitest (a tooling choice only — it does not link this repo to the sibling). Tests live alongside the source as `src/**/*.test.ts` (and `scripts/**/*.test.ts`).
- Run the suite with `bun run test run`; collect coverage with `bun run test:coverage`.
- The e2e smoke test (`scripts/e2e-smoke.ts`) runs the `e2e/` fixture with real Cypress in dry-run mode and asserts on the logged envelope; CI runs it on every PR.
- Prefer unit tests alongside source, and fast, deterministic tests with clear assertions.
- You can invoke Vitest directly if needed: `bun run test run --reporter=dot`

## Security considerations

- Do not commit secrets; Sentry DSN and related config should be passed via environment variables in consuming projects.
- Reporter code should handle missing or invalid configuration gracefully and never throw in a way that breaks the test runner.

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
