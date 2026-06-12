import { describe, expect, it } from 'vitest';
import {
  mapRunResults,
  mapSpecResults,
  type SpecResultsLike,
  toFailureContext,
} from './map-results.js';

const spec = {
  relative: 'cypress/e2e/login.cy.ts',
  absolute: '/repo/cypress/e2e/login.cy.ts',
  name: 'login.cy.ts',
};

const DISPLAY_ERROR = [
  'AssertionError: Timed out retrying after 4000ms: expected true to equal false',
  '    at Context.eval (webpack://app/./cypress/e2e/login.cy.ts:7:29)',
].join('\n');

/** A failed test as Cypress 13+ reports it: displayError only, bare attempts. */
function failedTest13(): SpecResultsLike['tests'] {
  return [
    {
      title: ['login', 'rejects bad credentials'],
      state: 'failed',
      displayError: DISPLAY_ERROR,
      duration: 4123.6,
      attempts: [{ state: 'failed' }],
    },
  ];
}

/** A failed test as Cypress ≤12 reports it: structured per-attempt errors. */
function failedTest12(): SpecResultsLike['tests'] {
  return [
    {
      title: ['login', 'rejects bad credentials'],
      state: 'failed',
      displayError: DISPLAY_ERROR,
      attempts: [
        {
          state: 'failed',
          duration: 4100,
          error: {
            name: 'AssertionError',
            message: 'expected true to equal false',
            stack: DISPLAY_ERROR,
          },
        },
      ],
    },
  ];
}

describe('toFailureContext', () => {
  it('maps titles into test name, full title and suite path', () => {
    const ctx = toFailureContext(spec, {
      title: ['auth', 'login', 'works'],
      state: 'failed',
      displayError: 'Error: nope',
      attempts: [{ state: 'failed' }],
    });

    expect(ctx.testName).toBe('works');
    expect(ctx.fullTitle).toBe('auth > login > works');
    expect(ctx.suitePath).toEqual(['auth', 'login']);
    expect(ctx.filePath).toBe('cypress/e2e/login.cy.ts');
  });

  it('derives a stable id from the spec path and full title', () => {
    const test = failedTest13()?.[0];
    const a = toFailureContext(spec, test ?? {});
    const b = toFailureContext(spec, test ?? {});
    expect(a.id).toBe(
      'cypress/e2e/login.cy.ts::login > rejects bad credentials',
    );
    expect(b.id).toBe(a.id);
  });

  it('parses message, error name and stack from displayError (Cypress 13 shape)', () => {
    const ctx = toFailureContext(spec, failedTest13()?.[0] ?? {});

    expect(ctx.message).toBe(
      'Timed out retrying after 4000ms: expected true to equal false',
    );
    expect(ctx.stack).toBe(DISPLAY_ERROR);
    expect(ctx.error).toEqual(
      expect.objectContaining({ name: 'AssertionError' }),
    );
  });

  it('prefers the last attempt error over displayError (Cypress 12 shape)', () => {
    const ctx = toFailureContext(spec, failedTest12()?.[0] ?? {});

    expect(ctx.message).toBe('expected true to equal false');
    expect(ctx.stack).toBe(DISPLAY_ERROR);
    expect(ctx.error).toEqual(
      expect.objectContaining({ name: 'AssertionError' }),
    );
  });

  it('keeps a plain first line as the message when it has no Name: prefix', () => {
    const ctx = toFailureContext(spec, {
      title: ['t'],
      state: 'failed',
      displayError: 'something exploded\n    at frame',
    });

    expect(ctx.message).toBe('something exploded');
    expect(ctx.error).toEqual(
      expect.objectContaining({ message: 'something exploded' }),
    );
  });

  it('leaves error fields empty when there is no displayError or attempt error', () => {
    const ctx = toFailureContext(spec, {
      title: ['t'],
      state: 'failed',
      displayError: null,
    });

    expect(ctx.message).toBeUndefined();
    expect(ctx.stack).toBeUndefined();
    expect(ctx.error).toBeUndefined();
  });

  it('rounds the test-level duration to whole milliseconds', () => {
    const ctx = toFailureContext(spec, failedTest13()?.[0] ?? {});
    expect(ctx.durationMs).toBe(4124);
  });

  it('falls back to summing attempt durations when the test has none', () => {
    const ctx = toFailureContext(spec, {
      title: ['t'],
      state: 'failed',
      attempts: [
        { state: 'failed', duration: 100.4 },
        { state: 'failed', duration: 200.4 },
      ],
    });
    expect(ctx.durationMs).toBe(301);
  });

  it('leaves durationMs undefined without any duration information', () => {
    const ctx = toFailureContext(spec, { title: ['t'], state: 'failed' });
    expect(ctx.durationMs).toBeUndefined();
  });

  it('counts retries from the attempts and flags passed-after-retry as flaky', () => {
    const retriedFailed = toFailureContext(spec, {
      title: ['t'],
      state: 'failed',
      attempts: [{ state: 'failed' }, { state: 'failed' }, { state: 'failed' }],
    });
    expect(retriedFailed.retry).toBe(2);
    expect(retriedFailed.flaky).toBe(false);

    const flakyPassed = toFailureContext(spec, {
      title: ['t'],
      state: 'passed',
      attempts: [{ state: 'failed' }, { state: 'passed' }],
    });
    expect(flakyPassed.retry).toBe(1);
    expect(flakyPassed.flaky).toBe(true);
  });

  it('handles missing titles and spec info defensively', () => {
    const ctx = toFailureContext(undefined, { state: 'failed' });
    expect(ctx.testName).toBe('unknown test');
    expect(ctx.fullTitle).toBe('unknown test');
    expect(ctx.filePath).toBe('unknown');
  });
});

describe('mapSpecResults', () => {
  it('maps only tests whose final state is failed', () => {
    const results: SpecResultsLike = {
      spec,
      tests: [
        { title: ['passes'], state: 'passed', attempts: [{ state: 'passed' }] },
        ...(failedTest13() ?? []),
        { title: ['skipped'], state: 'pending', attempts: [] },
        // Retried-flaky: failed once, then passed — not a failure.
        {
          title: ['flaky'],
          state: 'passed',
          attempts: [{ state: 'failed' }, { state: 'passed' }],
        },
      ],
    };

    const contexts = mapSpecResults(spec, results);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.testName).toBe('rejects bad credentials');
  });

  it('reports a retried test that never passed, with its retry count', () => {
    const contexts = mapSpecResults(spec, {
      tests: [
        {
          title: ['still failing'],
          state: 'failed',
          displayError: 'Error: nope',
          attempts: [{ state: 'failed' }, { state: 'failed' }],
        },
      ],
    });

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.retry).toBe(1);
  });

  it('falls back to the spec recorded in the results object', () => {
    const contexts = mapSpecResults(undefined, {
      spec,
      tests: failedTest13(),
    });
    expect(contexts[0]?.filePath).toBe('cypress/e2e/login.cy.ts');
  });

  it('returns an empty list for missing or empty results', () => {
    expect(mapSpecResults(spec, undefined)).toEqual([]);
    expect(mapSpecResults(spec, { tests: null })).toEqual([]);
  });
});

describe('mapRunResults', () => {
  it('sweeps failures across all specs of a run', () => {
    const otherSpec = { relative: 'cypress/e2e/cart.cy.ts' };
    const contexts = mapRunResults({
      runs: [
        { spec, tests: failedTest13() },
        {
          spec: otherSpec,
          tests: [
            {
              title: ['cart', 'sums totals'],
              state: 'failed',
              displayError: 'Error: off by one',
              attempts: [{ state: 'failed' }],
            },
            { title: ['cart', 'renders'], state: 'passed', attempts: [] },
          ],
        },
      ],
    });

    expect(contexts).toHaveLength(2);
    expect(contexts.map((ctx) => ctx.filePath)).toEqual([
      'cypress/e2e/login.cy.ts',
      'cypress/e2e/cart.cy.ts',
    ]);
  });

  it('returns an empty list for a failed run without results', () => {
    // Shape of CypressFailedRunResult (the run never started).
    expect(
      mapRunResults({ runs: undefined } as Parameters<typeof mapRunResults>[0]),
    ).toEqual([]);
    expect(mapRunResults(undefined)).toEqual([]);
  });
});
