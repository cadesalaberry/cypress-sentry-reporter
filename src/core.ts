import type { NodeOptions } from '@sentry/node';
import {
  captureException,
  init,
  flush as sentryFlush,
  withScope,
} from '@sentry/node';
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
} from './utils.js';

/**
 * Runner-neutral reporting core: owns Sentry initialization, per-run state
 * (dedup, event cap) and the failure → Sentry event translation. The Cypress
 * plugin adapter (`plugin.ts`) feeds it {@link FailureContext} objects mapped
 * from Cypress run results.
 */
export class SentryReporterCore {
  public name: string;
  private options: CypressSentryReporterOptions;
  private enabled: boolean;
  private initialized: boolean;
  private reportedIds: Set<string>;
  private sentCount: number;
  private maxEventsPerRun?: number;
  private codeownersEnabled: boolean;
  private codeownersRoot?: string;
  private runMeta: RunMeta;

  constructor(options: CypressSentryReporterOptions = {}) {
    this.name = 'cypress-sentry-reporter';
    this.options = options;
    this.enabled = this.resolveEnabled(options);
    this.initialized = false;
    this.reportedIds = new Set<string>();
    this.sentCount = 0;
    this.maxEventsPerRun = options.maxEventsPerRun;
    this.runMeta = {};

    const co = options.codeowners;
    this.codeownersEnabled =
      co === true ||
      (typeof co === 'object' && co !== null && co.enabled !== false);
    this.codeownersRoot = this.codeownersEnabled
      ? typeof co === 'object' && co?.root
        ? co.root
        : repoRoot()
      : undefined;
  }

  /** Merge run-scoped metadata (browser, Cypress version, testing type). */
  setRunMeta(meta: RunMeta): void {
    this.runMeta = { ...this.runMeta, ...meta };
  }

  /**
   * Report a failure, applying dedup (by `ctx.id`), the `shouldReport`
   * predicate and the `maxEventsPerRun` cap. Returns true when the failure
   * was handed to Sentry.
   */
  report(ctx: FailureContext): boolean {
    if (ctx.id) {
      if (this.reportedIds.has(ctx.id)) return false;
      this.reportedIds.add(ctx.id);
    }
    const shouldReport = this.options.shouldReport
      ? this.options.shouldReport(ctx)
      : true;
    if (!shouldReport) return false;
    if (!this.enabled) return false;
    if (this.maxEventsPerRun && this.sentCount >= this.maxEventsPerRun)
      return false;

    this.reportFailure(ctx);
    this.sentCount++;
    return true;
  }

  /** Wait for buffered events to be sent. Never throws. */
  async flush(): Promise<void> {
    if (this.enabled && this.initialized) {
      await sentryFlush(3000).catch(() => void 0);
    }
  }

  private reportFailure(ctx: FailureContext): void {
    if (!this.enabled) return;
    if (!this.initialized) this.initSentry();

    const manualTags = {
      ...cleanRecord(this.options.tags),
      ...cleanRecord(this.options.getTags?.(ctx)),
    };
    const owners = this.resolveOwners(ctx);
    const codeOwnerTags: Record<string, Primitive> =
      owners.length > 0
        ? { code_owners: owners.join(','), code_owner: owners[0] }
        : {};
    const runTags = cleanRecord({
      browser_name: this.runMeta.browserName,
      browser_version: this.runMeta.browserVersion,
      test_type: this.runMeta.testType,
    });
    const mergedTags = {
      ...manualTags,
      ...cleanRecord(baseTags(ctx)),
      ...runTags,
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
      scope.setExtras({
        ...extras(ctx),
        cypress_version: this.runMeta.cypressVersion,
      });
      if (owners.length > 0) scope.setExtra('code_owners', owners);
      scope.setContext('test', testContext);
      scope.setFingerprint(fingerprint);

      const user = this.options.getUser?.(ctx);
      if (user) scope.setUser(user);

      if (this.options.beforeSend) {
        const beforeSend = this.options.beforeSend;
        scope.addEventProcessor((event, hint) => beforeSend(event, hint, ctx));
      }

      captureException(error);
    });
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
      ...(this.options.serverName
        ? { serverName: this.options.serverName }
        : {}),
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
    return resolveCodeOwners(ctx.filePath, this.codeownersRoot);
  }
}
