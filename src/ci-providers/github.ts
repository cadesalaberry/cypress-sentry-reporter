import type { CIProvider } from './types.js';

export const GitHubActionsProvider: CIProvider = {
  name: 'github',
  isActive: (env) => Boolean(env.GITHUB_ACTIONS),
  repository: (env) => env.GITHUB_REPOSITORY,
  branch: (env) => env.GITHUB_REF_NAME,
  commitSha: (env) => env.GITHUB_SHA,
  runUrl: (env) =>
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : undefined,
  workflowId: (env) => env.GITHUB_RUN_ID,
  rootPath: (env) => env.GITHUB_WORKSPACE,
  envSnapshot: (env) => {
    const keys = [
      'CI',
      'GITHUB_ACTIONS',
      'GITHUB_SERVER_URL',
      'GITHUB_REPOSITORY',
      'GITHUB_RUN_ID',
      'GITHUB_REF_NAME',
      'GITHUB_SHA',
      'GITHUB_WORKSPACE',
    ];
    const out: Record<string, string | undefined> = {};
    for (const k of keys) out[k] = env[k];
    return out;
  },
};
