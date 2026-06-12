import { describe, expect, it } from 'vitest';
import { GitLabCIProvider } from './gitlab.js';

describe('GitLabCIProvider', () => {
  const env = {
    CI: 'true',
    GITLAB_CI: 'true',
    CI_PROJECT_PATH: 'acme/widgets',
    CI_COMMIT_BRANCH: 'main',
    CI_COMMIT_SHA: 'abc123',
    CI_PROJECT_DIR: '/builds/acme/widgets',
  };

  it('extracts run metadata from GitLab variables', () => {
    expect(GitLabCIProvider.isActive(env)).toBe(true);
    expect(GitLabCIProvider.repository(env)).toBe('acme/widgets');
    expect(GitLabCIProvider.branch(env)).toBe('main');
    expect(GitLabCIProvider.commitSha(env)).toBe('abc123');
    expect(GitLabCIProvider.runUrl(env)).toBeUndefined();
    expect(GitLabCIProvider.workflowId(env)).toBeUndefined();
  });

  it('exposes the project directory as the checkout root path', () => {
    expect(GitLabCIProvider.rootPath(env)).toBe('/builds/acme/widgets');
  });

  it('snapshots only its own environment keys', () => {
    expect(GitLabCIProvider.envSnapshot({ ...env, SECRET: 'x' })).toEqual(env);
  });
});
