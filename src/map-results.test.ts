import { describe, expect, it } from 'vitest';
import {
  failuresFromRun,
  failuresFromSpec,
  isFlaky,
  parseDisplayError,
  screenshotsForTest,
  specStatsFrom,
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

  it('falls back to wallClockDuration (Cypress <= 12 run-event payloads)', () => {
    expect(
      testDurationMs({
        title: ['t'],
        attempts: [
          { state: 'failed', wallClockDuration: 408 },
          { state: 'failed', wallClockDuration: 392 },
        ],
      }),
    ).toBe(800);
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

describe('screenshotsForTest', () => {
  const SHOT_DIR = '/repo/cypress/screenshots/login.cy.ts';

  it('uses attempt-level screenshots when present (module-API shape)', () => {
    const test: CypressTestResult = {
      title: ['auth', 'login', 'shows the form'],
      state: 'failed',
      attempts: [
        {
          state: 'failed',
          screenshots: [
            {
              path: `${SHOT_DIR}/auth -- login -- shows the form (failed).png`,
              takenAt: '2026-06-12T00:00:00.000Z',
              width: 1280,
              height: 720,
            },
          ],
        },
      ],
    };

    expect(screenshotsForTest(test, { tests: [test] })).toEqual([
      {
        path: `${SHOT_DIR}/auth -- login -- shows the form (failed).png`,
        takenAt: '2026-06-12T00:00:00.000Z',
        width: 1280,
        height: 720,
      },
    ]);
  });

  it('links spec-level screenshots by testId (Cypress <= 12 run events)', () => {
    const failing: CypressTestResult = {
      testId: 'r3',
      title: ['auth', 'breaks'],
      state: 'failed',
    };
    const other: CypressTestResult = {
      testId: 'r4',
      title: ['auth', 'also breaks'],
      state: 'failed',
    };
    const results: CypressSpecResults = {
      tests: [failing, other],
      screenshots: [
        { testId: 'r3', path: `${SHOT_DIR}/auth -- breaks (failed).png` },
        { testId: 'r4', path: `${SHOT_DIR}/auth -- also breaks (failed).png` },
      ],
    };

    expect(screenshotsForTest(failing, results)).toEqual([
      { path: `${SHOT_DIR}/auth -- breaks (failed).png` },
    ]);
  });

  it('matches spec-level screenshots by title in the path (Cypress >= 13)', () => {
    const failing: CypressTestResult = {
      title: ['auth', 'breaks'],
      state: 'failed',
    };
    const other: CypressTestResult = {
      title: ['auth', 'breaks badly'],
      state: 'failed',
    };
    const results: CypressSpecResults = {
      tests: [failing, other],
      screenshots: [
        { path: `${SHOT_DIR}/auth -- breaks (failed).png` },
        { path: `${SHOT_DIR}/auth -- breaks (failed) (attempt 2).png` },
        { path: `${SHOT_DIR}/auth -- breaks badly (failed).png` },
      ],
    };

    // Prefix matching must not leak "breaks badly" shots into "breaks".
    expect(screenshotsForTest(failing, results)?.map((s) => s.path)).toEqual([
      `${SHOT_DIR}/auth -- breaks (failed).png`,
      `${SHOT_DIR}/auth -- breaks (failed) (attempt 2).png`,
    ]);
    expect(screenshotsForTest(other, results)?.map((s) => s.path)).toEqual([
      `${SHOT_DIR}/auth -- breaks badly (failed).png`,
    ]);
  });

  it('falls back to the spec failure shots when it is the only failed test', () => {
    // Title truncated in the filename, so no title match is possible.
    const failing: CypressTestResult = {
      title: ['auth', 'a very long test name that cypress truncated'],
      state: 'failed',
    };
    const flaky: CypressTestResult = {
      title: ['auth', 'flaky one'],
      state: 'passed',
      attempts: [{ state: 'failed' }, { state: 'passed' }],
    };
    const results: CypressSpecResults = {
      tests: [failing, flaky],
      screenshots: [
        { path: `${SHOT_DIR}/auth -- a very long test na (failed).png` },
        // Belongs to the flaky test's failed attempt — must not be stolen.
        { path: `${SHOT_DIR}/auth -- flaky one (failed).png` },
        // Manually named shot: not attributable, not a failure shot.
        { path: `${SHOT_DIR}/custom-name.png` },
      ],
    };

    expect(screenshotsForTest(failing, results)?.map((s) => s.path)).toEqual([
      `${SHOT_DIR}/auth -- a very long test na (failed).png`,
    ]);
  });

  it('returns undefined when nothing is attributable', () => {
    const failing: CypressTestResult = { title: ['a', 'one'], state: 'failed' };
    const alsoFailing: CypressTestResult = {
      title: ['a', 'two'],
      state: 'failed',
    };
    const results: CypressSpecResults = {
      tests: [failing, alsoFailing],
      screenshots: [{ path: `${SHOT_DIR}/unrelated (failed).png` }],
    };

    expect(screenshotsForTest(failing, results)).toBeUndefined();
    expect(screenshotsForTest(failing, undefined)).toBeUndefined();
  });

  it('deduplicates screenshots reported through multiple shapes', () => {
    const shot = { path: `${SHOT_DIR}/a -- one (failed).png` };
    const failing: CypressTestResult = {
      testId: 'r2',
      title: ['a', 'one'],
      state: 'failed',
      attempts: [{ state: 'failed', screenshots: [shot] }],
    };
    const results: CypressSpecResults = {
      tests: [failing],
      screenshots: [{ ...shot, testId: 'r2' }],
    };

    expect(screenshotsForTest(failing, results)).toHaveLength(1);
  });
});

describe('specStatsFrom', () => {
  it('normalizes the wallClock* names of Cypress <= 12 payloads', () => {
    expect(
      specStatsFrom({
        suites: 1,
        tests: 2,
        passes: 1,
        pending: 0,
        skipped: 0,
        failures: 1,
        wallClockStartedAt: '2026-06-12T00:00:00.000Z',
        wallClockEndedAt: '2026-06-12T00:00:01.000Z',
        wallClockDuration: 1000,
      }),
    ).toEqual({
      suites: 1,
      tests: 2,
      passes: 1,
      pending: 0,
      skipped: 0,
      failures: 1,
      startedAt: '2026-06-12T00:00:00.000Z',
      endedAt: '2026-06-12T00:00:01.000Z',
      durationMs: 1000,
    });
  });

  it('passes through the plain names of Cypress >= 13 payloads', () => {
    expect(
      specStatsFrom({ failures: 1, duration: 253, startedAt: 'x' }),
    ).toEqual(
      expect.objectContaining({ failures: 1, durationMs: 253, startedAt: 'x' }),
    );
  });

  it('returns undefined for missing or empty stats', () => {
    expect(specStatsFrom(undefined)).toBeUndefined();
    expect(specStatsFrom(null)).toBeUndefined();
    expect(specStatsFrom({})).toBeUndefined();
  });
});

describe('toFailureContext debug context', () => {
  /** Shaped after a real Cypress 12.17.4 after:spec payload. */
  const cypress12Results: CypressSpecResults = {
    spec: SPEC,
    stats: {
      suites: 1,
      tests: 1,
      passes: 0,
      pending: 0,
      skipped: 0,
      failures: 1,
      wallClockStartedAt: '2026-06-12T14:27:19.943Z',
      wallClockEndedAt: '2026-06-12T14:27:20.393Z',
      wallClockDuration: 450,
    },
    tests: [
      {
        testId: 'r3',
        title: ['auth', 'login', 'shows the form'],
        state: 'failed',
        displayError: DISPLAY_ERROR,
        attempts: [
          {
            state: 'failed',
            error: {
              name: 'CypressError',
              message: 'structured message',
              stack: '    at structured (login.cy.ts:12:8)',
              codeFrame: {
                line: 12,
                column: 8,
                relativeFile: 'cypress/e2e/login.cy.ts',
                frame: "> 12 | cy.get('#login')",
                language: 'ts',
              },
            },
            wallClockDuration: 408,
          },
        ],
      },
    ],
    video: '/repo/cypress/videos/login.cy.ts.mp4',
    screenshots: [
      {
        testId: 'r3',
        path: '/repo/cypress/screenshots/login.cy.ts/auth -- login -- shows the form (failed).png',
        takenAt: '2026-06-12T14:27:20.013Z',
        height: 720,
        width: 1280,
      },
    ],
  };

  it('prefers the structured attempt error over the parsed displayError', () => {
    const test = cypress12Results.tests?.[0] as CypressTestResult;
    const ctx = toFailureContext(SPEC, test, cypress12Results);

    expect(ctx.error).toEqual({
      name: 'CypressError',
      message: 'structured message',
      stack: '    at structured (login.cy.ts:12:8)',
    });
    expect(ctx.message).toBe('structured message');
    expect(ctx.codeFrame).toEqual(
      expect.objectContaining({
        line: 12,
        frame: "> 12 | cy.get('#login')",
      }),
    );
    expect(ctx.durationMs).toBe(408);
  });

  it('maps screenshots, video and spec stats from the results payload', () => {
    const failures = failuresFromSpec(SPEC, cypress12Results);

    expect(failures).toHaveLength(1);
    expect(failures[0]?.screenshots).toEqual([
      {
        path: '/repo/cypress/screenshots/login.cy.ts/auth -- login -- shows the form (failed).png',
        takenAt: '2026-06-12T14:27:20.013Z',
        width: 1280,
        height: 720,
      },
    ]);
    expect(failures[0]?.videoPath).toBe('/repo/cypress/videos/login.cy.ts.mp4');
    expect(failures[0]?.specStats).toEqual(
      expect.objectContaining({ failures: 1, durationMs: 450 }),
    );
  });

  it('leaves the debug fields undefined when Cypress provides nothing', () => {
    const ctx = toFailureContext(SPEC, failedTest);

    expect(ctx.screenshots).toBeUndefined();
    expect(ctx.videoPath).toBeUndefined();
    expect(ctx.specStats).toBeUndefined();
    expect(ctx.codeFrame).toBeUndefined();
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
