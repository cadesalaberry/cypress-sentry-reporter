import { describe, expect, it } from 'vitest';
import { JenkinsProvider } from './jenkins.js';

describe('JenkinsProvider', () => {
  const env = {
    CI: 'true',
    JENKINS_URL: 'https://jenkins.local',
    BUILD_URL: 'https://jenkins.local/job/1',
    WORKSPACE: '/var/jenkins_home/workspace/widgets',
  };

  it('extracts the build URL and leaves git metadata undefined', () => {
    expect(JenkinsProvider.isActive(env)).toBe(true);
    expect(JenkinsProvider.repository(env)).toBeUndefined();
    expect(JenkinsProvider.branch(env)).toBeUndefined();
    expect(JenkinsProvider.commitSha(env)).toBeUndefined();
    expect(JenkinsProvider.runUrl(env)).toBe('https://jenkins.local/job/1');
    expect(JenkinsProvider.workflowId(env)).toBeUndefined();
  });

  it('exposes the workspace as the checkout root path', () => {
    expect(JenkinsProvider.rootPath(env)).toBe(
      '/var/jenkins_home/workspace/widgets',
    );
  });

  it('snapshots only its own environment keys', () => {
    expect(JenkinsProvider.envSnapshot({ ...env, SECRET: 'x' })).toEqual(env);
  });
});
