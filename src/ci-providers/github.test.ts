import { describe, expect, it } from 'vitest';
import { GitHubActionsProvider } from './github.js';

describe('GitHubActionsProvider', () => {
  const env = {
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'acme/widgets',
    GITHUB_RUN_ID: '123',
    GITHUB_REF_NAME: 'main',
    GITHUB_SHA: 'abc123',
    GITHUB_WORKSPACE: '/home/runner/work/widgets/widgets',
  };

  it('extracts repository, branch and commit', () => {
    expect(GitHubActionsProvider.isActive(env)).toBe(true);
    expect(GitHubActionsProvider.repository(env)).toBe('acme/widgets');
    expect(GitHubActionsProvider.branch(env)).toBe('main');
    expect(GitHubActionsProvider.commitSha(env)).toBe('abc123');
    expect(GitHubActionsProvider.workflowId(env)).toBe('123');
  });

  it('exposes the checkout root path', () => {
    expect(GitHubActionsProvider.rootPath(env)).toBe(
      '/home/runner/work/widgets/widgets',
    );
  });

  it('composes the run URL from server, repository and run id', () => {
    expect(GitHubActionsProvider.runUrl(env)).toBe(
      'https://github.com/acme/widgets/actions/runs/123',
    );
  });

  it('returns no run URL when a component is missing', () => {
    const { GITHUB_RUN_ID: _omitted, ...partial } = env;
    expect(GitHubActionsProvider.runUrl(partial)).toBeUndefined();
  });

  it('snapshots only its own environment keys', () => {
    expect(GitHubActionsProvider.envSnapshot({ ...env, SECRET: 'x' })).toEqual(
      env,
    );
  });
});
