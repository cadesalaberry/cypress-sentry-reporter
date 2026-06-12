// Smoke-test fixture: a minimal Cypress project wiring the built reporter in
// dry-run mode. CJS on purpose — the package root is ESM (`"type": "module"`)
// and Cypress 12 loads `.cjs` configs without involving a bundler.
const { defineConfig } = require('cypress');

module.exports = defineConfig({
  video: false,
  // screenshotOnRunFailure is left at its default (true): the smoke test
  // asserts the failure screenshot is attached to the dry-run envelope.
  e2e: {
    supportFile: false,
    async setupNodeEvents(on, config) {
      // Dynamic import: the published package is ESM-only.
      const { installSentryReporter } = await import('../dist/index.js');
      return installSentryReporter(on, config, {
        dryRun: true,
        // `screenshots` is intentionally NOT set: attaching failure
        // screenshots must work by default.
        tags: { smoke: 'true' },
      });
    },
  },
});
