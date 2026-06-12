# Contributing to cypress-sentry-reporter

Thanks for taking the time to contribute! 🎉 This project is a small, focused
Cypress plugin that ships end-to-end test failures and context to Sentry.
Contributions of all kinds are welcome — bug reports, documentation, tests, and
code.

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- 🐛 **Report a bug** — open a [bug report](https://github.com/cadesalaberry/cypress-sentry-reporter/issues/new/choose).
- 💡 **Request a feature** — open a [feature request](https://github.com/cadesalaberry/cypress-sentry-reporter/issues/new/choose).
- 📝 **Improve the docs** — fix typos, clarify usage, add examples.
- 🧑‍💻 **Send code** — pick up an issue (look for the
  [`good first issue`](https://github.com/cadesalaberry/cypress-sentry-reporter/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
  or `help wanted` labels) and open a pull request.

If you plan a larger change, please open an issue first so we can agree on the
approach before you invest time.

## Relationship to vitest-sentry-reporter

This repository is a deliberate sibling of
[`vitest-sentry-reporter`](https://github.com/cadesalaberry/vitest-sentry-reporter):
same tag shape, same conventions, no code dependency in either direction. The
CI-provider and actor-detection modules were copied (not shared) so each repo
can evolve independently. The flip side: fixes to `src/ci-providers/` or
`src/actor-detectors/` here are **not** picked up automatically by the sibling —
if your fix applies there too, please mirror it (or open an issue there
pointing at your PR).

## Development setup

This repo uses [Bun](https://bun.sh) as its package manager and runtime
(see [ADR-0002](docs/decisions/0002-adopt-bun-as-package-manager.md)). The
required versions are pinned in `package.json` (`engines` / `packageManager`)
and `.nvmrc`.

```bash
# 1. Fork & clone, then install dependencies (also installs git hooks)
bun install

# 2. Build the library (emits dist/ + type declarations)
bun run build

# 3. Run the test suite
bun run test run

# 4. Run with coverage (as CI does)
bun run test:coverage
```

To exercise the reporter against a real Cypress run (a fixture project with a
deliberately failing spec, reported in dry-run mode):

```bash
bun run build && bun run test:e2e
```

## Code style

- TypeScript, ESM only. Favor explicit types for public APIs and descriptive names.
- Use early returns, shallow control flow, and never silently swallow errors.
- See [`AGENTS.md`](AGENTS.md) for the full style guide.

Linting and formatting are handled by [Biome](https://biomejs.dev)
(see [ADR-0006](docs/decisions/0006-adopt-biome-for-lint-and-format.md)):

```bash
bun run check        # lint + format check (what CI runs)
bun run check:fix    # auto-fix lint + format issues
bun run format       # format only
```

A pre-commit hook (via [lefthook](https://lefthook.dev)) runs Biome on staged
files automatically. Hooks are installed on `bun install`; if needed, install
them manually with `bunx lefthook install`.

## Commit messages & PR titles

We follow [Conventional Commits](https://www.conventionalcommits.org/) with a
Gitmoji, e.g. `feat(plugin): ✨ add support for X`. The full convention and the
Gitmoji list live in [`docs/COMMIT_CONVENTION.md`](docs/COMMIT_CONVENTION.md).

This matters because **releases are automated**: [release-please](https://github.com/googleapis/release-please)
derives the version bump and `CHANGELOG.md` from commit/PR titles (`feat:` →
minor, `fix:` → patch, `!` / `BREAKING CHANGE:` → major). A `commit-msg` hook and
the **PR Title** CI check both validate the format, so a malformed title fails CI.

> Do **not** bump the `version` in `package.json` or edit `CHANGELOG.md` by hand
> — release-please owns both.

## Pull request process

1. Create a branch from `main`.
2. Make your change with tests (`bun run test run`) and a green `bun run check`.
3. Give the PR a Conventional Commit title.
4. Fill in the pull request template (it includes a checklist).
5. For architecturally significant changes, add an
   [ADR](docs/decisions/README.md).
6. Open the PR; CI builds, tests, runs the Cypress smoke test, lints, and
   validates the package. A maintainer will review.

## Architectural Decision Records

Significant decisions are documented as MADR records under
[`docs/decisions/`](docs/decisions/README.md). See that README for how to add one.

## Releases

Releases are fully automated — see the [Releasing](README.md#releasing) section
of the README. Maintainers ship by merging the release PR that release-please
maintains.

## Questions?

See [SUPPORT.md](SUPPORT.md) for where to ask questions and get help.
