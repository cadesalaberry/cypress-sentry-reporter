---
title: Adopt Bun as the package manager and runtime
status: accepted
date: 2026-06-12
authors:
  - cadesalaberry
---

## Context

This repository is an npm package intended for publication. We want a fast developer experience (installs, scripts) and a single lockfile. Bun provides an all-in-one toolchain (runtime, test runner, bundler, package manager) with strong Node compatibility, which fits this project well. The sibling project `vitest-sentry-reporter` made the same choice and it has worked well there.

## Decision

- Use Bun as the primary package manager for this repo.
- Specify the required Bun version in `package.json` `engines.bun` and set `packageManager: bun@<version>`.
- Generate and commit `bun.lock` for reproducible installs.
- Maintain Node compatibility for consumers: the published package is plain ESM consumed by the Node process Cypress spawns for `setupNodeEvents`.
- Continue to publish to the public npm registry.

## Consequences

- Faster installs and scripts with Bun.
- One lockfile (`bun.lock`) maintained in the repo.
- Contributors need Bun installed locally; Node remains supported for consumers of the published package.
- CI should use Bun for install and scripts.
- Bun blocks postinstall scripts by default; `cypress` is listed in `trustedDependencies` so its binary install can run.

## References

- Bun: https://bun.sh/
- npm Publishing Guide: https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages
- Cypress plugins API: https://docs.cypress.io/api/plugins/writing-a-plugin
