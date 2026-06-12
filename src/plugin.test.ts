import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
  captureException: vi.fn(),
  withScope: vi.fn(),
}));

vi.mock('@sentry/node', () => sentry);

// Keep CI/provider detection deterministic and quiet.
vi.mock('./ci-providers/index.js', () => ({
  detectProvider: vi.fn(() => undefined),
}));

import { installSentryReporter } from './plugin.js';
import type {
  CypressPluginConfig,
  CypressSpecResults,
  CypressTestResult,
} from './types.js';

const DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

const CONFIG: CypressPluginConfig = { version: '12.17.4', testingType: 'e2e' };

const failedTest: CypressTestResult = {
  title: ['login', 'shows the form'],
  state: 'failed',
  displayError: 'AssertionError: nope\n    at Context.eval (login.cy.ts:3:5)',
  attempts: [{ state: 'failed', duration: 4000 }],
};

const SPEC = { name: 'login.cy.ts', relative: 'cypress/e2e/login.cy.ts' };
const SPEC_RESULTS: CypressSpecResults = { spec: SPEC, tests: [failedTest] };

type Handler = (...args: unknown[]) => unknown;

/** Fake `setupNodeEvents` registrar capturing one handler per event. */
function makeOn() {
  const handlers = new Map<string, Handler>();
  const on = vi.fn((action: string, handler: Handler) => {
    handlers.set(action, handler);
  });
  return { on, handlers };
}

function makeScope() {
  return {
    setTags: vi.fn(),
    setExtras: vi.fn(),
    setExtra: vi.fn(),
    setContext: vi.fn(),
    setFingerprint: vi.fn(),
    setUser: vi.fn(),
    addEventProcessor: vi.fn(),
  };
}

describe('installSentryReporter', () => {
  beforeEach(() => {
    sentry.init.mockClear();
    sentry.flush.mockClear();
    sentry.captureException.mockClear();
    sentry.withScope.mockReset();
    sentry.withScope.mockImplementation((cb: (scope: unknown) => void) =>
      cb(makeScope()),
    );
    delete process.env.SENTRY_DSN;
  });

  it('registers the three run events and returns the config', () => {
    const { on } = makeOn();
    const config = installSentryReporter(on, CONFIG, { dsn: DSN });

    expect(config).toBe(CONFIG);
    expect(on.mock.calls.map((call) => call[0]).sort()).toEqual([
      'after:run',
      'after:spec',
      'before:run',
    ]);
  });

  it('reports failures from after:spec immediately', () => {
    const { on, handlers } = makeOn();
    installSentryReporter(on, CONFIG, { dsn: DSN });

    handlers.get('after:spec')?.(SPEC, SPEC_RESULTS);

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const err = sentry.captureException.mock.calls[0][0] as Error;
    expect(err.message).toBe('nope');
    expect(err.name).toBe('AssertionError');
  });

  it('does not double-report failures swept again by after:run', async () => {
    const { on, handlers } = makeOn();
    installSentryReporter(on, CONFIG, { dsn: DSN });

    handlers.get('after:spec')?.(SPEC, SPEC_RESULTS);
    await handlers.get('after:run')?.({ runs: [SPEC_RESULTS] });

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('reports failures missed by after:spec during the after:run sweep, then flushes', async () => {
    const { on, handlers } = makeOn();
    installSentryReporter(on, CONFIG, { dsn: DSN });

    await handlers.get('after:run')?.({ runs: [SPEC_RESULTS] });

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.flush).toHaveBeenCalledTimes(1);
  });

  it('tags failures with browser metadata captured from before:run', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementation((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const { on, handlers } = makeOn();
    installSentryReporter(on, CONFIG, { dsn: DSN });

    handlers.get('before:run')?.({
      cypressVersion: '12.17.4',
      browser: { name: 'electron', version: '106.0.5249.51' },
    });
    handlers.get('after:spec')?.(SPEC, SPEC_RESULTS);

    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        reporter: 'cypress-sentry-reporter',
        test_file: 'cypress/e2e/login.cy.ts',
        test_name: 'shows the form',
        test_type: 'e2e',
        browser_name: 'electron',
        browser_version: '106.0.5249.51',
      }),
    );
    expect(scope.setExtras.mock.calls[0][0]).toEqual(
      expect.objectContaining({ cypress_version: '12.17.4' }),
    );
    expect(scope.setFingerprint).toHaveBeenCalledWith([
      'cypress-failure',
      'cypress/e2e/login.cy.ts',
      'shows the form',
    ]);
  });

  it('falls back to the resolved config for the cypress version', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementation((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const { on, handlers } = makeOn();
    installSentryReporter(on, CONFIG, { dsn: DSN });

    // No before:run (e.g. an event Cypress did not deliver).
    handlers.get('after:spec')?.(SPEC, SPEC_RESULTS);

    expect(scope.setExtras.mock.calls[0][0]).toEqual(
      expect.objectContaining({ cypress_version: '12.17.4' }),
    );
  });

  it('does nothing for a spec without failures', async () => {
    const { on, handlers } = makeOn();
    installSentryReporter(on, CONFIG, { dsn: DSN });

    handlers.get('after:spec')?.(SPEC, {
      spec: SPEC,
      tests: [{ title: ['ok'], state: 'passed' }],
    });
    await handlers.get('after:run')?.({ runs: [] });

    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('honors maxEventsPerRun across specs of the same run', () => {
    const { on, handlers } = makeOn();
    installSentryReporter(on, CONFIG, { dsn: DSN, maxEventsPerRun: 1 });

    handlers.get('after:spec')?.(SPEC, SPEC_RESULTS);
    handlers.get('after:spec')?.(
      { relative: 'cypress/e2e/other.cy.ts' },
      {
        tests: [
          { title: ['other', 'breaks'], state: 'failed', displayError: 'x' },
        ],
      },
    );

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
