/**
 * Validates that a pull request title follows Conventional Commits.
 *
 * release-please derives the version bump and CHANGELOG entry from the squash
 * commit, which defaults to the PR title — so the title must parse as
 * `type(optional-scope)!: description`.
 *
 * Run by the "PR Title" workflow: `bun run scripts/validate-pr-title.ts`,
 * reading the title from the `PR_TITLE` environment variable.
 */

/** Commit types accepted by release-please (see release-please-config.json). */
export const ALLOWED_TYPES = [
  'feat',
  'fix',
  'perf',
  'revert',
  'refactor',
  'docs',
  'build',
  'ci',
  'test',
  'style',
  'chore',
] as const;

export interface ValidationResult {
  valid: boolean;
  /** Specific reason the title is invalid; undefined when valid. */
  error?: string;
}

const isBlank = (value: string): boolean => value.trim().length === 0;

/**
 * Validate a single PR title. Returns `{ valid: true }` or `{ valid: false,
 * error }` where `error` names the specific part that is wrong.
 */
export function validatePrTitle(title: string): ValidationResult {
  if (isBlank(title)) {
    return { valid: false, error: 'PR title is empty.' };
  }

  const colonIndex = title.indexOf(':');
  if (colonIndex === -1) {
    return {
      valid: false,
      error: "Missing ':'. Expected 'type(scope): description'.",
    };
  }

  const header = title.slice(0, colonIndex); // type + optional scope + optional '!'
  const rest = title.slice(colonIndex + 1); // ' description'

  // The colon must be followed by exactly one space.
  if (rest.length > 0 && !rest.startsWith(' ')) {
    return {
      valid: false,
      error: "The colon must be followed by a space, e.g. 'fix: ...'.",
    };
  }

  const description = rest.replace(/^ /, '');
  if (isBlank(description)) {
    return {
      valid: false,
      error: 'Description is empty. Add a summary after the colon.',
    };
  }

  // Strip an optional trailing '!' (breaking-change marker) before the colon.
  const core = header.endsWith('!') ? header.slice(0, -1) : header;

  let type = core;
  if (core.includes('(') || core.includes(')')) {
    // Has a scope: must be exactly 'type(scope)' with a non-empty scope.
    const scopeMatch = /^([a-z]+)\(([^()]+)\)$/.exec(core);
    if (!scopeMatch) {
      return {
        valid: false,
        error: "Malformed scope. Expected 'type(scope)', e.g. 'fix(reporter)'.",
      };
    }
    const [, scopeType, scope] = scopeMatch;
    type = scopeType ?? core;
    if (scope === undefined || isBlank(scope)) {
      return {
        valid: false,
        error: 'Scope is empty. Use a non-empty scope or drop the parentheses.',
      };
    }
  }

  if (!/^[a-z]+$/.test(type)) {
    return {
      valid: false,
      error: `Type '${type}' is invalid. It must be lowercase letters only.`,
    };
  }

  if (!(ALLOWED_TYPES as readonly string[]).includes(type)) {
    return {
      valid: false,
      error: `Type '${type}' is not allowed. Use one of: ${ALLOWED_TYPES.join(', ')}.`,
    };
  }

  return { valid: true };
}

/** Multi-line help shown on failure. Uses GitHub Actions error annotations. */
function explain(title: string, error: string): string {
  return [
    `::error::${error}`,
    '',
    `❌ Invalid PR title: "${title}"`,
    '',
    'PR titles must follow Conventional Commits, because the squash commit',
    '(and therefore release-please) is built from the title:',
    '',
    '    type(optional-scope): description',
    '',
    `  • type         one of: ${ALLOWED_TYPES.join(', ')}`,
    '  • scope        optional, in parentheses, e.g. (release)',
    '  • !            optional, before the colon, marks a breaking change',
    '  • :            a colon followed by a single space',
    '  • description  a short, non-empty summary',
    '',
    'Examples:',
    '    feat: support Cypress 13',
    '    fix(reporter): handle missing event id',
    '    feat!: drop Node 18 support',
  ].join('\n');
}

/** CLI entry: read PR_TITLE from the environment, print, and set exit code. */
function main(): void {
  const title = process.env.PR_TITLE ?? '';
  const result = validatePrTitle(title);

  if (result.valid) {
    console.log(`✅ PR title is valid: "${title}"`);
    return;
  }

  console.error(explain(title, result.error ?? 'Invalid PR title.'));
  process.exitCode = 1;
}

// Only run the CLI when executed directly, not when imported by a test.
// `import.meta.main` is a Bun extension absent from the standard ImportMeta type.
if ((import.meta as ImportMeta & { main?: boolean }).main) {
  main();
}
