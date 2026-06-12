import type { Event } from '@sentry/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
  captureException: vi.fn(),
  withScope: vi.fn((cb: (scope: unknown) => void) =>
    cb({
      setTags: vi.fn(),
      setExtras: vi.fn(),
      setExtra: vi.fn(),
      setContext: vi.fn(),
      setFingerprint: vi.fn(),
      setUser: vi.fn(),
      addEventProcessor: vi.fn(),
    }),
  ),
}));

vi.mock('@sentry/node', () => sentry);

// Keep CI/provider detection deterministic and quiet.
vi.mock('./ci-providers/index.js', () => ({
  detectProvider: vi.fn(() => undefined),
}));

// Control CODEOWNERS resolution without touching the filesystem.
const codeowners = vi.hoisted(() => ({
  resolveCodeOwners: vi.fn((): string[] => []),
}));
vi.mock('./codeowners/index.js', () => codeowners);

import { SentryReporterCore } from './core.js';
import { makeDryRunTransport } from './dry-run-transport.js';
import type { FailureContext } from './types.js';

const DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

function makeCtx(opts: {
  id: string;
  name?: string;
  message?: string;
  error?: unknown;
  stack?: string;
}): FailureContext {
  const error =
    'error' in opts
      ? opts.error
      : { message: opts.message ?? 'boom', stack: opts.stack ?? 'STACK' };
  return {
    id: opts.id,
    filePath: 'cypress/e2e/x.cy.ts',
    testName: opts.name ?? opts.id,
    fullTitle: opts.name ?? opts.id,
    suitePath: [],
    message:
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : undefined,
    stack:
      error && typeof error === 'object' && 'stack' in error
        ? ((error as { stack?: string }).stack ?? undefined)
        : undefined,
    error,
    durationMs: 1,
    retry: 0,
    flaky: false,
  };
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

describe('SentryReporterCore', () => {
  beforeEach(() => {
    sentry.init.mockClear();
    sentry.flush.mockClear();
    sentry.captureException.mockClear();
    sentry.withScope.mockClear();
    codeowners.resolveCodeOwners.mockReset();
    codeowners.resolveCodeOwners.mockReturnValue([]);
    delete process.env.SENTRY_DSN;
    delete process.env.SENTRY_ENVIRONMENT;
    delete process.env.SENTRY_RELEASE;
  });

  it('reports one event per failure and flushes once', async () => {
    const core = new SentryReporterCore({ dsn: DSN });

    expect(core.report(makeCtx({ id: 't1', message: 'bad assertion' }))).toBe(
      true,
    );
    await core.flush();

    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const err = sentry.captureException.mock.calls[0][0] as Error;
    expect(err.message).toBe('bad assertion');
    expect(sentry.flush).toHaveBeenCalledTimes(1);
  });

  it('does not double-report a failure with the same id', () => {
    const core = new SentryReporterCore({ dsn: DSN });

    expect(core.report(makeCtx({ id: 't1' }))).toBe(true);
    expect(core.report(makeCtx({ id: 't1' }))).toBe(false);

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('caps reported events at maxEventsPerRun', () => {
    const core = new SentryReporterCore({ dsn: DSN, maxEventsPerRun: 2 });

    for (const n of [1, 2, 3, 4]) core.report(makeCtx({ id: `t${n}` }));

    expect(sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it('honors the shouldReport predicate', () => {
    const core = new SentryReporterCore({
      dsn: DSN,
      shouldReport: (ctx) => ctx.testName !== 'skip-me',
    });

    expect(core.report(makeCtx({ id: 't1', name: 'keep-me' }))).toBe(true);
    expect(core.report(makeCtx({ id: 't2', name: 'skip-me' }))).toBe(false);

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('stays disabled and silent when no DSN is configured', async () => {
    delete process.env.SENTRY_DSN;
    const core = new SentryReporterCore({});

    expect(core.report(makeCtx({ id: 't1' }))).toBe(false);
    await core.flush();

    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.flush).not.toHaveBeenCalled();
  });

  it('reports detected trigger and actor tags on every failure', () => {
    const setTags = vi.fn();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb({ ...makeScope(), setTags }),
    );
    const core = new SentryReporterCore({ dsn: DSN });

    core.report(makeCtx({ id: 't1' }));

    expect(setTags).toHaveBeenCalledTimes(1);
    const tags = setTags.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof tags.trigger).toBe('string');
    expect(['ai', 'bot', 'human']).toContain(tags.actor_type);
    expect(typeof tags.actor_name).toBe('string');
  });

  it('lets manually specified tags override detected trigger/actor markers', () => {
    const setTags = vi.fn();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb({ ...makeScope(), setTags }),
    );
    const core = new SentryReporterCore({
      dsn: DSN,
      tags: { trigger: 'cron', actor_type: 'bot' },
      getTags: () => ({ actor_name: 'nightly-canary' }),
    });

    core.report(makeCtx({ id: 't1' }));

    expect(setTags).toHaveBeenCalledTimes(1);
    expect(setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        trigger: 'cron',
        actor_type: 'bot',
        actor_name: 'nightly-canary',
      }),
    );
  });

  it('attaches run metadata as browser/test-type tags and a cypress_version extra', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const core = new SentryReporterCore({ dsn: DSN });
    core.setRunMeta({ testType: 'e2e' });
    core.setRunMeta({
      browserName: 'electron',
      browserVersion: '118.0.0',
      cypressVersion: '12.17.4',
    });

    core.report(makeCtx({ id: 't1' }));

    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        browser_name: 'electron',
        browser_version: '118.0.0',
        test_type: 'e2e',
      }),
    );
    expect(scope.setExtras).toHaveBeenCalledWith(
      expect.objectContaining({ cypress_version: '12.17.4' }),
    );
  });

  it('omits browser tags when no run metadata was captured', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const core = new SentryReporterCore({ dsn: DSN });

    core.report(makeCtx({ id: 't1' }));

    const tags = scope.setTags.mock.calls[0][0] as Record<string, unknown>;
    expect(tags).not.toHaveProperty('browser_name');
    expect(tags).not.toHaveProperty('browser_version');
    expect(tags).not.toHaveProperty('test_type');
  });

  it('passes real Error instances through to captureException', () => {
    const realError = new Error('actual failure');
    realError.name = 'AssertionError';
    const core = new SentryReporterCore({ dsn: DSN });

    core.report(makeCtx({ id: 't1', error: realError }));

    const captured = sentry.captureException.mock.calls[0][0] as Error;
    expect(captured).toBe(realError);
    expect(captured.name).toBe('AssertionError');
  });

  it('synthesizes an error from the test title when the failure has no error', () => {
    const core = new SentryReporterCore({ dsn: DSN });
    const ctx: FailureContext = {
      id: 't1',
      testName: 'no error object',
      fullTitle: 'no error object',
    };

    core.report(ctx);

    const captured = sentry.captureException.mock.calls[0][0] as Error;
    expect(captured.message).toBe('no error object');
    expect(captured.stack).toBeUndefined();
  });

  it('keeps an Error instance untouched when it lacks a stack', () => {
    const realError = new Error('stackless');
    realError.stack = undefined;
    const core = new SentryReporterCore({ dsn: DSN });

    core.report(makeCtx({ id: 't1', error: realError }));

    expect(sentry.captureException.mock.calls[0][0]).toBe(realError);
  });

  it('strips the synthetic stack when the failure has none of its own', () => {
    const core = new SentryReporterCore({ dsn: DSN });
    const ctx: FailureContext = {
      id: 't1',
      testName: 't1',
      message: 'plain failure',
      error: { message: 'plain failure' },
    };

    core.report(ctx);

    const captured = sentry.captureException.mock.calls[0][0] as Error;
    expect(captured.message).toBe('plain failure');
    expect(captured.stack).toBeUndefined();
  });

  it('copies the error name from serialized error objects', () => {
    const core = new SentryReporterCore({ dsn: DSN });
    const ctx: FailureContext = {
      id: 't1',
      testName: 't1',
      message: 'boom',
      stack: 'STACK',
      error: { message: 'boom', stack: 'STACK', name: 'TypeError' },
    };

    core.report(ctx);

    const captured = sentry.captureException.mock.calls[0][0] as Error;
    expect(captured.name).toBe('TypeError');
    expect(captured.stack).toBe('STACK');
  });

  it('uses the cypress-failure fingerprint by default', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const core = new SentryReporterCore({ dsn: DSN });

    core.report(makeCtx({ id: 't1', name: 'a test' }));

    expect(scope.setFingerprint).toHaveBeenCalledWith([
      'cypress-failure',
      'cypress/e2e/x.cy.ts',
      'a test',
    ]);
  });

  it('applies custom fingerprint and user from the options', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const core = new SentryReporterCore({
      dsn: DSN,
      getFingerprint: () => ['custom', 'fingerprint'],
      getUser: () => ({ id: 'user-1' }),
    });

    core.report(makeCtx({ id: 't1' }));

    expect(scope.setFingerprint).toHaveBeenCalledWith([
      'custom',
      'fingerprint',
    ]);
    expect(scope.setUser).toHaveBeenCalledWith({ id: 'user-1' });
  });

  it('wires beforeSend as an event processor receiving the failure context', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const beforeSend = vi.fn((event: Event) => event);
    const core = new SentryReporterCore({ dsn: DSN, beforeSend });

    core.report(makeCtx({ id: 't1', name: 'wired test' }));

    expect(scope.addEventProcessor).toHaveBeenCalledTimes(1);
    const processor = scope.addEventProcessor.mock.calls[0][0] as (
      event: unknown,
      hint: unknown,
    ) => unknown;
    const event = { event_id: 'e1' };
    const hint = { originalException: 'x' };
    expect(processor(event, hint)).toBe(event);
    expect(beforeSend).toHaveBeenCalledWith(
      event,
      hint,
      expect.objectContaining({ testName: 'wired test' }),
    );
  });

  it('stays disabled when enabled is explicitly false', () => {
    const core = new SentryReporterCore({ dsn: DSN, enabled: false });

    expect(core.report(makeCtx({ id: 't1' }))).toBe(false);

    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('warns and disables itself when enabled without a DSN', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const core = new SentryReporterCore({ enabled: true });

      core.report(makeCtx({ id: 't1' }));
      await core.flush();

      expect(sentry.init).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('SENTRY_DSN missing'),
      );
      expect(sentry.flush).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('dryRun initializes with a placeholder DSN, debug and a logging transport', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const core = new SentryReporterCore({ dryRun: true });

      core.report(makeCtx({ id: 't1' }));

      expect(sentry.init).toHaveBeenCalledTimes(1);
      const options = sentry.init.mock.calls[0][0] as {
        dsn: string;
        debug: boolean;
        tracesSampleRate: number;
        transport: unknown;
      };
      expect(options.dsn).toBe(
        'https://examplePublicKey@o0.ingest.sentry.io/0',
      );
      expect(options.debug).toBe(true);
      expect(options.tracesSampleRate).toBe(0);
      expect(options.transport).toBe(makeDryRunTransport);
      expect(sentry.captureException).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it('passes serverName through to the Sentry init options', () => {
    const core = new SentryReporterCore({ dsn: DSN, serverName: 'ci-runner' });

    core.report(makeCtx({ id: 't1' }));

    expect(sentry.init.mock.calls[0][0]).toEqual(
      expect.objectContaining({ serverName: 'ci-runner' }),
    );
  });

  it('does not resolve code owners unless the option is enabled', () => {
    const core = new SentryReporterCore({ dsn: DSN });

    core.report(makeCtx({ id: 't1' }));

    expect(codeowners.resolveCodeOwners).not.toHaveBeenCalled();
  });

  it('attaches code_owners and code_owner tags when enabled', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    codeowners.resolveCodeOwners.mockReturnValue(['@acme/api', '@alice']);
    const core = new SentryReporterCore({ dsn: DSN, codeowners: true });

    core.report(makeCtx({ id: 't1' }));

    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        code_owners: '@acme/api,@alice',
        code_owner: '@acme/api',
      }),
    );
    expect(scope.setExtra).toHaveBeenCalledWith('code_owners', [
      '@acme/api',
      '@alice',
    ]);
  });

  it('omits code owner tags when no owners match', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    codeowners.resolveCodeOwners.mockReturnValue([]);
    const core = new SentryReporterCore({ dsn: DSN, codeowners: true });

    core.report(makeCtx({ id: 't1' }));

    const tags = scope.setTags.mock.calls[0][0] as Record<string, unknown>;
    expect(tags).not.toHaveProperty('code_owners');
    expect(tags).not.toHaveProperty('code_owner');
    expect(scope.setExtra).not.toHaveBeenCalled();
  });

  it('lets manually specified tags override resolved code owners', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    codeowners.resolveCodeOwners.mockReturnValue(['@acme/api']);
    const core = new SentryReporterCore({
      dsn: DSN,
      codeowners: true,
      getTags: () => ({ code_owner: '@platform', code_owners: '@platform' }),
    });

    core.report(makeCtx({ id: 't1' }));

    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        code_owner: '@platform',
        code_owners: '@platform',
      }),
    );
  });

  it('keeps only the minimal default integrations', () => {
    const core = new SentryReporterCore({ dsn: DSN });

    core.report(makeCtx({ id: 't1' }));

    const options = sentry.init.mock.calls[0][0] as {
      integrations: (defaults: Array<{ name: string }>) => Array<{
        name: string;
      }>;
    };
    const kept = options.integrations([
      { name: 'InboundFilters' },
      { name: 'Http' },
      { name: 'ContextLines' },
      { name: 'OnUncaughtException' },
    ]);
    expect(kept.map((integration) => integration.name)).toEqual([
      'InboundFilters',
      'ContextLines',
    ]);
  });
});
