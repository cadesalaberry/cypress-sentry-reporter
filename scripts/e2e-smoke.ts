/**
 * End-to-end smoke test: runs the e2e/ fixture project (one passing spec, one
 * deliberately failing spec) with the built reporter in dry-run mode, then
 * asserts the dry-run transport logged exactly one envelope carrying the
 * expected tags. This is the closest Cypress equivalent of dogfooding the
 * reporter against its own test suite.
 *
 * Run with `bun run test:e2e` (requires `bun run build` first).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '..');

if (!fs.existsSync(path.join(repoRoot, 'dist', 'index.js'))) {
  console.error('dist/index.js missing — run `bun run build` first.');
  process.exit(1);
}

console.log(
  'Running Cypress smoke fixture (this downloads nothing; uses the local binary)...',
);
const result = spawnSync(
  'bunx',
  ['cypress', 'run', '--project', 'e2e', '--browser', 'electron', '--headless'],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    env: { ...process.env, CYPRESS_SENTRY_TRIGGER: 'smoke' },
  },
);

const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

// The failing spec must make the run exit non-zero; a zero exit means the
// fixture did not actually fail and the assertions below would be vacuous.
if (result.status === 0) {
  console.error(output);
  console.error(
    'Expected the fixture run to fail (one spec fails on purpose).',
  );
  process.exit(1);
}

const failures: string[] = [];

function assertContains(needle: string, label: string): void {
  if (!output.includes(needle)) {
    failures.push(`missing ${label}: ${JSON.stringify(needle)}`);
  }
}

// One envelope, from the failing spec only.
const envelopeMarker =
  '[cypress-sentry-reporter] dryRun transport – would send:';
const envelopes = output.split(envelopeMarker).length - 1;
if (envelopes !== 1) {
  failures.push(`expected exactly 1 dry-run envelope, saw ${envelopes}`);
}

assertContains(envelopeMarker, 'dry-run transport log');
assertContains("test_file: 'cypress/e2e/failing.cy.js'", 'test_file tag');
assertContains('"reporter": "cypress-sentry-reporter"', 'reporter tag');
assertContains('"test_name": "fails on purpose"', 'test_name tag');
assertContains(
  '"test_full_title": "smoke > fails on purpose"',
  'test_full_title tag',
);
assertContains('"test_type": "e2e"', 'test_type tag');
assertContains('"browser_name": "electron"', 'browser_name tag');
assertContains('"trigger": "smoke"', 'manually pinned trigger tag');
assertContains('"smoke": "true"', 'user-provided static tag');
assertContains('would flush', 'dry-run flush log');

if (failures.length > 0) {
  console.error(output);
  console.error(`\nSmoke test FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(
  'Smoke test passed: one failing spec produced one envelope with the expected tags.',
);
