---
title: Integrate via Cypress plugin events instead of a Mocha reporter
status: accepted
date: 2026-06-12
authors:
  - cadesalaberry
---

## Context

Cypress "custom reporters" are Mocha reporters: classes instantiated inside
Cypress's runner whose hooks fire as the in-browser Mocha run progresses. That
is the obvious integration point for a package named `*-reporter`, but it is a
poor fit for shipping failures to Sentry:

- Mocha's `done` callback inside Cypress is fragile; there is no reliable
  asynchronous hand-off, so awaiting `Sentry.flush()` before the process exits
  cannot be guaranteed and events can be silently dropped.
- A Mocha reporter never sees run-level metadata such as the browser
  name/version or the Cypress version.
- Each spec gets its own reporter instance, so run-level state (a
  `maxEventsPerRun` cap, cross-spec deduplication) has nowhere natural to live.

Cypress's `setupNodeEvents` plugin API offers a structured alternative:
`after:spec` delivers a results object per spec (tests, attempts,
`displayError`, durations) in the Node process — where `@sentry/node` belongs —
and plugin event handlers may return promises that Cypress awaits.

## Decision

Integrate through Cypress plugin run events, exposed as a single
`installSentryReporter(on, config, options)` function the user calls from
`setupNodeEvents`:

- **`before:run`** captures browser (name/version) and Cypress version into
  run-scoped state.
- **`after:spec`** maps each test whose final state is `failed` to a
  `FailureContext` and reports it immediately, so a crash later in the run does
  not lose earlier failures. `shouldReport`, deduplication, and the
  `maxEventsPerRun` cap are applied here.
- **`after:run`** performs a final defensive sweep over the run results
  (deduplicated against what `after:spec` already sent), then awaits
  `Sentry.flush(3000)` so delivery completes before the process exits.

All specs in a `cypress run` share one Node plugin process, so run-level state
works naturally across specs.

A classic Mocha-reporter entry point can be added later as a secondary export
if users ask for it; it is explicitly out of scope for v1.

## Consequences

- Reliable delivery: plugin hooks can return a promise, so `Sentry.flush()`
  completes before Cypress exits.
- Richer events: browser and Cypress version metadata are available as tags, a
  `test_type` tag distinguishes `e2e` from `component` runs.
- Run events fire in `cypress run` only (or `cypress open` with
  `experimentalInteractiveRunEvents`); CI is the target use case, and the
  limitation is documented in the README.
- Cypress keeps a single handler per run event, so users who register their own
  `after:spec`/`after:run` handlers after this plugin replace its handlers —
  documented in the README.
- Console logs from specs are not exposed via plugin events; the `logs` field
  of `FailureContext` stays empty in v1. A later minor can add an optional
  support-file task that forwards `cy.log`/console output if demand exists.

## References

- Cypress run events: https://docs.cypress.io/api/plugins/after-spec-api
- Cypress Mocha reporters: https://docs.cypress.io/guides/tooling/reporters
