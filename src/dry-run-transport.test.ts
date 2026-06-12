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
    expect(calls[0][0]).toContain('would send:');
    expect(calls[0][1]).toContain('session');
  });

  it('derives the event title from the exception when there is no message', async () => {
    const transport = makeDryRunTransport();
    const envelope = createTestEnvelope('event', {
      level: 'error',
      exception: {
        values: [{ type: 'AssertionError', value: 'expected 2 to equal 3' }],
      },
      tags: { test_file: 'cypress/e2e/failing.cy.js' },
    }) as unknown as any[];

    await transport.send(envelope as any);

    const calls = (console.warn as any).mock.calls;
    expect(calls[0][1]).toContain(
      "Event[🚨]: 'AssertionError: expected 2 to equal 3'",
    );
  });

  it('logs event extras alongside the tags', async () => {
    const transport = makeDryRunTransport();
    const envelope = createTestEnvelope('event', {
      message: 'hello',
      level: 'error',
      tags: { test_file: 'x.cy.ts' },
      extra: { spec_stats: { failures: 1 } },
    }) as unknown as any[];

    await transport.send(envelope as any);

    const calls = (console.warn as any).mock.calls;
    expect(calls[0][1]).toContain('"spec_stats"');
    expect(calls[0][1]).toContain('"failures": 1');
  });

  it('logs every envelope item, including attachments', async () => {
    const transport = makeDryRunTransport();
    const header = { dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0' };
    const envelope = [
      header,
      [
        [
          { type: 'event' },
          { message: 'hello', level: 'error', tags: { test_file: 'x.cy.ts' } },
        ],
        [
          {
            type: 'attachment',
            filename: 'login (failed).png',
            content_type: 'image/png',
            length: 1234,
          },
          new Uint8Array(1234),
        ],
      ],
    ];

    await transport.send(envelope as any);

    const calls = (console.warn as any).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toContain('Event[🚨]');
    expect(calls[0][1]).toContain(
      "Attachment[📎]: 'login (failed).png' (image/png, 1234 bytes)",
    );
  });

  it('logs an undefined title when the event has no message and no exception', async () => {
    const transport = makeDryRunTransport();
    const envelope = createTestEnvelope('event', {
      level: 'error',
      tags: { test_file: 'x.cy.ts' },
    }) as unknown as any[];

    await transport.send(envelope as any);

    const calls = (console.warn as any).mock.calls;
    expect(calls[0][1]).toContain("Event[🚨]: 'undefined'");
  });

  it('prints a placeholder when the attachment size is unknown', async () => {
    const transport = makeDryRunTransport();
    const header = { dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0' };
    const envelope = [
      header,
      [
        [
          {
            type: 'attachment',
            filename: 'shot.png',
            content_type: 'image/png',
          },
          null,
        ],
      ],
    ];

    await transport.send(envelope as any);

    const calls = (console.warn as any).mock.calls;
    expect(calls[0][1]).toContain(
      "Attachment[📎]: 'shot.png' (image/png, ? bytes)",
    );
  });

  it('falls back to the payload length when the attachment header has none', async () => {
    const transport = makeDryRunTransport();
    const header = { dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0' };
    const envelope = [
      header,
      [[{ type: 'attachment', filename: 'shot.png' }, new Uint8Array(42)]],
    ];

    await transport.send(envelope as any);

    const calls = (console.warn as any).mock.calls;
    expect(calls[0][1]).toContain(
      "Attachment[📎]: 'shot.png' (unknown type, 42 bytes)",
    );
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
