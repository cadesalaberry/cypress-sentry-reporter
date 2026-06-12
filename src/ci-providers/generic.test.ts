import { describe, expect, it } from 'vitest';
import { GenericCIProvider } from './generic.js';

describe('GenericCIProvider', () => {
  const env = { CI: 'true' };

  it('reports no metadata beyond the CI flag', () => {
    expect(GenericCIProvider.isActive(env)).toBe(true);
    expect(GenericCIProvider.repository(env)).toBeUndefined();
    expect(GenericCIProvider.branch(env)).toBeUndefined();
    expect(GenericCIProvider.commitSha(env)).toBeUndefined();
    expect(GenericCIProvider.runUrl(env)).toBeUndefined();
    expect(GenericCIProvider.workflowId(env)).toBeUndefined();
    expect(GenericCIProvider.rootPath(env)).toBeUndefined();
  });

  it('snapshots only the CI flag', () => {
    expect(GenericCIProvider.envSnapshot({ ...env, SECRET: 'x' })).toEqual(env);
  });
});
