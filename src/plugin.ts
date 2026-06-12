/// <reference types="cypress" preserve="true" />
import { SentryReporterCore } from './core.js';
import { mapRunResults, mapSpecResults } from './map-results.js';
import type { CypressSentryReporterOptions } from './types.js';

/**
 * Wire the Sentry reporter into Cypress plugin events. Call it from
 * `setupNodeEvents` in `cypress.config.ts`:
 *
 * ```ts
 * import { defineConfig } from 'cypress';
 * import { registerCypressSentryReporter } from 'cypress-sentry-reporter';
 *
 * export default defineConfig({
 *   e2e: {
 *     setupNodeEvents(on, config) {
 *       return registerCypressSentryReporter(on, config, {
 *         // dsn, tags, shouldReport, dryRun, ...
 *       });
 *     },
 *   },
 * });
 * ```
 *
 * Failures are reported per spec from `after:spec` (so a crash later in the
 * run does not lose earlier failures), swept once more in `after:run`, and
 * flushed to Sentry before the run ends. Note that Cypress fires run events
 * only in `cypress run` (or with `experimentalInteractiveRunEvents`), and
 * keeps a single handler per event — registering your own `after:spec` after
 * this one replaces it.
 */
export function registerCypressSentryReporter(
  on: Cypress.PluginEvents,
  config: Cypress.PluginConfigOptions,
  options: CypressSentryReporterOptions = {},
): Cypress.PluginConfigOptions {
  const core = new SentryReporterCore(options);
  core.setRunMeta({ testType: config?.testingType });

  on('before:run', (details) => {
    core.setRunMeta({
      browserName: details?.browser?.name,
      browserVersion: details?.browser?.version,
      cypressVersion: details?.cypressVersion,
    });
  });

  // Report failures as each spec finishes so they survive a later crash.
  on('after:spec', (spec, results) => {
    for (const ctx of mapSpecResults(spec, results)) {
      core.report(ctx);
    }
  });

  // Defensive sweep over the whole run, then flush buffered events. The
  // core's id-based dedup skips everything already sent from after:spec.
  // A CypressFailedRunResult (run never started) carries no spec results.
  on('after:run', async (results) => {
    const sweep = results && 'runs' in results ? mapRunResults(results) : [];
    for (const ctx of sweep) {
      core.report(ctx);
    }
    await core.flush();
  });

  return config;
}

export default registerCypressSentryReporter;
