/**
 * Validates that a commit message subject follows Conventional Commits.
 *
 * Wired to the `commit-msg` git hook (see `lefthook.yml`). It reuses the same
 * rules as the PR-title check so local commits and the squash/PR title stay
 * consistent — release-please derives the version bump from both.
 *
 * Usage: `bun run scripts/validate-commit-msg.ts <path-to-commit-msg-file>`
 */
import { readFileSync } from 'node:fs';
import { ALLOWED_TYPES, validatePrTitle } from './validate-pr-title';

/** Subjects that git or tooling generates — skip the convention check. */
const BYPASS_PREFIXES = ['Merge ', 'Revert ', 'fixup!', 'squash!', 'amend!'];

/** Read the first non-empty, non-comment line of the commit message file. */
function readSubject(path: string): string {
  const content = readFileSync(path, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    return line;
  }
  return '';
}

function explain(subject: string, error: string): string {
  return [
    `::error::${error}`,
    '',
    `❌ Invalid commit subject: "${subject}"`,
    '',
    'Commit messages must follow Conventional Commits with a Gitmoji:',
    '',
    '    type(optional-scope): <gitmoji> description',
    '',
    `  • type   one of: ${ALLOWED_TYPES.join(', ')}`,
    '  • see docs/COMMIT_CONVENTION.md for the Gitmoji list',
    '',
    'Examples:',
    '    feat(reporter): ✨ add foo',
    '    docs: 📝 document bar',
  ].join('\n');
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error('::error::No commit message file path was provided.');
    process.exitCode = 1;
    return;
  }

  const subject = readSubject(path);

  // Allow git-generated subjects (merges, reverts, fixup/squash autosquash).
  if (BYPASS_PREFIXES.some((prefix) => subject.startsWith(prefix))) {
    return;
  }

  const result = validatePrTitle(subject);
  if (result.valid) {
    return;
  }

  console.error(explain(subject, result.error ?? 'Invalid commit message.'));
  process.exitCode = 1;
}

main();
