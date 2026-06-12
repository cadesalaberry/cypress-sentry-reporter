import * as path from 'node:path';
import type {
  CypressAttemptError,
  CypressRunResults,
  CypressScreenshot,
  CypressSpecInfo,
  CypressSpecResults,
  CypressSpecStats,
  CypressTestResult,
  FailureContext,
  FailureScreenshot,
  SpecStats,
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
    .map((attempt) => attempt.duration ?? attempt.wallClockDuration)
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
 * Cypress names automatic failure screenshots after the test title joined by
 * ` -- ` (e.g. `suite -- test (failed).png`, plus an ` (attempt N)` suffix on
 * retries), so a title-prefixed basename identifies the owning test. Very
 * long titles get truncated in filenames, in which case this never matches
 * and the single-failure fallback below applies.
 */
function pathMatchesTitle(shotPath: string, title: string[]): boolean {
  if (title.length === 0) return false;
  const base = path.basename(shotPath);
  const joined = title.join(' -- ');
  return base.startsWith(`${joined} (`) || base.startsWith(`${joined}.`);
}

/**
 * Collect the screenshots belonging to one (failed) test, across the payload
 * shapes Cypress has shipped: nested under attempts (module API / older
 * versions), per spec with a `testId` back-reference (Cypress <= 12 run
 * events), or per spec with the title only encoded in the file path
 * (Cypress >= 13). As a last resort, when the spec has exactly one failed
 * test, every automatic `(failed)` screenshot of the spec must be its.
 */
export function screenshotsForTest(
  test: CypressTestResult,
  results: CypressSpecResults | undefined,
): FailureScreenshot[] | undefined {
  const collected: CypressScreenshot[] = [];
  for (const attempt of test.attempts ?? []) {
    collected.push(...(attempt.screenshots ?? []));
  }

  const specShots = results?.screenshots ?? [];
  if (collected.length === 0 && specShots.length > 0) {
    const byId = test.testId
      ? specShots.filter((shot) => shot.testId === test.testId)
      : [];
    const byTitle = specShots.filter(
      (shot) => shot.path && pathMatchesTitle(shot.path, test.title ?? []),
    );
    const tests = results?.tests ?? [];
    const failedCount = tests.filter((t) => t.state === 'failed').length;
    // Failure shots of retried-then-passed (flaky) tests also carry the
    // `(failed)` marker, so exclude anything attributable to another test.
    const fallback =
      failedCount === 1
        ? specShots.filter(
            (shot) =>
              shot.path?.includes('(failed)') &&
              !tests.some(
                (t) =>
                  t !== test &&
                  shot.path &&
                  pathMatchesTitle(shot.path, t.title ?? []),
              ),
          )
        : [];
    const matched = [byId, byTitle, fallback].find((list) => list.length > 0);
    collected.push(...(matched ?? []));
  }

  const seen = new Set<string>();
  const shots: FailureScreenshot[] = [];
  for (const shot of collected) {
    if (!shot.path || seen.has(shot.path)) continue;
    seen.add(shot.path);
    shots.push({
      path: shot.path,
      takenAt: shot.takenAt,
      width: shot.width,
      height: shot.height,
    });
  }
  return shots.length > 0 ? shots : undefined;
}

/** Structured error of the last failed attempt (Cypress <= 12 payloads). */
function lastAttemptError(
  test: CypressTestResult,
): CypressAttemptError | undefined {
  const attempts = test.attempts ?? [];
  for (let i = attempts.length - 1; i >= 0; i--) {
    const error = attempts[i]?.error;
    if (error && (error.message || error.name)) return error;
  }
  return undefined;
}

/** Normalize per-spec stats across the `wallClock*` / plain naming eras. */
export function specStatsFrom(
  stats: CypressSpecStats | null | undefined,
): SpecStats | undefined {
  if (!stats) return undefined;
  const normalized: SpecStats = {
    suites: stats.suites,
    tests: stats.tests,
    passes: stats.passes,
    pending: stats.pending,
    skipped: stats.skipped,
    failures: stats.failures,
    startedAt: stats.startedAt ?? stats.wallClockStartedAt,
    endedAt: stats.endedAt ?? stats.wallClockEndedAt,
    durationMs: stats.duration ?? stats.wallClockDuration,
  };
  const empty = Object.values(normalized).every((value) => value == null);
  return empty ? undefined : normalized;
}

/**
 * Convert one Cypress per-test result into the reporter's
 * {@link FailureContext}. Console logs are not exposed through plugin run
 * events, so `logs` is always absent in v1.
 */
export function toFailureContext(
  spec: CypressSpecInfo | undefined,
  test: CypressTestResult,
  results?: CypressSpecResults,
): FailureContext {
  const title = test.title ?? [];
  const testName = title[title.length - 1] ?? 'unknown test';
  const fullTitle = title.join(TITLE_SEPARATOR) || testName;
  const filePath = spec?.relative ?? spec?.absolute;
  // Prefer the structured error of the failed attempt (Cypress <= 12) over
  // re-parsing the pre-rendered `displayError` string.
  const attemptError = lastAttemptError(test);
  const parsed = parseDisplayError(test.displayError);
  const name = attemptError?.name ?? parsed.name;
  const message = attemptError?.message ?? parsed.message;
  const stack = attemptError?.stack ?? parsed.stack;
  const attempts = test.attempts ?? [];
  // Synthesize an error-like object so the core can surface the right error
  // class (AssertionError, CypressError, ...) instead of a bare Error.
  const error = name ? { name, message, stack } : undefined;

  return {
    // Stable per-run identity used to dedup between `after:spec` reporting
    // and the defensive `after:run` sweep.
    id: `${filePath ?? 'unknown-spec'}::${fullTitle}`,
    filePath,
    testName,
    fullTitle,
    suitePath: title.slice(0, -1),
    message,
    stack,
    error,
    durationMs: testDurationMs(test),
    retry: attempts.length > 0 ? attempts.length - 1 : 0,
    flaky: isFlaky(test),
    screenshots: screenshotsForTest(test, results),
    videoPath: results?.video ?? undefined,
    specStats: specStatsFrom(results?.stats),
    codeFrame: attemptError?.codeFrame ?? undefined,
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
    .map((test) => toFailureContext(spec ?? results?.spec, test, results));
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
