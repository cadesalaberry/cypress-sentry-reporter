import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NodeOptions, Scope } from '@sentry/node';
import { captureException, flush, init, withScope } from '@sentry/node';
import { resolveCodeOwners } from './codeowners/index.js';
import { makeDryRunTransport } from './dry-run-transport.js';
import type {
  CypressSentryReporterOptions,
  FailureContext,
  Primitive,
  RunMeta,
} from './types.js';
import {
  baseTags,
  cleanRecord,
  commitSha,
  extras,
  inferEnvironment,
  MANUALLY_OVERRIDABLE_TAGS,
  repoRoot,
  runMetaTags,
} from './utils.js';

/**
 * Default per-screenshot size cap. Generous for failure screenshots (usually
 * well under 1 MiB) while staying far below Sentry's attachment limits, so an
 * oversized image can never sink the envelope carrying the failure event.
 */
const DEFAULT_SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * Runner-neutral reporting core: owns the Sentry lifecycle (lazy init,
 * capture, flush) and the run-level state (dedup, `maxEventsPerRun` cap).
 * The Cypress plugin (`plugin.ts`) feeds it {@link FailureContext}s mapped
 * from run-event payloads; nothing in here knows about Cypress.
 */
export class SentryReporterCore {
  public name: string;
  private options: CypressSentryReporterOptions;
  private enabled: boolean;
  private initialized: boolean;
  private reportedIds: Set<string>;
  private sent: number;
  private runMeta: RunMeta;
  private maxEventsPerRun?: number;
  private codeownersEnabled: boolean;
  private codeownersRoot?: string;
  private screenshotsEnabled: boolean;
  private screenshotMaxBytes: number;

  constructor(options: CypressSentryReporterOptions = {}) {
    this.name = 'cypress-sentry-reporter';
    this.options = options;
    this.enabled = this.resolveEnabled(options);
    this.initialized = false;
    this.reportedIds = new Set<string>();
    this.sent = 0;
    this.runMeta = {};
    this.maxEventsPerRun = options.maxEventsPerRun;

    const co = options.codeowners;
    this.codeownersEnabled =
      co === true ||
      (typeof co === 'object' && co !== null && co.enabled !== false);
    this.codeownersRoot = this.codeownersEnabled
      ? typeof co === 'object' && co?.root
        ? co.root
        : repoRoot()
      : undefined;

    // Screenshot attachments are on unless explicitly switched off.
    const shots = options.screenshots;
    this.screenshotsEnabled =
      shots !== false &&
      !(typeof shots === 'object' && shots !== null && shots.enabled === false);
    this.screenshotMaxBytes =
      (typeof shots === 'object' && shots !== null && shots.maxBytes) ||
      DEFAULT_SCREENSHOT_MAX_BYTES;
  }

  /** Merge run-scoped metadata (browser, Cypress version, testing type). */
  setRunMeta(meta: RunMeta): void {
    // Merge key-by-key so an event that lacks a field (e.g. `before:run`
    // without browser details) does not erase a previously captured value.
    for (const [key, value] of Object.entries(meta)) {
      if (value != null) (this.runMeta as Record<string, unknown>)[key] = value;
    }
  }

  /**
   * Report a single failure, applying the `shouldReport` predicate, per-run
   * dedup (by `ctx.id`) and the `maxEventsPerRun` cap. Sentry is initialized
   * lazily on the first reported failure.
   */
  reportFailure(ctx: FailureContext): void {
    if (ctx.id) {
      if (this.reportedIds.has(ctx.id)) return;
      this.reportedIds.add(ctx.id);
    }
    const shouldReport = this.options.shouldReport
      ? this.options.shouldReport(ctx)
      : true;
    if (!shouldReport) return;
    if (this.maxEventsPerRun && this.sent >= this.maxEventsPerRun) return;
    if (!this.enabled) return;
    if (!this.initialized) this.initSentry();
    if (!this.enabled) return;
    this.sent++;
    this.send(ctx);
  }

  /** Wait for buffered events to reach Sentry; call before the process exits. */
  async flush(timeoutMs = 3000): Promise<void> {
    if (this.enabled && this.initialized) {
      await flush(timeoutMs).catch(() => void 0);
    }
  }

  private send(ctx: FailureContext): void {
    const manualTags = {
      ...cleanRecord(this.options.tags),
      ...cleanRecord(this.options.getTags?.(ctx)),
    };
    const owners = this.resolveOwners(ctx);
    const codeOwnerTags: Record<string, Primitive> =
      owners.length > 0
        ? { code_owners: owners.join(','), code_owner: owners[0] }
        : {};
    const mergedTags = {
      ...manualTags,
      ...cleanRecord(baseTags(ctx)),
      ...cleanRecord(runMetaTags(this.runMeta)),
      ...cleanRecord(codeOwnerTags),
    } as Record<string, Primitive>;
    // Detected trigger/actor markers yield to manually specified tags.
    for (const key of MANUALLY_OVERRIDABLE_TAGS) {
      if (key in manualTags) mergedTags[key] = manualTags[key];
    }

    const fingerprint = this.options.getFingerprint?.(ctx) ?? [
      'cypress-failure',
      ctx.filePath ?? 'unknown-file',
      ctx.testName,
    ];

    const testContext = {
      file: ctx.filePath,
      name: ctx.testName,
      fullTitle: ctx.fullTitle,
      durationMs: ctx.durationMs,
      retry: ctx.retry,
      flaky: ctx.flaky,
    };

    const error =
      ctx.error instanceof Error
        ? ctx.error
        : new Error(ctx.message ?? ctx.fullTitle ?? ctx.testName);

    // If we have a stack from the failure context, use it.
    if (ctx.stack) {
      error.stack = ctx.stack;
    } else {
      // If we created a synthetic error and have no stack from the context,
      // the error.stack will point to this line in the reporter.
      // We remove it to avoid confusing the user with reporter internals.
      if (!(ctx.error instanceof Error)) {
        error.stack = undefined;
      }
    }

    if (ctx.error && typeof ctx.error === 'object') {
      if ('name' in ctx.error)
        error.name = String((ctx.error as { name: unknown }).name);
    }

    withScope((scope) => {
      scope.setTags(mergedTags);
      scope.setExtras(extras(ctx, this.runMeta));
      if (owners.length > 0) scope.setExtra('code_owners', owners);
      scope.setContext('test', testContext);
      scope.setFingerprint(fingerprint);
      if (this.screenshotsEnabled) this.attachScreenshots(scope, ctx);

      const user = this.options.getUser?.(ctx);
      if (user) scope.setUser(user);

      if (this.options.beforeSend) {
        const beforeSend = this.options.beforeSend;
        scope.addEventProcessor((event, hint) => beforeSend(event, hint, ctx));
      }

      captureException(error);
    });
  }

  /**
   * Upload the failure's screenshots as event attachments. A screenshot that
   * is missing on disk or larger than `screenshots.maxBytes` is skipped with
   * a warning — its path still reaches Sentry via the `screenshots` extra.
   */
  private attachScreenshots(scope: Scope, ctx: FailureContext): void {
    for (const shot of ctx.screenshots ?? []) {
      try {
        const size = fs.statSync(shot.path).size;
        if (size > this.screenshotMaxBytes) {
          console.warn(
            `[cypress-sentry-reporter] screenshot ${shot.path} (${size} bytes) exceeds the ${this.screenshotMaxBytes} byte cap; not attached`,
          );
          continue;
        }
        scope.addAttachment({
          filename: path.basename(shot.path),
          data: fs.readFileSync(shot.path),
          contentType:
            IMAGE_CONTENT_TYPES[path.extname(shot.path).toLowerCase()] ??
            'application/octet-stream',
        });
      } catch (error) {
        console.warn(
          `[cypress-sentry-reporter] could not read screenshot ${shot.path}; not attached`,
          error,
        );
      }
    }
  }

  private initSentry(): void {
    if (this.initialized) return;
    const providedDsn = this.options.dsn ?? process.env.SENTRY_DSN;
    const isDryRun = Boolean(this.options.dryRun);
    const dsn =
      providedDsn ??
      (isDryRun ? 'https://examplePublicKey@o0.ingest.sentry.io/0' : undefined);
    if (!dsn) {
      this.enabled = false;
      console.warn(
        '[cypress-sentry-reporter] SENTRY_DSN missing; reporter disabled',
      );
      return;
    }

    if (isDryRun)
      console.log(
        '[cypress-sentry-reporter] initializing Sentry with DSN:',
        dsn,
      );
    const environment =
      this.options.environment ??
      process.env.SENTRY_ENVIRONMENT ??
      inferEnvironment();
    const release =
      this.options.release ??
      process.env.SENTRY_RELEASE ??
      commitSha() ??
      undefined;

    const minimalIntegrationNames = new Set([
      'InboundFilters',
      'FunctionToString',
      'LinkedErrors',
      'ContextLines',
      'Context',
    ]);

    const initOptions: NodeOptions = {
      dsn,
      environment,
      release,
      dist: release,
      debug: isDryRun,
      integrations: (defaults) =>
        defaults.filter((integration) =>
          minimalIntegrationNames.has(integration.name),
        ),
      tracesSampleRate: 0,
      ...(this.options.sentryOptions ?? {}),
    };

    if (isDryRun) {
      // Use a custom transport that logs envelopes instead of sending
      initOptions.transport = makeDryRunTransport;
    }

    init(initOptions);
    this.initialized = true;
  }

  private resolveEnabled(options: CypressSentryReporterOptions): boolean {
    if (typeof options.enabled === 'boolean') return options.enabled;
    if (options.dryRun) return true;
    return Boolean(options.dsn ?? process.env.SENTRY_DSN);
  }

  private resolveOwners(ctx: FailureContext): string[] {
    if (!this.codeownersEnabled || !this.codeownersRoot) return [];
    const absolute = ctx.meta?.absolutePath;
    const specPath = typeof absolute === 'string' ? absolute : ctx.filePath;
    return resolveCodeOwners(specPath, this.codeownersRoot);
  }
}

export default SentryReporterCore;
