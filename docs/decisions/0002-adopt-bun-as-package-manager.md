---
title: Adopt Bun as the package manager and runtime
status: accepted
date: 2026-06-12
authors:
  - cadesalaberry
---

## Context

This repository is an npm package intended for publication. We want a fast developer experience (installs, scripts) and a single lockfile. Bun provides an all-in-one toolchain (runtime, bundler, package manager) with strong Node compatibility, which fits this project well.

## Decision

- Use Bun as the primary package manager for this repo.
- Specify the required Bun version in `package.json` `engines.bun` and set `packageManager: bun@<version>`.
- Generate and commit `bun.lock` for reproducible installs.
- Build with the Bun bundler (`bun build`) targeting Node ESM; emit type declarations with `tsc`.
- Continue to publish to the public npm registry; consumers use Node — Bun is a development-time choice only.
- Cypress is listed in `trustedDependencies` so Bun runs its postinstall (the binary download); CI jobs that never launch Cypress skip it with `CYPRESS_INSTALL_BINARY=0`.

## Consequences

- Faster installs and scripts with Bun.
- One lockfile (`bun.lock`) maintained in the repo.
- Contributors need Bun installed locally; Node remains supported for consumers of the published package.
- CI uses Bun for install and scripts.

## References

- Bun: https://bun.sh/
- npm Publishing Guide: https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages
