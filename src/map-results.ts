import type { FailureContext } from './types.js';
import { toErrorMessage, toStack } from './utils.js';

/**
 * Structural subsets of the result objects Cypress hands to the
 * `after:spec`/`after:run` plugin events. Every field is optional because the
 * exact shape varies across Cypress versions: Cypress ≤12 exposes a rich
 * per-attempt `error` and per-attempt `duration`, while Cypress 13+ reduces
 * attempts to their `state` and reports a test-level `duration` plus a single
 * `displayError`. The mapper accepts both.
 */
export interface AttemptResultLike {
  state?: string;
  error?: { name?: string; message?: string; stack?: string } | null;
  duration?: number;
}

export interface TestResultLike {
  /** Suite titles followed by the test title, outermost first. */
  title?: string[];
  state?: string;
  displayError?: string | null;
  duration?: number;
  attempts?: AttemptResultLike[] | null;
}

export interface SpecLike {
  /** Spec path relative to the Cypress project root. */
  relative?: string;
  absolute?: string;
  name?: string;
}

export interface SpecResultsLike {
  spec?: SpecLike | null;
  tests?: TestResultLike[] | null;
}

export interface RunResultsLike {
  /** Per-spec results; absent on `CypressFailedRunResult` (run never started). */
  runs?: SpecResultsLike[] | null;
}

/**
 * Split a Cypress `displayError` into a synthetic error. The first line
 * carries the message (with an optional `Name:` prefix); the full text is
 * kept as the stack so Sentry can parse the `    at …` frames, mirroring the
 * `Error.prototype.stack` format.
 */
function parseDisplayError(displayError: string | null | undefined): {
  name?: string;
  message?: string;
  stack?: string;
} {
  const text = displayError?.trim();
  if (!text) return {};
  const firstLine = text.split('\n', 1)[0] ?? '';
  const named = /^([A-Za-z_$][\w$]*):\s*(.*)$/.exec(firstLine);
  if (named?.[1] && named[2]) {
    return { name: named[1], message: named[2], stack: text };
  }
  return { message: firstLine, stack: text };
}

/** Stable identity of a test across `after:spec` and the `after:run` sweep. */
function testId(filePath: string, fullTitle: string): string {
  return `${filePath}::${fullTitle}`;
}

/**
 * Convert a single Cypress test result into a {@link FailureContext}.
 * Prefers the last attempt's structured error (Cypress ≤12) over parsing
 * `displayError` (the only error detail Cypress 13+ exposes).
 */
export function toFailureContext(
  spec: SpecLike | null | undefined,
  test: TestResultLike,
): FailureContext {
  const title = test.title ?? [];
  const testName = title[title.length - 1] ?? 'unknown test';
  const fullTitle = title.join(' > ') || testName;
  const suitePath = title.slice(0, -1);
  const filePath = spec?.relative ?? spec?.name ?? 'unknown';

  const attempts = test.attempts ?? [];
  const lastAttemptError = [...attempts]
    .reverse()
    .find((attempt) => attempt.error)?.error;
  const parsed = lastAttemptError
    ? undefined
    : parseDisplayError(test.displayError);
  const error = lastAttemptError ?? (parsed?.message ? parsed : undefined);

  const attemptDurations = attempts
    .map((attempt) => attempt.duration)
    .filter((duration): duration is number => typeof duration === 'number');
  const duration =
    test.duration ??
    (attemptDurations.length > 0
      ? attemptDurations.reduce((sum, ms) => sum + ms, 0)
      : undefined);

  return {
    id: testId(filePath, fullTitle),
    filePath,
    testName,
    fullTitle,
    suitePath,
    message: lastAttemptError
      ? toErrorMessage(lastAttemptError)
      : parsed?.message,
    stack: lastAttemptError ? toStack(lastAttemptError) : parsed?.stack,
    error,
    durationMs: duration == null ? undefined : Math.round(duration),
    retry: Math.max(attempts.length - 1, 0),
    flaky:
      test.state === 'passed' &&
      attempts.some((attempt) => attempt.state === 'failed'),
    meta: { spec: filePath, specAbsolute: spec?.absolute },
  };
}

/**
 * Map an `after:spec` results object to one {@link FailureContext} per test
 * whose final state is `failed`. Tests that pass (including on a retry —
 * "flaky" passes) or are pending/skipped are not reported.
 */
export function mapSpecResults(
  spec: SpecLike | null | undefined,
  results: SpecResultsLike | null | undefined,
): FailureContext[] {
  const tests = results?.tests ?? [];
  return tests
    .filter((test) => test.state === 'failed')
    .map((test) => toFailureContext(spec ?? results?.spec, test));
}

/**
 * Map an `after:run` results object across all of its specs. Used as a
 * defensive sweep to catch failures not seen via `after:spec`; the core's
 * id-based dedup makes the overlap harmless.
 */
export function mapRunResults(
  results: RunResultsLike | null | undefined,
): FailureContext[] {
  const runs = results?.runs ?? [];
  if (!Array.isArray(runs)) return [];
  return runs.flatMap((run) => mapSpecResults(run.spec, run));
}
