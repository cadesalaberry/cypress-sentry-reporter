import { describe, expect, it } from 'vitest';
import {
  failuresFromRun,
  failuresFromSpec,
  isFlaky,
  parseDisplayError,
  testDurationMs,
  toFailureContext,
} from './map-results.js';
import type {
  CypressSpecInfo,
  CypressSpecResults,
  CypressTestResult,
} from './types.js';

const SPEC: CypressSpecInfo = {
  name: 'login.cy.ts',
  relative: 'cypress/e2e/login.cy.ts',
  absolute: '/repo/cypress/e2e/login.cy.ts',
};

const DISPLAY_ERROR = [
  "AssertionError: Timed out retrying after 4000ms: Expected to find element: '#login', but never found it.",
  '    at Context.eval (webpack:///./cypress/e2e/login.cy.ts:12:8)',
  '    at runnable.fn (http://localhost/__cypress/runner/cypress_runner.js:1:1)',
].join('\n');

/** `after:spec` payload of a test that failed on every attempt (1 retry). */
const failedTest: CypressTestResult = {
  title: ['auth', 'login', 'shows the form'],
  state: 'failed',
  displayError: DISPLAY_ERROR,
  attempts: [
    { state: 'failed', duration: 4100 },
    { state: 'failed', duration: 4050 },
  ],
};

/** Retried test that eventually passed — flaky, not a failure. */
const flakyTest: CypressTestResult = {
  title: ['auth', 'login', 'remembers the session'],
  state: 'passed',
  displayError: null,
  attempts: [{ state: 'failed', duration: 900 }, { state: 'passed' }],
};

const passedTest: CypressTestResult = {
  title: ['auth', 'login', 'logs in'],
  state: 'passed',
  displayError: null,
  attempts: [{ state: 'passed', duration: 350 }],
};

const pendingTest: CypressTestResult = {
  title: ['auth', 'login', 'supports SSO'],
  state: 'pending',
  displayError: null,
  attempts: [],
};

describe('parseDisplayError', () => {
  it('splits the first line into name/message and keeps the rest as stack', () => {
    const parsed = parseDisplayError(DISPLAY_ERROR);
    expect(parsed.name).toBe('AssertionError');
    expect(parsed.message).toBe(
      "Timed out retrying after 4000ms: Expected to find element: '#login', but never found it.",
    );
    expect(parsed.stack).toContain('at Context.eval');
    expect(parsed.stack).not.toContain('AssertionError');
  });

  it('keeps the whole first line as message when it has no error-name prefix', () => {
    const parsed = parseDisplayError('something exploded\n    at somewhere');
    expect(parsed.name).toBeUndefined();
    expect(parsed.message).toBe('something exploded');
    expect(parsed.stack).toBe('at somewhere');
  });

  it('handles a single-line error without a stack', () => {
    const parsed = parseDisplayError('CypressError: the spec crashed');
    expect(parsed.name).toBe('CypressError');
    expect(parsed.message).toBe('the spec crashed');
    expect(parsed.stack).toBeUndefined();
  });

  it('returns an empty result for null, undefined or blank input', () => {
    expect(parseDisplayError(null)).toEqual({});
    expect(parseDisplayError(undefined)).toEqual({});
    expect(parseDisplayError('  \n ')).toEqual({});
  });
});

describe('testDurationMs', () => {
  it('prefers the test-level duration when present (Cypress >= 13 shape)', () => {
    expect(testDurationMs({ title: ['t'], duration: 1234.6 })).toBe(1235);
  });

  it('sums attempt durations when there is no test-level duration', () => {
    expect(testDurationMs(failedTest)).toBe(8150);
  });

  it('ignores attempts without durations and returns undefined when none have one', () => {
    expect(
      testDurationMs({ title: ['t'], attempts: [{ state: 'failed' }] }),
    ).toBeUndefined();
    expect(testDurationMs({ title: ['t'] })).toBeUndefined();
  });
});

describe('isFlaky', () => {
  it('marks a retried-then-passed test as flaky', () => {
    expect(isFlaky(flakyTest)).toBe(true);
  });

  it('does not mark consistently failed or cleanly passed tests', () => {
    expect(isFlaky(failedTest)).toBe(false);
    expect(isFlaky(passedTest)).toBe(false);
  });
});

describe('toFailureContext', () => {
  it('maps spec and title fields per the documented field mapping', () => {
    const ctx = toFailureContext(SPEC, failedTest);
    expect(ctx).toEqual(
      expect.objectContaining({
        id: 'cypress/e2e/login.cy.ts::auth > login > shows the form',
        filePath: 'cypress/e2e/login.cy.ts',
        testName: 'shows the form',
        fullTitle: 'auth > login > shows the form',
        suitePath: ['auth', 'login'],
        message: expect.stringContaining('Timed out retrying'),
        durationMs: 8150,
        retry: 1,
        flaky: false,
      }),
    );
    expect(ctx.stack).toContain('at Context.eval');
    expect(ctx.meta).toEqual(
      expect.objectContaining({
        specName: 'login.cy.ts',
        absolutePath: '/repo/cypress/e2e/login.cy.ts',
        state: 'failed',
      }),
    );
  });

  it('synthesizes an error-like object carrying the parsed error name', () => {
    const ctx = toFailureContext(SPEC, failedTest);
    expect(ctx.error).toEqual(
      expect.objectContaining({ name: 'AssertionError' }),
    );
  });

  it('handles a top-level test (single-element title) and missing spec', () => {
    const ctx = toFailureContext(undefined, {
      title: ['just a test'],
      state: 'failed',
      displayError: 'Error: boom',
    });
    expect(ctx.filePath).toBeUndefined();
    expect(ctx.testName).toBe('just a test');
    expect(ctx.fullTitle).toBe('just a test');
    expect(ctx.suitePath).toEqual([]);
    expect(ctx.retry).toBe(0);
    expect(ctx.id).toBe('unknown-spec::just a test');
  });
});

describe('failuresFromSpec', () => {
  const results: CypressSpecResults = {
    spec: SPEC,
    tests: [failedTest, flakyTest, passedTest, pendingTest],
  };

  it('maps only tests whose final state is failed', () => {
    const failures = failuresFromSpec(SPEC, results);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.testName).toBe('shows the form');
  });

  it('falls back to the spec embedded in the results payload', () => {
    const failures = failuresFromSpec(undefined, results);
    expect(failures[0]?.filePath).toBe('cypress/e2e/login.cy.ts');
  });

  it('returns an empty list for missing or empty test lists', () => {
    expect(failuresFromSpec(SPEC, undefined)).toEqual([]);
    expect(failuresFromSpec(SPEC, { tests: null })).toEqual([]);
  });
});

describe('failuresFromRun', () => {
  it('collects failures across all spec runs', () => {
    const failures = failuresFromRun({
      runs: [
        { spec: SPEC, tests: [failedTest, passedTest] },
        {
          spec: { relative: 'cypress/e2e/other.cy.ts' },
          tests: [
            {
              title: ['other', 'breaks'],
              state: 'failed',
              displayError: 'TypeError: x is not a function',
            },
          ],
        },
      ],
    });
    expect(failures.map((f) => f.testName)).toEqual([
      'shows the form',
      'breaks',
    ]);
  });

  it('tolerates missing runs', () => {
    expect(failuresFromRun(undefined)).toEqual([]);
    expect(failuresFromRun({ runs: null })).toEqual([]);
  });
});
