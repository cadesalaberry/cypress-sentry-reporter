import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDryRunTransport } from './dry-run-transport.js';

// Minimal envelope helpers for tests
function createTestEnvelope(type: string, payload: unknown): unknown[] {
  const header = { dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0' };
  const itemHeader = { type } as Record<string, unknown>;
  return [header, [[itemHeader, payload]]];
}

describe('makeDryRunTransport', () => {
  const origWarn = console.warn;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.warn as any).mockRestore?.();
    console.warn = origWarn;
  });

  it('logs a human-friendly string for an event envelope', async () => {
    const transport = makeDryRunTransport();
    const envelope = createTestEnvelope('event', {
      message: 'hello',
      level: 'error',
      tags: { test_file: '/tests/example.test.ts' },
    }) as unknown as any[];

    await transport.send(envelope as any);

    const calls = (console.warn as any).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toContain('dryRun transport – would send:');
    expect(typeof calls[0][1]).toBe('string');
    expect(calls[0][1]).toContain('Event[');
    expect(calls[0][1]).toContain("- test_file: '/tests/example.test.ts'");
  });

  it('handles malformed envelopes gracefully', async () => {
    const transport = makeDryRunTransport();
    const badEnvelope = {};
    await expect(transport.send(badEnvelope as any)).resolves.toEqual({});
  });

  it('falls back to a question mark when the event has no level', async () => {
    const transport = makeDryRunTransport();
    const envelope = createTestEnvelope('event', {
      message: 'hello',
      tags: { test_file: '/tests/example.test.ts' },
    }) as unknown as any[];

    await transport.send(envelope as any);

    const calls = (console.warn as any).mock.calls;
    expect(calls[0][1]).toContain('Event[❓]');
  });

  it('logs the raw item type for non-event envelopes', async () => {
    const transport = makeDryRunTransport();
    const envelope = createTestEnvelope('session', { sid: 'abc' }) as any[];

    await transport.send(envelope as any);

    const calls = (console.warn as any).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toContain('would send: session');
  });

  it('logs an empty description for envelopes without items', async () => {
    const transport = makeDryRunTransport();
    const envelope = [{ dsn: 'https://x@o0.ingest.sentry.io/0' }, []];

    await expect(transport.send(envelope as any)).resolves.toEqual({});

    const calls = (console.warn as any).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toBe('');
  });

  it('flush returns true and logs', async () => {
    const transport = makeDryRunTransport();
    await expect(transport.flush(10)).resolves.toBe(true);
    const calls = (console.warn as any).mock.calls;
    expect(calls[calls.length - 1][0]).toContain(
      'dryRun transport – would flush',
    );
  });
});
