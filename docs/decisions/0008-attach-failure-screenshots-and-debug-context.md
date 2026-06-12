---
title: Attach failure screenshots and debug context to Sentry events
status: accepted
date: 2026-06-12
authors:
  - cadesalaberry
---

## Context

- A stack trace alone often does not explain an e2e failure; the screenshot
  Cypress takes on failure (its `screenshotOnRunFailure`, on by default)
  usually does. Sentry supports event attachments, so the image can live on
  the issue itself instead of an expiring CI artifact.
- The run-event payloads carry more debugging signal than v1 reported, and the
  shape varies by Cypress generation. Verified empirically against real
  `after:spec` payloads (Cypress 12.17.4 and 15.17.0):
  - Cypress <= 12 lists screenshots per spec with a `testId` back-reference
    to the test, and gives each failed attempt a structured error (`name`,
    `message`, `stack`, `codeFrame`) plus `wallClock*` stats/durations.
  - Cypress >= 13 keeps the per-spec screenshot list but drops `testId` (the
    test title only survives in the file path), reduces attempts to `state`
    only, and uses plain `stats` names.
- Attachments ride in the same envelope as the event: an oversized image
  could sink the failure report itself, so uploads need a size cap.

## Decision

- Map screenshots to each failing test in `map-results.ts`
  (`screenshotsForTest`), across all payload shapes: attempt-level lists,
  per-spec lists matched by `testId`, then by title-prefixed basename
  (Cypress builds failure screenshot names as
  `title -- parts (failed)[ (attempt N)].png`). As a last resort, when the
  spec has exactly one failed test, unmatched `(failed)` screenshots are
  attributed to it (excluding shots attributable to another test, e.g. a
  flaky test's failed attempt).
- Upload the matched screenshots as Sentry attachments from the core
  (`scope.addAttachment`), **enabled by default** and controlled by a new
  `screenshots` option (`boolean | { enabled?; maxBytes? }`). Files missing
  on disk or above `maxBytes` (default 10 MiB, far below Sentry's limits)
  are skipped with a warning; their metadata still reaches Sentry via the
  new `screenshots` extra.
- Report the extra debug context the payloads already carry:
  `screenshots` (path/timestamp/dimensions), `video_path`, `spec_stats`
  (normalized across the `wallClock*`/plain naming eras) and `code_frame`
  extras; prefer the structured attempt error over re-parsing
  `displayError`; fall back to `wallClockDuration` so `duration_ms` is
  populated on Cypress <= 12 payloads.
- Videos are never uploaded (size); only their path is reported.

## Consequences

- Failure screenshots are visible directly on the Sentry issue; the smoke
  test asserts the attachment and the new extras end-to-end via the dry-run
  transport (which now logs every envelope item, including attachments).
- Sentry may bill attachments separately; `screenshots: false` (or
  `{ enabled: false }`) keeps events lean while preserving the metadata.
- Title-based matching cannot attribute manually named `cy.screenshot()`
  shots on Cypress >= 13 (no `testId`); they are only attached in the
  single-failed-test fallback when carrying the `(failed)` marker.

## Alternatives

- **`after:screenshot` event**: exposes `testFailure` and dimensions, but not
  the owning test, and Cypress keeps one handler per event — registering it
  would silently replace a consumer's own handler for marginal gain.
- **Opt-in instead of default-on**: rejected; the screenshot is the single
  most useful artifact for an e2e failure and Cypress already takes it by
  default, so the reporter should ship it by default with an escape hatch.
- **Uploading videos too**: rejected for size/cost; the `video_path` extra
  points at the CI artifact instead.

## Tests

- `map-results.test.ts`: matching by attempt list, `testId`, title prefix
  (including no cross-test leakage), single-failure fallback (not stealing
  flaky tests' shots), dedup, stats normalization, structured-error and
  `wallClockDuration` preference.
- `core.test.ts`: attachments on by default, both disable forms, `maxBytes`
  cap and unreadable-file handling (event still sent), extras metadata.
- `dry-run-transport.test.ts`: attachment and extras logging, exception
  title fallback.
- `scripts/e2e-smoke.ts`: a real `cypress run` must produce one envelope
  with the screenshot attachment, `screenshots`/`spec_stats`/`code_frame`
  extras and the structured error title.
