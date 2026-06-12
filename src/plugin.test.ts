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

import { registerCypressSentryReporter } from './plugin.js';

const DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

type Handler = (...args: unknown[]) => unknown;

/** Fake `setupNodeEvents` registrar capturing one handler per event. */
function makeOn() {
  const handlers = new Map<string, Handler>();
  const on = ((event: string, handler: Handler) => {
    handlers.set(event, handler);
  }) as unknown as Cypress.PluginEvents;
  return { on, handlers };
}

const config = { testingType: 'e2e' } as Cypress.PluginConfigOptions;

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

const failedSpecResults = {
  tests: [
    {
      title: ['login', 'rejects bad credentials'],
      state: 'failed',
      displayError: 'AssertionError: expected true to equal false',
      attempts: [{ state: 'failed' }],
    },
  ],
};

const spec = { relative: 'cypress/e2e/login.cy.ts' };

describe('registerCypressSentryReporter', () => {
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

  it('registers the before:run, after:spec and after:run handlers and returns the config', () => {
    const { on, handlers } = makeOn();

    const returned = registerCypressSentryReporter(on, config, { dsn: DSN });

    expect(returned).toBe(config);
    expect([...handlers.keys()].sort()).toEqual([
      'after:run',
      'after:spec',
      'before:run',
    ]);
  });

  it('reports each failed test from after:spec', () => {
    const { on, handlers } = makeOn();
    registerCypressSentryReporter(on, config, { dsn: DSN });

    handlers.get('after:spec')?.(spec, failedSpecResults);

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const err = sentry.captureException.mock.calls[0][0] as Error;
    expect(err.message).toBe('expected true to equal false');
  });

  it('tags failures with browser metadata captured in before:run', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementation((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const { on, handlers } = makeOn();
    registerCypressSentryReporter(on, config, { dsn: DSN });

    handlers.get('before:run')?.({
      browser: { name: 'electron', version: '118.0.0' },
      cypressVersion: '12.17.4',
    });
    handlers.get('after:spec')?.(spec, failedSpecResults);

    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        browser_name: 'electron',
        browser_version: '118.0.0',
        test_type: 'e2e',
        test_file: 'cypress/e2e/login.cy.ts',
      }),
    );
    expect(scope.setExtras).toHaveBeenCalledWith(
      expect.objectContaining({ cypress_version: '12.17.4' }),
    );
  });

  it('does not double-report failures swept again in after:run, and flushes', async () => {
    const { on, handlers } = makeOn();
    registerCypressSentryReporter(on, config, { dsn: DSN });

    handlers.get('after:spec')?.(spec, failedSpecResults);
    await handlers.get('after:run')?.({
      runs: [{ spec, ...failedSpecResults }],
    });

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.flush).toHaveBeenCalledTimes(1);
  });

  it('reports failures seen only by the after:run sweep', async () => {
    const { on, handlers } = makeOn();
    registerCypressSentryReporter(on, config, { dsn: DSN });

    await handlers.get('after:run')?.({
      runs: [{ spec, ...failedSpecResults }],
    });

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('survives a failed-run result without per-spec results', async () => {
    const { on, handlers } = makeOn();
    registerCypressSentryReporter(on, config, { dsn: DSN });

    await handlers.get('after:run')?.({
      status: 'failed',
      failures: 1,
      message: 'Could not find browser',
    });

    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('stays inert without a DSN', async () => {
    const { on, handlers } = makeOn();
    registerCypressSentryReporter(on, config, {});

    handlers.get('after:spec')?.(spec, failedSpecResults);
    await handlers.get('after:run')?.({ runs: [] });

    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.flush).not.toHaveBeenCalled();
  });
});
