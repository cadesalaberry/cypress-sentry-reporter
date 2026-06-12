import * as fs from 'node:fs';
import * as path from 'node:path';
import ignore, { type Ignore } from 'ignore';

/** A single parsed CODEOWNERS rule. */
export interface CodeownersEntry {
  /** The gitignore-style path pattern. */
  pattern: string;
  /** Owners (teams/users/emails) declared for the pattern. */
  owners: string[];
}

/**
 * Locations searched for a CODEOWNERS file, relative to the repository root,
 * matching GitHub's documented precedence (root, then `.github/`, then `docs/`).
 */
const STANDARD_LOCATIONS = [
  'CODEOWNERS',
  '.github/CODEOWNERS',
  'docs/CODEOWNERS',
] as const;

/**
 * Parse the contents of a CODEOWNERS file into ordered entries. Blank lines and
 * `#` comments are skipped; the first whitespace-delimited token is the pattern
 * and the rest are owners. Order is preserved so callers can apply the
 * CODEOWNERS "last match wins" precedence.
 */
export function parseCodeowners(content: string): CodeownersEntry[] {
  const entries: CodeownersEntry[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    // Type-narrowing guard: a trimmed non-empty line always yields a first
    // token (`trim` strips the same whitespace set `\s` splits on).
    /* v8 ignore next */
    if (!pattern) continue;
    entries.push({ pattern, owners });
  }
  return entries;
}

// Pattern -> matcher is stable, so cache compiled matchers across lookups/roots.
const matcherCache = new Map<string, Ignore>();

function matcherFor(pattern: string): Ignore {
  let matcher = matcherCache.get(pattern);
  if (!matcher) {
    matcher = ignore().add(pattern);
    matcherCache.set(pattern, matcher);
  }
  return matcher;
}

/**
 * Return the owners of the last entry whose pattern matches `relPath`
 * (CODEOWNERS precedence), or an empty array when nothing matches. `relPath`
 * must be repository-relative with `/` separators.
 */
export function matchOwners(
  relPath: string,
  entries: CodeownersEntry[],
): string[] {
  if (!relPath) return [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry && matcherFor(entry.pattern).ignores(relPath))
      return entry.owners;
  }
  return [];
}

// root -> parsed entries (or null when no CODEOWNERS file is present/readable),
// so the file is read and parsed at most once per run.
const entriesCache = new Map<string, CodeownersEntry[] | null>();

function loadEntries(root: string): CodeownersEntry[] | null {
  const cached = entriesCache.get(root);
  if (cached !== undefined) return cached;

  let result: CodeownersEntry[] | null = null;
  for (const location of STANDARD_LOCATIONS) {
    try {
      const content = fs.readFileSync(path.join(root, location), 'utf8');
      result = parseCodeowners(content);
      break;
    } catch {
      // File absent or unreadable at this location; try the next.
    }
  }
  entriesCache.set(root, result);
  return result;
}

/**
 * Resolve the CODEOWNERS owners for a spec file. `filePath` is the spec path
 * reported by Cypress — absolute, or already relative to the project root —
 * and `root` is the repository root used both to locate the CODEOWNERS file
 * and to relativize absolute paths. Returns an empty array when there is no
 * file, no match, or the path lies outside the root. Never throws.
 */
export function resolveCodeOwners(
  filePath: string | undefined,
  root: string,
): string[] {
  if (!filePath) return [];
  const entries = loadEntries(root);
  if (!entries || entries.length === 0) return [];

  const rel = path.isAbsolute(filePath)
    ? path.relative(root, filePath)
    : filePath;
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return [];

  // `ignore` expects POSIX separators regardless of platform.
  const normalized = rel.split(path.sep).join('/');
  return matchOwners(normalized, entries);
}

/** Clear internal caches. Intended for tests. */
export function clearCodeownersCache(): void {
  entriesCache.clear();
  matcherCache.clear();
}
