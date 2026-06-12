import type {
  CypressRunResults,
  CypressSpecInfo,
  CypressSpecResults,
  CypressTestResult,
  FailureContext,
} from './types.js';

const TITLE_SEPARATOR = ' > ';

/** First line of a `displayError` shaped like `AssertionError: expected …`. */
const ERROR_NAME_RE = /^([A-Za-z_$][\w$]*(?:Error|Failure)):\s*(.*)$/;

/**
 * Split a Cypress `displayError` into an error name, a one-line message and
 * the remaining stack. Cypress collapses each test's failure into a single
 * pre-rendered string; the first line carries the `Name: message` summary and
 * the rest is the stack trace.
 */
export function parseDisplayError(displayError: string | null | undefined): {
  name?: string;
  message?: string;
  stack?: string;
} {
  if (!displayError) return {};
  const normalized = displayError.replace(/\r\n/g, '\n').trim();
  if (!normalized) return {};

  const newline = normalized.indexOf('\n');
  const firstLine = newline === -1 ? normalized : normalized.slice(0, newline);
  const rest = newline === -1 ? '' : normalized.slice(newline + 1).trim();

  const named = firstLine.match(ERROR_NAME_RE);
  return {
    name: named?.[1],
    message: named?.[2] || firstLine,
    stack: rest || undefined,
  };
}

/**
 * Test duration in whole milliseconds: the test-level `duration` when Cypress
 * provides one, otherwise the sum of per-attempt durations (Cypress <= 12
 * exposes attempt durations but no test total).
 */
export function testDurationMs(test: CypressTestResult): number | undefined {
  if (typeof test.duration === 'number') return Math.round(test.duration);
  const attempts = test.attempts ?? [];
  const durations = attempts
    .map((attempt) => attempt.duration)
    .filter((duration): duration is number => typeof duration === 'number');
  if (durations.length === 0) return undefined;
  return Math.round(durations.reduce((total, duration) => total + duration, 0));
}

/** A test is flaky when it eventually passed after at least one failed attempt. */
export function isFlaky(test: CypressTestResult): boolean {
  return (
    test.state === 'passed' &&
    (test.attempts ?? []).some((attempt) => attempt.state === 'failed')
  );
}

/**
 * Convert one Cypress per-test result into the reporter's
 * {@link FailureContext}. Console logs are not exposed through plugin run
 * events, so `logs` is always absent in v1.
 */
export function toFailureContext(
  spec: CypressSpecInfo | undefined,
  test: CypressTestResult,
): FailureContext {
  const title = test.title ?? [];
  const testName = title[title.length - 1] ?? 'unknown test';
  const fullTitle = title.join(TITLE_SEPARATOR) || testName;
  const filePath = spec?.relative ?? spec?.absolute;
  const parsed = parseDisplayError(test.displayError);
  const attempts = test.attempts ?? [];
  // Synthesize an error-like object so the core can surface the right error
  // class (AssertionError, CypressError, ...) instead of a bare Error.
  const error = parsed.name
    ? { name: parsed.name, message: parsed.message, stack: parsed.stack }
    : undefined;

  return {
    // Stable per-run identity used to dedup between `after:spec` reporting
    // and the defensive `after:run` sweep.
    id: `${filePath ?? 'unknown-spec'}::${fullTitle}`,
    filePath,
    testName,
    fullTitle,
    suitePath: title.slice(0, -1),
    message: parsed.message,
    stack: parsed.stack,
    error,
    durationMs: testDurationMs(test),
    retry: attempts.length > 0 ? attempts.length - 1 : 0,
    flaky: isFlaky(test),
    meta: {
      specName: spec?.name,
      absolutePath: spec?.absolute,
      state: test.state,
    },
  };
}

/**
 * Map an `after:spec` results payload to one {@link FailureContext} per test
 * whose final state is `failed`. Passed (including flaky), pending and
 * skipped tests are not reported.
 */
export function failuresFromSpec(
  spec: CypressSpecInfo | undefined,
  results: CypressSpecResults | undefined,
): FailureContext[] {
  const tests = results?.tests ?? [];
  return tests
    .filter((test) => test.state === 'failed')
    .map((test) => toFailureContext(spec ?? results?.spec, test));
}

/**
 * Map an `after:run` results payload (one entry per spec) to failure
 * contexts, for the defensive end-of-run sweep.
 */
export function failuresFromRun(
  results: CypressRunResults | undefined,
): FailureContext[] {
  const runs = results?.runs ?? [];
  return runs.flatMap((run) => failuresFromSpec(run.spec, run));
}
