import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock CI provider and OS to keep tests deterministic
vi.mock('./ci-providers/index.js', () => {
  return { detectProvider: vi.fn() };
});

vi.mock('os', () => {
  return {
    platform: () => 'darwin',
    release: () => '24.0.0',
    homedir: () => osState.home,
  };
});

// Mutable home directory for `os.homedir()`, overridable per test.
const osState = vi.hoisted(() => ({ home: '/home/test' }));

import {
  baseTags,
  branch,
  ciProvider,
  cleanRecord,
  commitSha,
  detectTrigger,
  extras,
  inferEnvironment,
  repoRoot,
  repository,
  toErrorMessage,
  toStack,
} from './utils';

type AnyFn = (...args: unknown[]) => unknown;

async function getDetectProviderMock(): Promise<AnyFn> {
  const mod = await import('./ci-providers/index.js');
  return mod.detectProvider as unknown as AnyFn;
}

describe('utils', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.CI;
    delete process.env.NODE_ENV;
    delete process.env.CYPRESS_SENTRY_TRIGGER;
    delete process.env.CYPRESS_SENTRY_ACTOR_TYPE;
    delete process.env.CYPRESS_SENTRY_ACTOR_NAME;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('toErrorMessage returns expected strings', () => {
    expect(toErrorMessage(undefined)).toBeUndefined();
    expect(toErrorMessage('oops')).toBe('oops');
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
    expect(toErrorMessage({ name: 'TypeError' })).toBe('TypeError');
    expect(toErrorMessage({})).toBe('Error');
  });

  it('toStack extracts stack string', () => {
    const e = new Error('x');
    expect(typeof toStack(e)).toBe('string');
    expect(toStack({})).toBeUndefined();
    expect(toStack(undefined)).toBeUndefined();
  });

  it('cleanRecord drops nullish values and stringifies objects', () => {
    const input = {
      a: 1,
      b: null,
      c: undefined,
      d: { x: true },
      e: 'ok',
      f: false,
    } as Record<string, unknown>;
    const out = cleanRecord(input);
    expect(out).toEqual({
      a: 1,
      d: JSON.stringify({ x: true }),
      e: 'ok',
      f: false,
    });
  });

  it('ciProvider and repo info come from provider when available', async () => {
    const detect = await getDetectProviderMock();
    const provider = {
      name: 'github',
      repository: () => 'acme/widgets',
      branch: () => 'main',
      commitSha: () => 'abc123',
      envSnapshot: () => ({ CI: 'true', FOO: 'BAR' }),
    };
    (detect as any).mockReturnValue(provider);

    expect(ciProvider()).toBe('github');
    expect(repository()).toBe('acme/widgets');
    expect(branch()).toBe('main');
    expect(commitSha()).toBe('abc123');
  });

  it('ciProvider falls back to "ci" when CI env set and no provider', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue(undefined);
    process.env.CI = 'true';
    expect(ciProvider()).toBe('ci');
  });

  it('inferEnvironment returns "ci" when provider exists, else NODE_ENV or local', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue({ name: 'whatever' });
    expect(inferEnvironment()).toBe('ci');

    (detect as any).mockReturnValue(undefined);
    process.env.NODE_ENV = 'test';
    expect(inferEnvironment()).toBe('test');

    delete process.env.NODE_ENV;
    expect(inferEnvironment()).toBe('local');
  });

  it('detectTrigger returns "ci" when a provider is detected', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue({ name: 'github' });
    expect(detectTrigger({})).toBe('ci');
  });

  it('detectTrigger returns "ci" when only the CI env flag is set', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue(undefined);
    expect(detectTrigger({ CI: 'true' })).toBe('ci');
  });

  it('detectTrigger returns "manual" outside CI', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue(undefined);
    expect(detectTrigger({})).toBe('manual');
  });

  it('detectTrigger honors the manual CYPRESS_SENTRY_TRIGGER marker', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue({ name: 'github' });
    expect(detectTrigger({ CYPRESS_SENTRY_TRIGGER: 'cron' })).toBe('cron');
  });

  it('baseTags includes platform, CI and repo fields', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue({
      name: 'github',
      repository: () => 'acme/widgets',
      branch: () => 'main',
      commitSha: () => 'abc123',
    });

    const ctx = {
      testName: 't',
      filePath: 'cypress/e2e/x.cy.ts',
      fullTitle: 'full',
      flaky: true,
      retry: 2,
    } as import('./types').FailureContext;
    const tags = baseTags(ctx);
    expect(tags).toEqual(
      expect.objectContaining({
        reporter: 'cypress-sentry-reporter',
        test_file: 'cypress/e2e/x.cy.ts',
        test_name: 't',
        test_full_title: 'full',
        flaky: 'true',
        retry: 2,
        os_platform: 'darwin',
        os_release: '24.0.0',
        ci: 'github',
        repository: 'acme/widgets',
        branch: 'main',
        commit_sha: 'abc123',
      }),
    );
  });

  it('baseTags classifies the trigger and the actor of the run', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue(undefined);

    const ctx = { testName: 't' } as import('./types').FailureContext;
    const tags = baseTags(ctx);
    // Values depend on the environment the suite runs in (CI, agent, ...),
    // so assert membership rather than exact values.
    expect(['ci', 'manual']).toContain(tags.trigger);
    expect(['ai', 'bot', 'human']).toContain(tags.actor_type);
    expect(typeof tags.actor_name).toBe('string');
    expect((tags.actor_name as string).length).toBeGreaterThan(0);
  });

  it('baseTags honors manually specified trigger and actor markers', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue(undefined);
    process.env.CYPRESS_SENTRY_TRIGGER = 'cron';
    process.env.CYPRESS_SENTRY_ACTOR_TYPE = 'bot';
    process.env.CYPRESS_SENTRY_ACTOR_NAME = 'nightly-canary';

    const ctx = { testName: 't' } as import('./types').FailureContext;
    const tags = baseTags(ctx);
    expect(tags).toEqual(
      expect.objectContaining({
        trigger: 'cron',
        actor_type: 'bot',
        actor_name: 'nightly-canary',
      }),
    );
  });

  it('extras returns duration/logs/suite path and env snapshot', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue({
      name: 'github',
      envSnapshot: () => ({ CI: 'true', GIT: '1' }),
    });

    const ctx = {
      testName: 't',
      durationMs: 50,
      logs: ['a'],
      suitePath: ['s'],
    } as import('./types').FailureContext;

    const ex = extras(ctx);
    expect(ex).toEqual(
      expect.objectContaining({
        duration_ms: 50,
        logs: ['a'],
        suite_path: ['s'],
      }),
    );
    expect((ex as any).env).toEqual({ CI: 'true', GIT: '1' });
  });

  it('extras snapshots the bare CI flag when no provider is detected', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue(undefined);
    process.env.CI = 'true';

    const ctx = { testName: 't' } as import('./types').FailureContext;
    expect((extras(ctx) as any).env).toEqual({ CI: 'true' });
  });

  it('extras returns an empty env snapshot outside CI', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue(undefined);

    const ctx = { testName: 't' } as import('./types').FailureContext;
    expect((extras(ctx) as any).env).toEqual({});
  });

  it('repoRoot returns the provider checkout path when it exists', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue({ rootPath: () => process.cwd() });
    expect(repoRoot()).toBe(process.cwd());
  });

  it('repoRoot expands a leading ~ to the home directory', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue({ rootPath: () => '~' });
    osState.home = process.cwd();
    expect(repoRoot()).toBe(process.cwd());
  });

  it('repoRoot falls back to cwd when the provider path is missing on disk', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue({
      rootPath: () => '/no/such/directory-xyz',
    });
    expect(repoRoot()).toBe(process.cwd());
  });

  it('repoRoot falls back to cwd when no provider is detected', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue(undefined);
    expect(repoRoot()).toBe(process.cwd());
  });
});
