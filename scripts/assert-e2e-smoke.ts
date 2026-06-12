/**
 * End-to-end smoke test: runs the `e2e/` fixture project with a real Cypress
 * binary and the reporter in dry-run mode, then asserts that the deliberately
 * failing spec produced exactly one would-be Sentry event with the expected
 * tags — and that the passing spec produced none.
 *
 * This is the Cypress equivalent of dogfooding: it exercises the whole chain
 * (plugin registration → run events → mapping → Sentry SDK → transport)
 * without sending anything over the network.
 *
 * Usage: `bun run test:e2e` (requires `bun run build` and the Cypress binary).
 */
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

function fail(message: string, output?: string): never {
  console.error(`::error::${message}`);
  if (output) {
    console.error('--- combined cypress output ---');
    console.error(output);
  }
  process.exit(1);
}

console.log('Running the e2e smoke fixture (cypress run, dryRun mode)...');
const result = spawnSync(
  'bunx',
  ['cypress', 'run', '--project', 'e2e', '--browser', 'electron'],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
  },
);

if (result.error) {
  fail(`Failed to spawn cypress: ${result.error.message}`);
}

const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

// The fixture has exactly one failing test, so Cypress must exit with 1.
if (result.status !== 1) {
  fail(
    `Expected cypress to exit with code 1 (one failing test), got ${result.status}.`,
    output,
  );
}

const expectations: Array<[description: string, marker: string]> = [
  [
    'dry-run transport logged a would-be event',
    '[cypress-sentry-reporter] dryRun transport – would send:',
  ],
  [
    'event is tagged with the reporter name',
    '"reporter": "cypress-sentry-reporter"',
  ],
  [
    'event points at the failing spec',
    "- test_file: 'cypress/e2e/failing.cy.js'",
  ],
  ['event carries the failing test name', '"test_name": "fails on purpose"'],
  ['event carries the browser name tag', '"browser_name": "electron"'],
  ['event carries the testing type tag', '"test_type": "e2e"'],
  ['event keeps user-provided tags', '"smoke": "true"'],
  [
    'reporter flushed before the run ended',
    '[cypress-sentry-reporter] dryRun transport – would flush',
  ],
];

for (const [description, marker] of expectations) {
  if (!output.includes(marker)) {
    fail(`Missing expected output (${description}): ${marker}`, output);
  }
}

if (output.includes("test_file: 'cypress/e2e/passing.cy.js'")) {
  fail('The passing spec must not produce a Sentry event.', output);
}

const eventCount = output.split('Event[').length - 1;
if (eventCount !== 1) {
  fail(`Expected exactly 1 would-be event, found ${eventCount}.`, output);
}

console.log(
  '✅ e2e smoke test passed: 1 event for the failing spec, 0 for the passing spec.',
);
