import { describe, expect, it } from 'vitest';
import { BuildkiteProvider } from './buildkite.js';

describe('BuildkiteProvider', () => {
  const env = {
    CI: 'true',
    BUILDKITE: 'true',
    BUILDKITE_BUILD_URL: 'https://buildkite.com/build/1',
    BUILDKITE_BRANCH: 'main',
    BUILDKITE_COMMIT: 'abc123',
    BUILDKITE_PIPELINE_ID: 'pipe-1',
    BUILDKITE_BUILD_CHECKOUT_PATH: '/buildkite/builds/agent/acme/widgets',
  };

  it('extracts run metadata from BUILDKITE_* variables', () => {
    expect(BuildkiteProvider.isActive(env)).toBe(true);
    expect(BuildkiteProvider.repository(env)).toBeUndefined();
    expect(BuildkiteProvider.branch(env)).toBe('main');
    expect(BuildkiteProvider.commitSha(env)).toBe('abc123');
    expect(BuildkiteProvider.runUrl(env)).toBe('https://buildkite.com/build/1');
    expect(BuildkiteProvider.workflowId(env)).toBe('pipe-1');
  });

  it('exposes the checkout path as the root path', () => {
    expect(BuildkiteProvider.rootPath(env)).toBe(
      '/buildkite/builds/agent/acme/widgets',
    );
  });

  it('snapshots only its own environment keys', () => {
    expect(BuildkiteProvider.envSnapshot({ ...env, SECRET: 'x' })).toEqual(env);
  });
});
