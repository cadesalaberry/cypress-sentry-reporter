---
title: Automate releases with release-please and Conventional Commits
status: accepted
date: 2026-06-12
authors:
  - cadesalaberry
---

## Context

The project follows [Conventional Commits](https://www.conventionalcommits.org/)
with Gitmoji (see `docs/COMMIT_CONVENTION.md`). Manual version bumps are easy to
forget, drift from the commit history, and make the changelog inconsistent.

We want the version to be derived automatically from the commit history so that:

- `feat:` commits trigger a minor bump, `fix:` a patch, and `!`/`BREAKING CHANGE:` a major.
- A `CHANGELOG.md` is generated and kept in sync with the bumps.
- Publishing to npm happens automatically once a release is cut.

The repository uses Bun as its package manager (ADR-0002), so we prefer a
solution that does not add Node release tooling as project dependencies.

## Decision

Adopt [release-please](https://github.com/googleapis/release-please) driven by a
GitHub Actions workflow (`.github/workflows/release.yml`), from day one of this
repository.

- On every push to `main`, release-please maintains a "release PR" that bumps
  `version` in `package.json` and updates `CHANGELOG.md` from Conventional
  Commits. Merging that PR creates the git tag (`vX.Y.Z`) and GitHub release.
- Configuration lives in `release-please-config.json` (release type `node`,
  single root package, Gitmoji-flavored changelog sections) and the current
  version is tracked in `.release-please-manifest.json`. The manifest starts at
  `0.0.1` so the first `feat:` release lands as `0.1.0`.
- When release-please cuts a release, a second job publishes to npm with
  `npm publish --provenance`. Authentication uses npm Trusted Publishing
  (OIDC): the `id-token: write` permission lets npm exchange the GitHub OIDC
  token for a short-lived, scoped publish credential and attach provenance, so
  no long-lived `NPM_TOKEN` secret is stored in the repo and publishing is not
  blocked by account 2FA. This requires npm >= 11.5.1 on the runner, so the job
  upgrades npm (Node 20 ships npm 10.x) before publishing.

Gitmoji placed after the `type(scope):` prefix does not interfere with commit
parsing — the type/scope are read from the prefix, and the emoji simply appears
in the changelog description, which matches the project's existing style.

### CI installs with a frozen lockfile

The publish job installs with `bun install --frozen-lockfile` so the published
build is reproducible. CI (`.github/workflows/ci.yml`) installs the same way, so
the two stay in lockstep. This matters because a stale `bun.lock` — e.g. a
Dependabot bump that updates `package.json` but not the lockfile — would
otherwise pass a non-frozen CI install, land on `main`, and only surface at
release time when the publish job's frozen install rejects it (which is exactly
what once broke a deploy of the sibling `vitest-sentry-reporter`). Enforcing
frozen installs everywhere makes lockfile drift fail loudly on the offending PR
instead of silently reaching a release tag.

### Required repository configuration

- **npm Trusted Publisher**: on npmjs.com, open the package → Settings →
  Trusted Publishers and add a GitHub Actions publisher for repo
  `cadesalaberry/cypress-sentry-reporter` and workflow `release.yml`. No
  `NPM_TOKEN` secret is required, and publishing is not blocked by account 2FA.
- **Allow GitHub Actions to create and approve pull requests**: enable under
  Settings → Actions → General → Workflow permissions, otherwise release-please
  cannot open its release PR with the default `GITHUB_TOKEN`.

## Consequences

- Versioning and changelog generation are automatic and consistent with the
  commit history; humans still control *when* to release by merging the PR.
- No release tooling is added to the project's dependencies — release-please
  runs entirely as a GitHub Action.
- Releases are reproducible and publish with npm provenance, improving
  supply-chain transparency.
- Contributors must keep following the Conventional Commits convention; commits
  that do not match a releasable type will not trigger a bump.
- Release PRs opened by the default `GITHUB_TOKEN` do not themselves trigger the
  CI workflow. CI already runs on the underlying feature commits; if CI on the
  release PR is desired later, switch release-please to a PAT or app token.
- Because CI installs frozen, a Dependabot npm PR that bumps `package.json`
  without updating `bun.lock` will fail CI until the lockfile is regenerated
  (`bun install` and commit `bun.lock`). This is the intended signal; if it
  becomes noisy, migrate dependency updates to Renovate, which has mature Bun
  support (see `.github/dependabot.yml`).

## References

- release-please: https://github.com/googleapis/release-please
- release-please-action: https://github.com/googleapis/release-please-action
- Conventional Commits: https://www.conventionalcommits.org/
- npm provenance: https://docs.npmjs.com/generating-provenance-statements
- npm trusted publishing (OIDC): https://docs.npmjs.com/trusted-publishers
- ADR-0002: Adopt Bun as the package manager and runtime
- `docs/COMMIT_CONVENTION.md`
