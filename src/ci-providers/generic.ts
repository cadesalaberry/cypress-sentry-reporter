import type { CIProvider } from './types.js';

export const GenericCIProvider: CIProvider = {
  name: 'ci',
  isActive: (env) => Boolean(env.CI),
  repository: (_env) => undefined,
  branch: (_env) => undefined,
  commitSha: (_env) => undefined,
  runUrl: (_env) => undefined,
  workflowId: (_env) => undefined,
  rootPath: (_env) => undefined,
  envSnapshot: (env) => {
    const keys = ['CI'];
    const out: Record<string, string | undefined> = {};
    for (const k of keys) out[k] = env[k];
    return out;
  },
};
