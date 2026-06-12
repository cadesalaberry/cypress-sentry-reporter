import { BuildkiteProvider } from './buildkite.js';
import { CircleCIProvider } from './circleci.js';
import { GenericCIProvider } from './generic.js';
import { GitHubActionsProvider } from './github.js';
import { GitLabCIProvider } from './gitlab.js';
import { JenkinsProvider } from './jenkins.js';
import type { CIProvider } from './types.js';

const PROVIDERS: CIProvider[] = [
  GitHubActionsProvider,
  CircleCIProvider,
  BuildkiteProvider,
  GitLabCIProvider,
  JenkinsProvider,
  GenericCIProvider,
];

export function detectProvider(env: NodeJS.ProcessEnv): CIProvider | undefined {
  for (const p of PROVIDERS) {
    if (p.isActive(env)) return p;
  }
  return undefined;
}

export type { CIProvider } from './types.js';
export {
  BuildkiteProvider,
  CircleCIProvider,
  GenericCIProvider,
  GitHubActionsProvider,
  GitLabCIProvider,
  JenkinsProvider,
};
