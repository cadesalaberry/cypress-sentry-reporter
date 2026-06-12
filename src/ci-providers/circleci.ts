import type { CIProvider } from './types.js';

export const CircleCIProvider: CIProvider = {
  name: 'circleci',
  isActive: (env) => Boolean(env.CIRCLECI),
  repository: (env) => env.CIRCLE_PROJECT_REPONAME,
  branch: (env) => env.CIRCLE_BRANCH,
  commitSha: (env) => env.CIRCLE_SHA1,
  runUrl: (env) => env.CIRCLE_BUILD_URL,
  workflowId: (env) => env.CIRCLE_WORKFLOW_ID,
  rootPath: (env) => env.CIRCLE_WORKING_DIRECTORY,
  envSnapshot: (env) => {
    const keys = [
      'CI',
      'CIRCLECI',
      'CIRCLE_WORKFLOW_ID',
      'CIRCLE_BUILD_URL',
      'CIRCLE_BRANCH',
      'CIRCLE_SHA1',
      'CIRCLE_PROJECT_REPONAME',
      'CIRCLE_WORKING_DIRECTORY',
    ];
    const out: Record<string, string | undefined> = {};
    for (const k of keys) out[k] = env[k];
    return out;
  },
};
