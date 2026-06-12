import { SentryReporterCore } from './core.js';
import { failuresFromRun, failuresFromSpec } from './map-results.js';
import type {
  CypressBeforeRunDetails,
  CypressPluginConfig,
  CypressPluginEvents,
  CypressRunResults,
  CypressSentryReporterOptions,
  CypressSpecInfo,
  CypressSpecResults,
} from './types.js';

/**
 * Wire the Sentry reporter into Cypress from `setupNodeEvents`:
 *
 * ```ts
 * import { defineConfig } from 'cypress';
 * import { installSentryReporter } from 'cypress-sentry-reporter';
 *
 * export default defineConfig({
 *   e2e: {
 *     setupNodeEvents(on, config) {
 *       return installSentryReporter(on, config, { maxEventsPerRun: 50 });
 *     },
 *   },
 * });
 * ```
 *
 * Failures are reported per spec from `after:spec` (so a crash later in the
 * run does not lose earlier failures), swept once more from `after:run`, and
 * flushed to Sentry before the run-event promise resolves. Note that Cypress
 * fires run events in `cypress run` only (or with
 * `experimentalInteractiveRunEvents` in open mode), and keeps a single handler
 * per event — registering your own `after:spec`/`after:run` handler after this
 * one replaces it.
 */
export function installSentryReporter<C extends CypressPluginConfig>(
  on: CypressPluginEvents,
  config: C,
  options: CypressSentryReporterOptions = {},
): C {
  const core = new SentryReporterCore(options);
  // The resolved config already knows the Cypress version and testing type;
  // `before:run` refines this with the actual browser once the run starts.
  core.setRunMeta({
    cypressVersion: config.version,
    testType: config.testingType,
  });

  on('before:run', (details: CypressBeforeRunDetails | undefined) => {
    core.setRunMeta({
      cypressVersion: details?.cypressVersion,
      browserName: details?.browser?.name,
      browserVersion: details?.browser?.version,
    });
  });

  on(
    'after:spec',
    (spec: CypressSpecInfo | undefined, results: CypressSpecResults) => {
      for (const ctx of failuresFromSpec(spec, results)) {
        core.reportFailure(ctx);
      }
    },
  );

  on('after:run', async (results: CypressRunResults | undefined) => {
    // Defensive sweep: catch any failure not seen via after:spec. Already
    // reported failures are deduplicated by the core via the context id.
    for (const ctx of failuresFromRun(results)) {
      core.reportFailure(ctx);
    }
    await core.flush();
  });

  return config;
}

export default installSentryReporter;
