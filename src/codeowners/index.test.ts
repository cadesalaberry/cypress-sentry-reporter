import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCodeownersCache,
  matchOwners,
  parseCodeowners,
  resolveCodeOwners,
} from './index.js';

describe('parseCodeowners', () => {
  it('parses patterns and owners, skipping blanks and comments', () => {
    const content = [
      '# top-level comment',
      '',
      '* @acme/default-team',
      'src/api/   @acme/api  @alice',
      '   # indented comment',
      '*.md @acme/docs',
    ].join('\n');

    expect(parseCodeowners(content)).toEqual([
      { pattern: '*', owners: ['@acme/default-team'] },
      { pattern: 'src/api/', owners: ['@acme/api', '@alice'] },
      { pattern: '*.md', owners: ['@acme/docs'] },
    ]);
  });

  it('keeps entries with a pattern but no owners (unowned)', () => {
    expect(parseCodeowners('src/generated/')).toEqual([
      { pattern: 'src/generated/', owners: [] },
    ]);
  });
});

describe('matchOwners', () => {
  const entries = parseCodeowners(
    ['* @acme/default', 'src/api/ @acme/api', '*.md @acme/docs'].join('\n'),
  );

  it('applies last-match-wins precedence', () => {
    expect(matchOwners('src/api/handler.ts', entries)).toEqual(['@acme/api']);
    expect(matchOwners('README.md', entries)).toEqual(['@acme/docs']);
  });

  it('falls back to a catch-all default owner', () => {
    expect(matchOwners('src/util.ts', entries)).toEqual(['@acme/default']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(matchOwners('src/api/handler.ts', [])).toEqual([]);
  });
});

describe('resolveCodeOwners', () => {
  let root: string;

  beforeEach(() => {
    clearCodeownersCache();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowners-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeCodeowners(relPath: string, content: string): void {
    const file = path.join(root, relPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }

  it('resolves owners for an absolute file path under the root', () => {
    writeCodeowners(
      '.github/CODEOWNERS',
      ['* @acme/default', 'src/api/ @acme/api'].join('\n'),
    );

    expect(resolveCodeOwners(path.join(root, 'src/api/x.ts'), root)).toEqual([
      '@acme/api',
    ]);
    expect(resolveCodeOwners(path.join(root, 'src/db.ts'), root)).toEqual([
      '@acme/default',
    ]);
  });

  it('finds CODEOWNERS at the repository root', () => {
    writeCodeowners('CODEOWNERS', '*.ts @acme/ts');
    expect(resolveCodeOwners(path.join(root, 'index.ts'), root)).toEqual([
      '@acme/ts',
    ]);
  });

  it('returns an empty array when no CODEOWNERS file exists', () => {
    expect(resolveCodeOwners(path.join(root, 'src/x.ts'), root)).toEqual([]);
  });

  it('returns an empty array for files outside the root', () => {
    writeCodeowners('CODEOWNERS', '* @acme/default');
    expect(resolveCodeOwners('/etc/passwd', root)).toEqual([]);
  });

  it('returns an empty array when no file path is provided', () => {
    writeCodeowners('CODEOWNERS', '* @acme/default');
    expect(resolveCodeOwners(undefined, root)).toEqual([]);
  });
});
