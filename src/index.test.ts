import { describe, expect, it } from 'vitest';
import registerDefault, {
  ACTOR_DETECTORS,
  ACTOR_NAME_ENV,
  ACTOR_TYPE_ENV,
  detectActor,
  detectTrigger,
  mapRunResults,
  mapSpecResults,
  registerCypressSentryReporter,
  SentryReporterCore,
  TRIGGER_ENV,
} from './index.js';

describe('package entry point', () => {
  it('exports the plugin registration function as default and named', () => {
    expect(registerDefault).toBe(registerCypressSentryReporter);
    expect(typeof registerCypressSentryReporter).toBe('function');
  });

  it('exports the reporting core and result mappers', () => {
    const core = new SentryReporterCore();
    expect(core.name).toBe('cypress-sentry-reporter');
    expect(typeof mapSpecResults).toBe('function');
    expect(typeof mapRunResults).toBe('function');
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
