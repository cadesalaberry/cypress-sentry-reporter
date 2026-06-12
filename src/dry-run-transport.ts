import type { Envelope, Event, SeverityLevel } from '@sentry/core';

const LEVEL_TO_EMOJI: Record<SeverityLevel, string> = {
  debug: '🐛',
  info: 'ℹ️',
  warning: '⚠️',
  error: '🚨',
  fatal: '🚨',
  log: '💬',
};

const humanFriendlyEnvelopeToLog = (envelope: Envelope): string => {
  const items = envelope[1];
  for (const item of items) {
    const header = item[0];
    const payload = item[1];
    const type = header.type;

    if (type === 'event') {
      const event = payload as Event;
      const message = event.message;
      const level = event.level ? LEVEL_TO_EMOJI[event.level] : '❓';
      const tags = event.tags;
      const test_file = event.tags?.test_file as string;

      return [
        `Event[${level}]: '${message}'`,
        `- test_file: '${test_file}'`,
        `- tags: '${JSON.stringify(tags, null, 2)}'`,
      ].join('\n');
    }
    return `[cypress-sentry-reporter] dryRun transport – would send: ${type} ${payload}`;
  }
  return '';
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
