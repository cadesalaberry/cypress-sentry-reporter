import type { CIProvider } from './types.js';

export const GitLabCIProvider: CIProvider = {
  name: 'gitlab',
  isActive: (env) => Boolean(env.GITLAB_CI),
  repository: (env) => env.CI_PROJECT_PATH,
  branch: (env) => env.CI_COMMIT_BRANCH,
  commitSha: (env) => env.CI_COMMIT_SHA,
  runUrl: (_env) => undefined,
  workflowId: (_env) => undefined,
  rootPath: (env) => env.CI_PROJECT_DIR,
  envSnapshot: (env) => {
    const keys = [
      'CI',
      'GITLAB_CI',
      'CI_PROJECT_PATH',
      'CI_COMMIT_BRANCH',
      'CI_COMMIT_SHA',
      'CI_PROJECT_DIR',
    ];
    const out: Record<string, string | undefined> = {};
    for (const k of keys) out[k] = env[k];
    return out;
  },
};
