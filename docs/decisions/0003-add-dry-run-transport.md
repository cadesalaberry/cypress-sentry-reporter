---
title: Add dry-run transport to log Sentry envelopes instead of sending
status: accepted
date: 2026-06-12
authors:
  - cadesalaberry
---

## Context

- We want a way to validate what would be reported to Sentry without actually sending events (useful locally, in CI dry runs, and for this repo's own e2e smoke test).
- A naive `dryRun` flag that short-circuits reporting would prevent exercising Sentry scope logic, event processors, and grouping.

## Decision

- Implement a custom Sentry transport factory that logs envelope items (type + payload) and returns a resolved promise.
- Enable this transport when `dryRun` is true via `Sentry.init({ transport: makeDryRunTransport })`.
- Allow an inert DSN in dry-run mode to initialize the SDK and run the normal capture flow.
- Keep the transport in `src/dry-run-transport.ts` and `src/core.ts` focused on reporting behavior.

## Details

- `makeDryRunTransport` implements `{ send(envelope), flush(timeout) }`.
- `send` iterates `envelope[1]` items and logs a human-friendly summary (event level, `test_file`, tags) with a clear prefix.
- `reportFailure` does not short-circuit on `dryRun`; events go through scopes, tags, and `beforeSend` processors.
- `initSentry` chooses a fallback DSN when `dryRun` is enabled and sets the transport accordingly.
- The e2e smoke test (`bun run test:e2e`) runs a real `cypress run` against the `e2e/` fixture with `dryRun: true` and asserts the logged envelope.

## Consequences

- Local and CI dry runs show deterministic logs of would-be sent payloads.
- The same code paths are exercised in both dry-run and real modes, reducing drift and surprises.
- No network traffic is emitted during dry runs.

## Alternatives

- Early-return logging in the reporter: rejected, because it bypasses Sentry's scope/event pipeline and diverges from real behavior.
- Mock the Sentry client entirely: rejected, higher maintenance and more divergence from SDK behavior.

## Tests

- `src/dry-run-transport.test.ts` asserts logging behavior and `flush` returning `true`.
- `scripts/assert-e2e-smoke.ts` asserts the end-to-end envelope produced by a real Cypress run.
