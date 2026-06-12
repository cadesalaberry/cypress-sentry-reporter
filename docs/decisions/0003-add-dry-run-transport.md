---
title: Add dry-run transport to log Sentry envelopes instead of sending
status: accepted
date: 2026-06-12
authors:
  - cadesalaberry
---

## Context

- We want a way to validate what would be reported to Sentry without actually sending events (useful locally, in CI dry runs, and for this repo's own e2e smoke test).
- Short-circuiting reporting behind a `dryRun` flag would prevent exercising Sentry scope logic, event processors, and grouping — the dry run would not test the real pipeline.

## Decision

- Implement a custom Sentry transport factory that logs envelope items (type + payload) and returns a resolved promise.
- Enable this transport when `dryRun` is true via `Sentry.init({ transport: makeDryRunTransport })`.
- Allow an inert DSN in dry-run mode to initialize the SDK and run the normal capture flow.
- Keep the transport in `src/dry-run-transport.ts` and `src/core.ts` focused on reporting behavior.

## Details

- `makeDryRunTransport` implements `{ send(envelope), flush(timeout) }`.
- `send` iterates `envelope[1]` items and logs `{ type, payload }` with a clear prefix.
- Minimal internal `Envelope` typings are defined locally to avoid importing Sentry private types.
- The reporting core never short-circuits on `dryRun`; events go through scopes, tags, and `beforeSend` processors.
- `initSentry` chooses a fallback DSN when `dryRun` is enabled and sets the transport accordingly.

## Consequences

- Local and CI dry runs show deterministic logs of would-be sent payloads.
- The same code paths are exercised in both dry-run and real modes, reducing drift and surprises.
- No network traffic is emitted during dry runs.
- The e2e smoke test (`scripts/e2e-smoke.ts`) asserts on these logs to verify the full Cypress → plugin → Sentry pipeline without a real DSN.

## Alternatives

- Early-return logging in the reporter: rejected, because it bypasses Sentry's scope/event pipeline and diverges from real behavior.
- Mock Sentry client entirely: rejected, higher maintenance and more divergence from SDK behavior.

## Tests

- `src/dry-run-transport.test.ts` asserts logging behavior and `flush` returning `true`.
