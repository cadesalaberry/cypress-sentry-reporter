import { describe, expect, it } from 'vitest';
import installSentryReporterDefault, {
  ACTOR_DETECTORS,
  ACTOR_NAME_ENV,
  ACTOR_TYPE_ENV,
  detectActor,
  detectTrigger,
  installSentryReporter,
  SentryReporterCore,
  TRIGGER_ENV,
} from './index.js';

describe('package entry point', () => {
  it('default-exports the plugin installer', () => {
    expect(installSentryReporterDefault).toBe(installSentryReporter);
    expect(typeof installSentryReporter).toBe('function');
  });

  it('exposes the runner-neutral reporting core', () => {
    const core = new SentryReporterCore();
    expect(core.name).toBe('cypress-sentry-reporter');
  });

  it('re-exports the actor and trigger detection helpers', () => {
    expect(ACTOR_DETECTORS.length).toBeGreaterThan(0);
    expect(ACTOR_TYPE_ENV).toBe('CYPRESS_SENTRY_ACTOR_TYPE');
    expect(ACTOR_NAME_ENV).toBe('CYPRESS_SENTRY_ACTOR_NAME');
    expect(TRIGGER_ENV).toBe('CYPRESS_SENTRY_TRIGGER');
    expect(typeof detectActor).toBe('function');
    expect(typeof detectTrigger).toBe('function');
  });
});
