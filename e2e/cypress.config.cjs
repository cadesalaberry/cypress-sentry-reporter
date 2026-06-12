// Smoke-test fixture: a minimal Cypress project wiring the built reporter in
// dry-run mode. CJS on purpose — the package root is ESM (`"type": "module"`)
// and Cypress 12 loads `.cjs` configs without involving a bundler.
const { defineConfig } = require('cypress');

module.exports = defineConfig({
  video: false,
  screenshotOnRunFailure: false,
  e2e: {
    supportFile: false,
    async setupNodeEvents(on, config) {
      // Dynamic import: the published package is ESM-only.
      const { installSentryReporter } = await import('../dist/index.js');
      return installSentryReporter(on, config, {
        dryRun: true,
        tags: { smoke: 'true' },
      });
    },
  },
});
