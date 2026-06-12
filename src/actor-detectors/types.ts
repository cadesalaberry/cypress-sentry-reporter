export type ActorType = 'ai' | 'bot' | 'human';

export interface ActorInfo {
  /** Broad category of who or what triggered the test run. */
  type: ActorType;
  /** Specific actor, e.g. `claude-code`, `dependabot` or `human`. */
  name: string;
}

/**
 * Recognizes one actor (an AI coding agent, an automation bot, ...) from the
 * environment markers it sets in the shells it spawns.
 */
export interface ActorDetector {
  /** Reported as the `actor_name` Sentry tag when this detector matches. */
  readonly name: string;
  /** Reported as the `actor_type` Sentry tag when this detector matches. */
  readonly type: ActorType;
  isActive(env: NodeJS.ProcessEnv): boolean;
}
