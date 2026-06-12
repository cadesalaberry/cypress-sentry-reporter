import type { Envelope, Event, SeverityLevel } from '@sentry/core';

const LEVEL_TO_EMOJI: Record<SeverityLevel, string> = {
  debug: '🐛',
  info: 'ℹ️',
  warning: '⚠️',
  error: '🚨',
  fatal: '🚨',
  log: '💬',
};

const eventToLog = (event: Event): string => {
  // captureException events carry no `message`; surface the exception instead.
  const exception = event.exception?.values?.[0];
  const message =
    event.message ??
    (exception ? `${exception.type}: ${exception.value}` : undefined);
  const level = event.level ? LEVEL_TO_EMOJI[event.level] : '❓';
  const test_file = event.tags?.test_file as string;

  return [
    `Event[${level}]: '${message}'`,
    `- test_file: '${test_file}'`,
    `- tags: '${JSON.stringify(event.tags, null, 2)}'`,
    `- extra: '${JSON.stringify(event.extra, null, 2)}'`,
  ].join('\n');
};

const humanFriendlyEnvelopeToLog = (envelope: Envelope): string => {
  const items = envelope[1];
  const lines: string[] = [];
  for (const item of items) {
    const header = item[0];
    const payload = item[1];
    const type = header.type;

    if (type === 'event') {
      lines.push(eventToLog(payload as Event));
    } else if (type === 'attachment') {
      const meta = header as {
        filename?: string;
        content_type?: string;
        length?: number;
      };
      const length =
        meta.length ?? (payload as { length?: number } | undefined)?.length;
      lines.push(
        `Attachment[📎]: '${meta.filename}' (${meta.content_type ?? 'unknown type'}, ${length ?? '?'} bytes)`,
      );
    } else {
      lines.push(`${String(type)} ${payload}`);
    }
  }
  return lines.join('\n');
};

export function makeDryRunTransport() {
  return {
    send(envelope: Envelope) {
      try {
        console.warn(
          '[cypress-sentry-reporter] dryRun transport – would send:',
          humanFriendlyEnvelopeToLog(envelope),
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(
          '[cypress-sentry-reporter] dryRun transport failed to log envelope',
          e,
        );
      }
      return Promise.resolve({});
    },
    flush(_timeout?: number) {
      console.warn('[cypress-sentry-reporter] dryRun transport – would flush');
      return Promise.resolve(true);
    },
  };
}
