import { describe, expect, it } from 'vitest';
import { detectProvider } from './index.js';

describe('detectProvider', () => {
  it('returns undefined when no CI markers are present', () => {
    expect(detectProvider({})).toBeUndefined();
  });

  it('detects each provider from its marker variable', () => {
    expect(detectProvider({ GITHUB_ACTIONS: 'true' })?.name).toBe('github');
    expect(detectProvider({ CIRCLECI: 'true' })?.name).toBe('circleci');
    expect(detectProvider({ BUILDKITE: 'true' })?.name).toBe('buildkite');
    expect(detectProvider({ GITLAB_CI: 'true' })?.name).toBe('gitlab');
    expect(detectProvider({ JENKINS_URL: 'https://jenkins.local' })?.name).toBe(
      'jenkins',
    );
  });

  it('falls back to the generic provider when only CI is set', () => {
    expect(detectProvider({ CI: 'true' })?.name).toBe('ci');
  });

  it('prefers a specific provider over the generic CI flag', () => {
    expect(detectProvider({ CI: 'true', GITLAB_CI: 'true' })?.name).toBe(
      'gitlab',
    );
  });

  it('does not treat an empty marker value as active', () => {
    expect(detectProvider({ GITHUB_ACTIONS: '' })).toBeUndefined();
  });
});
