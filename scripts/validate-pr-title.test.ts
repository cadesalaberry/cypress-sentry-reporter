import { describe, expect, it } from 'vitest';
import { ALLOWED_TYPES, validatePrTitle } from './validate-pr-title';

describe('validatePrTitle', () => {
  describe('valid titles', () => {
    const valid = [
      'feat: support Cypress 13',
      'fix(reporter): handle missing event id',
      'feat!: drop Node 18 support',
      'refactor(core)!: big change',
      'ci(release): 👷 add release-please auto-versioning',
      'docs(adr): 📝 reorder ADRs',
      'chore: bump deps',
    ];

    it.each(valid)('accepts %j', (title) => {
      expect(validatePrTitle(title)).toEqual({ valid: true });
    });

    it.each(ALLOWED_TYPES)('accepts the allowed type %j', (type) => {
      expect(validatePrTitle(`${type}: a description`).valid).toBe(true);
    });
  });

  describe('invalid titles', () => {
    const cases: Array<{ title: string; match: RegExp }> = [
      { title: '', match: /empty/i },
      { title: '   ', match: /empty/i },
      { title: 'Bad title without prefix', match: /missing ':'/i },
      { title: 'wip: something', match: /not allowed/i },
      { title: 'feat:no space', match: /followed by a space/i },
      { title: 'feat:', match: /description is empty/i },
      { title: 'feat: ', match: /description is empty/i },
      { title: 'feat(): empty scope', match: /malformed scope/i },
      { title: 'feat(  ): blank scope', match: /scope is empty/i },
      { title: 'feat(scope: unclosed', match: /malformed scope/i },
      { title: 'Feat: capitalized', match: /lowercase letters only/i },
      { title: 'feat2: trailing digit', match: /lowercase letters only/i },
    ];

    it.each(cases)('rejects $title', ({ title, match }) => {
      const result = validatePrTitle(title);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(match);
    });
  });

  it('names the offending type in the error message', () => {
    const result = validatePrTitle('wip: something');
    expect(result.valid).toBe(false);
    expect(result.error).toContain("'wip'");
    // The error should list the allowed types to guide the author.
    expect(result.error).toContain('feat');
  });
});
