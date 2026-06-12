import { describe, expect, it } from 'vitest';
import { ACTOR_DETECTORS, detectActor, parseActorType } from './index.js';

describe('actor-detectors', () => {
  it('defaults to a human actor when no marker is present', () => {
    expect(detectActor({})).toEqual({ type: 'human', name: 'human' });
  });

  it('treats a regular CI actor login as a human', () => {
    expect(detectActor({ GITHUB_ACTOR: 'octocat' })).toEqual({
      type: 'human',
      name: 'human',
    });
  });

  it.each([
    [{ CLAUDECODE: '1' }, 'claude-code'],
    [{ CLAUDE_CODE_ENTRYPOINT: 'cli' }, 'claude-code'],
    [{ CURSOR_AGENT: '1' }, 'cursor'],
    [{ GITHUB_ACTOR: 'copilot-swe-agent[bot]' }, 'github-copilot'],
    [{ CODEX_SANDBOX: 'seatbelt' }, 'openai-codex'],
    [{ GEMINI_CLI: '1' }, 'gemini-cli'],
    [{ OPENCODE: '1' }, 'opencode'],
  ] as Array<
    [NodeJS.ProcessEnv, string]
  >)('detects the AI agent from its markers: %o', (env, name) => {
    expect(detectActor(env)).toEqual({ type: 'ai', name });
  });

  it.each([
    [{ GITHUB_ACTOR: 'dependabot[bot]' }, 'dependabot'],
    [{ RENOVATE_VERSION: '39.0.0' }, 'renovate'],
    [{ GITLAB_USER_LOGIN: 'renovate[bot]' }, 'renovate'],
  ] as Array<
    [NodeJS.ProcessEnv, string]
  >)('detects known automation bots: %o', (env, name) => {
    expect(detectActor(env)).toEqual({ type: 'bot', name });
  });

  it('falls back to the generic AI_AGENT/AGENT conventions', () => {
    expect(detectActor({ AI_AGENT: 'my-internal-agent' })).toEqual({
      type: 'ai',
      name: 'my-internal-agent',
    });
    expect(detectActor({ AGENT: 'amp' })).toEqual({ type: 'ai', name: 'amp' });
  });

  it('prefers a specific detector over the generic convention', () => {
    const env = { CLAUDECODE: '1', AI_AGENT: 'claude-code_2-1-170_agent' };
    expect(detectActor(env)).toEqual({ type: 'ai', name: 'claude-code' });
  });

  it('classifies unknown [bot] logins as bots, stripping the suffix', () => {
    expect(detectActor({ GITHUB_ACTOR: 'release-please[bot]' })).toEqual({
      type: 'bot',
      name: 'release-please',
    });
  });

  it('classifies GitLab project/group token logins as bots', () => {
    expect(detectActor({ GITLAB_USER_LOGIN: 'project_42_bot_abcd' })).toEqual({
      type: 'bot',
      name: 'project_42_bot_abcd',
    });
  });

  it('lets manual markers override any detection', () => {
    const env = {
      CLAUDECODE: '1',
      CYPRESS_SENTRY_ACTOR_TYPE: 'bot',
      CYPRESS_SENTRY_ACTOR_NAME: 'nightly-canary',
    };
    expect(detectActor(env)).toEqual({ type: 'bot', name: 'nightly-canary' });
  });

  it('supports overriding only the actor name', () => {
    const env = { CLAUDECODE: '1', CYPRESS_SENTRY_ACTOR_NAME: 'claude-opus' };
    expect(detectActor(env)).toEqual({ type: 'ai', name: 'claude-opus' });
  });

  it('ignores invalid or empty manual markers', () => {
    const env = {
      CURSOR_AGENT: '1',
      CYPRESS_SENTRY_ACTOR_TYPE: 'robot',
      CYPRESS_SENTRY_ACTOR_NAME: '  ',
    };
    expect(detectActor(env)).toEqual({ type: 'ai', name: 'cursor' });
  });

  it('parseActorType normalizes case and whitespace', () => {
    expect(parseActorType(' AI ')).toBe('ai');
    expect(parseActorType('Human')).toBe('human');
    expect(parseActorType('robot')).toBeUndefined();
    expect(parseActorType(undefined)).toBeUndefined();
  });

  it('every registered detector declares a name and a valid type', () => {
    expect(ACTOR_DETECTORS.length).toBeGreaterThan(0);
    for (const detector of ACTOR_DETECTORS) {
      expect(detector.name.length).toBeGreaterThan(0);
      expect(['ai', 'bot', 'human']).toContain(detector.type);
    }
  });
});
