---
title: Integrate via Cypress plugin events instead of a Mocha reporter
status: accepted
date: 2026-06-12
authors:
  - cadesalaberry
---

## Context

Cypress "custom reporters" are Mocha reporters: they run inside the runner
attached to Mocha's event stream, which is how most reporting integrations for
Cypress are packaged. This project needs to initialize the Sentry Node SDK,
enrich failures with run-level metadata (browser, Cypress version, CI
context), and reliably flush events over the network before the process exits.
We had to choose the integration surface before writing any code.

## Decision

Integrate through Cypress's **`setupNodeEvents` plugin API** — `before:run`,
`after:spec` and `after:run` — exposed as a single registration function:

```ts
setupNodeEvents(on, config) {
  return registerCypressSentryReporter(on, config, options);
}
```

Reasons, compared to a Mocha reporter:

- `after:spec` delivers a structured results object per spec (tests, attempts,
  `displayError`, durations) in the Node plugin process, where `@sentry/node`
  works naturally.
- Plugin event handlers can return a promise, so `Sentry.flush()` completes
  reliably before the process exits. Mocha's reporter `done` callback inside
  Cypress is fragile by comparison.
- `before:run` exposes browser and Cypress version metadata that a Mocha
  reporter never sees; they become the `browser_name`/`browser_version` tags
  and the `cypress_version` extra.
- All specs in a `cypress run` share one Node plugin process, so run-level
  state (the `maxEventsPerRun` cap, failure dedup) works naturally across
  specs.

Failures are reported incrementally from `after:spec` (so a crash later in
the run does not lose earlier failures), swept once more defensively in
`after:run`, and deduplicated by a stable per-test id.

## Consequences

- The reporter only observes `cypress run` (plugin run events do not fire in
  `cypress open` unless `experimentalInteractiveRunEvents` is set). CI is the
  target use case, so this is acceptable and documented in the README.
- Browser console output is not available through plugin events, so events
  carry no `logs` extra. A later minor can add an optional support-file task
  forwarding console output if demand exists.
- Cypress keeps a single handler per plugin event, so consumers who register
  their own `after:spec`/`after:run` must compose manually; the mapping
  helpers are exported for that purpose.
- Since Cypress 13 the module-API results expose reduced per-attempt detail
  (state only) and a single `displayError` per test; the result mapper accepts
  both the rich (≤12) and reduced (13+) shapes.
- A classic Mocha-reporter entry point can still be added later as a secondary
  export if users ask for it; it is explicitly out of scope for v1.

## References

- Cypress run events: https://docs.cypress.io/api/node-events/after-spec-api
- Cypress Mocha reporters: https://docs.cypress.io/app/tooling/reporters
- Cypress 13 module API changes: https://docs.cypress.io/app/references/changelog#13-0-0
