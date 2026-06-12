import type { CIProvider } from './types.js';

export const BuildkiteProvider: CIProvider = {
  name: 'buildkite',
  isActive: (env) => Boolean(env.BUILDKITE),
  repository: (_env) => undefined,
  branch: (env) => env.BUILDKITE_BRANCH,
  commitSha: (env) => env.BUILDKITE_COMMIT,
  runUrl: (env) => env.BUILDKITE_BUILD_URL,
  workflowId: (env) => env.BUILDKITE_PIPELINE_ID,
  rootPath: (env) => env.BUILDKITE_BUILD_CHECKOUT_PATH,
  envSnapshot: (env) => {
    const keys = [
      'CI',
      'BUILDKITE',
      'BUILDKITE_BUILD_URL',
      'BUILDKITE_BRANCH',
      'BUILDKITE_COMMIT',
      'BUILDKITE_PIPELINE_ID',
      'BUILDKITE_BUILD_CHECKOUT_PATH',
    ];
    const out: Record<string, string | undefined> = {};
    for (const k of keys) out[k] = env[k];
    return out;
  },
};
