import type { ActorDetector, ActorInfo, ActorType } from './types.js';

/** Marker to manually pin the reported `actor_type` (`ai`, `bot` or `human`). */
export const ACTOR_TYPE_ENV = 'CYPRESS_SENTRY_ACTOR_TYPE';
/** Marker to manually pin the reported `actor_name` (e.g. `claude-code`). */
export const ACTOR_NAME_ENV = 'CYPRESS_SENTRY_ACTOR_NAME';

const ACTOR_TYPES: readonly ActorType[] = ['ai', 'bot', 'human'];

/**
 * Ordered registry of known actors; the first matching detector wins.
 * To support a new AI agent or bot, append an entry describing the
 * environment markers it sets.
 */
export const ACTOR_DETECTORS: readonly ActorDetector[] = [
  // AI coding agents
  {
    name: 'claude-code',
    type: 'ai',
    isActive: (env) => Boolean(env.CLAUDECODE ?? env.CLAUDE_CODE_ENTRYPOINT),
  },
  {
    name: 'cursor',
    type: 'ai',
    isActive: (env) => Boolean(env.CURSOR_AGENT),
  },
  {
    name: 'github-copilot',
    type: 'ai',
    isActive: (env) => env.GITHUB_ACTOR === 'copilot-swe-agent[bot]',
  },
  {
    name: 'openai-codex',
    type: 'ai',
    isActive: (env) => Boolean(env.CODEX_SANDBOX ?? env.CODEX_PROXY_CERT),
  },
  {
    name: 'gemini-cli',
    type: 'ai',
    isActive: (env) => Boolean(env.GEMINI_CLI),
  },
  {
    name: 'opencode',
    type: 'ai',
    isActive: (env) => Boolean(env.OPENCODE ?? env.OPENCODE_BIN_PATH),
  },
  // Automation bots
  {
    name: 'dependabot',
    type: 'bot',
    isActive: (env) => ciActorLogin(env) === 'dependabot[bot]',
  },
  {
    name: 'renovate',
    type: 'bot',
    isActive: (env) =>
      Boolean(env.RENOVATE_VERSION) || ciActorLogin(env) === 'renovate[bot]',
  },
];

/**
 * Identify who or what triggered the test run: a human, an automation bot, or
 * an AI agent (and which one). Detection relies on environment markers and can
 * always be overridden by manually setting {@link ACTOR_TYPE_ENV} and
 * {@link ACTOR_NAME_ENV}.
 */
export function detectActor(env: NodeJS.ProcessEnv = process.env): ActorInfo {
  const detected = autoDetectActor(env);
  return {
    type: parseActorType(env[ACTOR_TYPE_ENV]) ?? detected.type,
    name: env[ACTOR_NAME_ENV]?.trim() || detected.name,
  };
}

/** Normalize a manually specified actor type; unknown values are ignored. */
export function parseActorType(
  value: string | undefined,
): ActorType | undefined {
  const normalized = value?.trim().toLowerCase();
  return ACTOR_TYPES.find((t) => t === normalized);
}

function autoDetectActor(env: NodeJS.ProcessEnv): ActorInfo {
  for (const detector of ACTOR_DETECTORS) {
    if (detector.isActive(env)) {
      return { type: detector.type, name: detector.name };
    }
  }

  // Generic conventions agents use to advertise themselves, e.g.
  // `AI_AGENT=claude-code_...` in Claude Code remote sandboxes, `AGENT=amp`.
  const advertised = env.AI_AGENT ?? env.AGENT;
  if (advertised) return { type: 'ai', name: advertised };

  const login = ciActorLogin(env);
  if (login && isBotLogin(login)) {
    return { type: 'bot', name: login.replace(/\[bot\]$/, '') };
  }

  return { type: 'human', name: 'human' };
}

/** Login of the account that triggered the CI pipeline, when exposed. */
function ciActorLogin(env: NodeJS.ProcessEnv): string | undefined {
  return env.GITHUB_ACTOR ?? env.GITLAB_USER_LOGIN;
}

function isBotLogin(login: string): boolean {
  // `*[bot]` is the GitHub app convention; `project_<id>_bot*` and
  // `group_<id>_bot*` cover GitLab project/group access tokens.
  return /\[bot\]$/.test(login) || /^(project|group)_\d+_bot/.test(login);
}

export type { ActorDetector, ActorInfo, ActorType } from './types.js';
