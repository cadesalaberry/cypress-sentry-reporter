// Smoke-test fixture project: runs the built plugin in dry-run mode so the
// envelope that *would* be sent to Sentry is logged for assertion by
// scripts/assert-e2e-smoke.ts. Build the library first (`bun run build`).
import { defineConfig } from 'cypress';
import { registerCypressSentryReporter } from '../dist/index.js';

export default defineConfig({
  video: false,
  screenshotOnRunFailure: false,
  e2e: {
    supportFile: false,
    setupNodeEvents(on, config) {
      return registerCypressSentryReporter(on, config, {
        dryRun: true,
        tags: { smoke: 'true' },
      });
    },
  },
});
