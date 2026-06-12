import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Event } from '@sentry/node';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
      addAttachment: vi.fn(),
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

function makeFailure(
  overrides: Partial<FailureContext> & { id: string },
): FailureContext {
  return {
    testName: overrides.id,
    fullTitle: overrides.id,
    filePath: 'cypress/e2e/x.cy.ts',
    message: 'boom',
    stack: 'STACK',
    error: { name: 'AssertionError', message: 'boom', stack: 'STACK' },
    durationMs: 1,
    retry: 0,
    flaky: false,
    ...overrides,
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
    addAttachment: vi.fn(),
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

    core.reportFailure(makeFailure({ id: 't1', message: 'bad assertion' }));
    await core.flush();

    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const err = sentry.captureException.mock.calls[0][0] as Error;
    expect(err.message).toBe('bad assertion');
    expect(sentry.flush).toHaveBeenCalledTimes(1);
  });

  it('deduplicates failures sharing the same context id', () => {
    const core = new SentryReporterCore({ dsn: DSN });

    // Same failure delivered twice: once from after:spec, once from the
    // after:run defensive sweep.
    core.reportFailure(makeFailure({ id: 't1' }));
    core.reportFailure(makeFailure({ id: 't1' }));

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('caps reported events at maxEventsPerRun', () => {
    const core = new SentryReporterCore({ dsn: DSN, maxEventsPerRun: 2 });

    for (const n of [1, 2, 3, 4]) {
      core.reportFailure(makeFailure({ id: `t${n}` }));
    }

    expect(sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it('honors the shouldReport predicate', () => {
    const core = new SentryReporterCore({
      dsn: DSN,
      shouldReport: (ctx) => ctx.testName !== 'skip-me',
    });

    core.reportFailure(makeFailure({ id: 'keep-me', testName: 'keep-me' }));
    core.reportFailure(makeFailure({ id: 'skip-me', testName: 'skip-me' }));

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('stays disabled and silent when no DSN is configured', async () => {
    const core = new SentryReporterCore({});

    core.reportFailure(makeFailure({ id: 't1' }));
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

    core.reportFailure(makeFailure({ id: 't1' }));

    expect(setTags).toHaveBeenCalledTimes(1);
    const tags = setTags.mock.calls[0][0] as Record<string, unknown>;
    expect(tags.reporter).toBe('cypress-sentry-reporter');
    expect(typeof tags.trigger).toBe('string');
    expect(['ai', 'bot', 'human']).toContain(tags.actor_type);
    expect(typeof tags.actor_name).toBe('string');
  });

  it('attaches run metadata as browser/test-type tags and a cypress_version extra', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const core = new SentryReporterCore({ dsn: DSN });
    core.setRunMeta({ cypressVersion: '12.17.4', testType: 'e2e' });
    core.setRunMeta({ browserName: 'electron', browserVersion: '106.0' });

    core.reportFailure(makeFailure({ id: 't1' }));

    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        browser_name: 'electron',
        browser_version: '106.0',
        test_type: 'e2e',
      }),
    );
    expect(scope.setExtras.mock.calls[0][0]).toEqual(
      expect.objectContaining({ cypress_version: '12.17.4' }),
    );
  });

  it('merges run metadata without erasing earlier values', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const core = new SentryReporterCore({ dsn: DSN });
    core.setRunMeta({ cypressVersion: '12.17.4', testType: 'e2e' });
    // before:run without browser details must not clear the version.
    core.setRunMeta({ cypressVersion: undefined, browserName: 'chrome' });

    core.reportFailure(makeFailure({ id: 't1' }));

    expect(scope.setExtras.mock.calls[0][0]).toEqual(
      expect.objectContaining({ cypress_version: '12.17.4' }),
    );
    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({ browser_name: 'chrome' }),
    );
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

    core.reportFailure(makeFailure({ id: 't1' }));

    expect(setTags).toHaveBeenCalledTimes(1);
    expect(setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        trigger: 'cron',
        actor_type: 'bot',
        actor_name: 'nightly-canary',
      }),
    );
  });

  it('passes real Error instances through to captureException', () => {
    const realError = new Error('actual failure');
    realError.name = 'AssertionError';
    const core = new SentryReporterCore({ dsn: DSN });

    core.reportFailure(makeFailure({ id: 't1', error: realError }));

    const captured = sentry.captureException.mock.calls[0][0] as Error;
    expect(captured).toBe(realError);
    expect(captured.name).toBe('AssertionError');
  });

  it('synthesizes an error from the test title when the failure has no error', () => {
    const core = new SentryReporterCore({ dsn: DSN });

    core.reportFailure({
      id: 't1',
      testName: 'no error object',
      fullTitle: 'no error object',
    });

    const captured = sentry.captureException.mock.calls[0][0] as Error;
    expect(captured.message).toBe('no error object');
    expect(captured.stack).toBeUndefined();
  });

  it('strips the synthetic stack when the failure has none of its own', () => {
    const core = new SentryReporterCore({ dsn: DSN });

    core.reportFailure({
      id: 't1',
      testName: 'plain failure',
      message: 'plain failure',
      error: { message: 'plain failure' },
    });

    const captured = sentry.captureException.mock.calls[0][0] as Error;
    expect(captured.message).toBe('plain failure');
    expect(captured.stack).toBeUndefined();
  });

  it('copies the error name from serialized error objects', () => {
    const core = new SentryReporterCore({ dsn: DSN });

    core.reportFailure(
      makeFailure({
        id: 't1',
        message: 'boom',
        stack: 'STACK',
        error: { message: 'boom', stack: 'STACK', name: 'TypeError' },
      }),
    );

    const captured = sentry.captureException.mock.calls[0][0] as Error;
    expect(captured.name).toBe('TypeError');
    expect(captured.stack).toBe('STACK');
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

    core.reportFailure(makeFailure({ id: 't1' }));

    expect(scope.setFingerprint).toHaveBeenCalledWith([
      'custom',
      'fingerprint',
    ]);
    expect(scope.setUser).toHaveBeenCalledWith({ id: 'user-1' });
  });

  it('defaults the fingerprint to the cypress-failure triple', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const core = new SentryReporterCore({ dsn: DSN });

    core.reportFailure(
      makeFailure({
        id: 't1',
        filePath: 'cypress/e2e/login.cy.ts',
        testName: 'logs in',
      }),
    );

    expect(scope.setFingerprint).toHaveBeenCalledWith([
      'cypress-failure',
      'cypress/e2e/login.cy.ts',
      'logs in',
    ]);
  });

  it('wires beforeSend as an event processor receiving the failure context', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const beforeSend = vi.fn((event: Event) => event);
    const core = new SentryReporterCore({ dsn: DSN, beforeSend });

    core.reportFailure(makeFailure({ id: 't1', testName: 'wired test' }));

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

    core.reportFailure(makeFailure({ id: 't1' }));

    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('warns and disables itself when enabled without a DSN', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const core = new SentryReporterCore({ enabled: true });

      core.reportFailure(makeFailure({ id: 't1' }));
      core.reportFailure(makeFailure({ id: 't2' }));
      await core.flush();

      expect(sentry.captureException).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('SENTRY_DSN missing'),
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(sentry.flush).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('dryRun initializes with a placeholder DSN, debug and a logging transport', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const core = new SentryReporterCore({ dryRun: true });

      core.reportFailure(makeFailure({ id: 't1' }));

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

  it('does not resolve code owners unless the option is enabled', () => {
    const core = new SentryReporterCore({ dsn: DSN });

    core.reportFailure(makeFailure({ id: 't1' }));

    expect(codeowners.resolveCodeOwners).not.toHaveBeenCalled();
  });

  it('attaches code_owners and code_owner tags when enabled', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    codeowners.resolveCodeOwners.mockReturnValue(['@acme/api', '@alice']);
    const core = new SentryReporterCore({ dsn: DSN, codeowners: true });

    core.reportFailure(makeFailure({ id: 't1' }));

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

  it('prefers the absolute spec path for CODEOWNERS resolution', () => {
    codeowners.resolveCodeOwners.mockReturnValue([]);
    const core = new SentryReporterCore({
      dsn: DSN,
      codeowners: { root: '/repo' },
    });

    core.reportFailure(
      makeFailure({
        id: 't1',
        filePath: 'cypress/e2e/login.cy.ts',
        meta: { absolutePath: '/repo/cypress/e2e/login.cy.ts' },
      }),
    );

    expect(codeowners.resolveCodeOwners).toHaveBeenCalledWith(
      '/repo/cypress/e2e/login.cy.ts',
      '/repo',
    );
  });

  it('omits code owner tags when no owners match', () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    codeowners.resolveCodeOwners.mockReturnValue([]);
    const core = new SentryReporterCore({ dsn: DSN, codeowners: true });

    core.reportFailure(makeFailure({ id: 't1' }));

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

    core.reportFailure(makeFailure({ id: 't1' }));

    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        code_owner: '@platform',
        code_owners: '@platform',
      }),
    );
  });

  describe('screenshot attachments', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csr-shots-'));
    const pngPath = path.join(tmpDir, 'login -- breaks (failed).png');
    const jpgPath = path.join(tmpDir, 'login -- breaks (failed).jpg');
    fs.writeFileSync(pngPath, Buffer.from('png-bytes'));
    fs.writeFileSync(jpgPath, Buffer.from('jpg-bytes'));

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function failureWithShots() {
      return makeFailure({
        id: 't1',
        screenshots: [{ path: pngPath }, { path: jpgPath }],
      });
    }

    it('attaches the failure screenshots by default', () => {
      const scope = makeScope();
      sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
        cb(scope),
      );
      const core = new SentryReporterCore({ dsn: DSN });

      core.reportFailure(failureWithShots());

      expect(scope.addAttachment).toHaveBeenCalledTimes(2);
      expect(scope.addAttachment).toHaveBeenCalledWith({
        filename: 'login -- breaks (failed).png',
        contentType: 'image/png',
        data: Buffer.from('png-bytes'),
      });
      expect(scope.addAttachment).toHaveBeenCalledWith({
        filename: 'login -- breaks (failed).jpg',
        contentType: 'image/jpeg',
        data: Buffer.from('jpg-bytes'),
      });
      expect(sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('lists screenshot metadata in the extras', () => {
      const scope = makeScope();
      sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
        cb(scope),
      );
      const core = new SentryReporterCore({ dsn: DSN });

      core.reportFailure(failureWithShots());

      expect(scope.setExtras.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          screenshots: [{ path: pngPath }, { path: jpgPath }],
        }),
      );
    });

    it('can be disabled with screenshots: false', () => {
      const scope = makeScope();
      sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
        cb(scope),
      );
      const core = new SentryReporterCore({ dsn: DSN, screenshots: false });

      core.reportFailure(failureWithShots());

      expect(scope.addAttachment).not.toHaveBeenCalled();
      // The metadata extra survives so the paths are still discoverable.
      expect(scope.setExtras.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          screenshots: [{ path: pngPath }, { path: jpgPath }],
        }),
      );
      expect(sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('can be disabled with screenshots: { enabled: false }', () => {
      const scope = makeScope();
      sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
        cb(scope),
      );
      const core = new SentryReporterCore({
        dsn: DSN,
        screenshots: { enabled: false },
      });

      core.reportFailure(failureWithShots());

      expect(scope.addAttachment).not.toHaveBeenCalled();
    });

    it('skips screenshots larger than maxBytes but keeps the event', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const scope = makeScope();
        sentry.withScope.mockImplementationOnce(
          (cb: (scope: unknown) => void) => cb(scope),
        );
        const core = new SentryReporterCore({
          dsn: DSN,
          screenshots: { maxBytes: 4 },
        });

        core.reportFailure(failureWithShots());

        expect(scope.addAttachment).not.toHaveBeenCalled();
        expect(sentry.captureException).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('exceeds the 4 byte cap'),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('skips unreadable screenshots but keeps the event', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const scope = makeScope();
        sentry.withScope.mockImplementationOnce(
          (cb: (scope: unknown) => void) => cb(scope),
        );
        const core = new SentryReporterCore({ dsn: DSN });

        core.reportFailure(
          makeFailure({
            id: 't1',
            screenshots: [{ path: path.join(tmpDir, 'missing.png') }],
          }),
        );

        expect(scope.addAttachment).not.toHaveBeenCalled();
        expect(sentry.captureException).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('could not read screenshot'),
          expect.anything(),
        );
      } finally {
        warn.mockRestore();
      }
    });
  });

  it('keeps only the minimal default integrations', () => {
    const core = new SentryReporterCore({ dsn: DSN });

    core.reportFailure(makeFailure({ id: 't1' }));

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
