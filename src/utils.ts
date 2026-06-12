import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectActor } from './actor-detectors/index.js';
import { detectProvider } from './ci-providers/index.js';
import type { FailureContext, Primitive, RunMeta } from './types.js';

/** Marker to manually pin the reported `trigger` tag (e.g. `ci`, `manual`, `cron`). */
export const TRIGGER_ENV = 'CYPRESS_SENTRY_TRIGGER';

/**
 * Detected tags whose values yield to the same keys manually specified via the
 * reporter's `tags`/`getTags` options.
 */
export const MANUALLY_OVERRIDABLE_TAGS = [
  'trigger',
  'actor_type',
  'actor_name',
  'code_owners',
  'code_owner',
] as const;

export function ciProvider(): string | undefined {
  return (
    detectProvider(process.env)?.name ?? (process.env.CI ? 'ci' : undefined)
  );
}

export function repository(): string | undefined {
  const p = detectProvider(process.env);
  return p?.repository(process.env);
}

export function branch(): string | undefined {
  const p = detectProvider(process.env);
  return p?.branch(process.env);
}

export function commitSha(): string | undefined {
  const p = detectProvider(process.env);
  return p?.commitSha(process.env);
}

/**
 * Best-effort absolute path to the repository root, used to locate a
 * CODEOWNERS file and relativize spec paths. Prefers the active CI provider's
 * checkout path (expanding a leading `~`), falling back to `process.cwd()`
 * whenever the provider path is absent or does not exist on disk.
 */
export function repoRoot(): string | undefined {
  const candidate = detectProvider(process.env)?.rootPath(process.env);
  if (candidate) {
    const expanded = candidate.startsWith('~')
      ? path.join(os.homedir(), candidate.slice(1))
      : candidate;
    if (fs.existsSync(expanded)) return expanded;
  }
  return process.cwd();
}

export function inferEnvironment(): string | undefined {
  if (ciProvider()) return 'ci';
  return process.env.NODE_ENV || 'local';
}

/**
 * How the test run was started: `ci` when a CI provider is detected, otherwise
 * `manual`. Set the {@link TRIGGER_ENV} marker to override the detection.
 */
export function detectTrigger(env: NodeJS.ProcessEnv = process.env): string {
  const manual = env[TRIGGER_ENV]?.trim();
  if (manual) return manual;
  return detectProvider(env) || env.CI ? 'ci' : 'manual';
}

function providerEnvSnapshot(): Record<string, string | undefined> {
  const p = detectProvider(process.env);
  if (p?.envSnapshot) return p.envSnapshot(process.env);
  return process.env.CI ? { CI: process.env.CI } : {};
}

export function cleanRecord(
  obj?: Record<string, unknown>,
): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    out[k] = typeof v === 'object' ? JSON.stringify(v) : (v as Primitive);
  }
  return out;
}

export function baseTags(ctx: FailureContext): Record<string, Primitive> {
  const actor = detectActor(process.env);
  return {
    reporter: 'cypress-sentry-reporter',
    test_file: ctx.filePath ?? 'unknown',
    test_name: ctx.testName,
    test_full_title: ctx.fullTitle ?? ctx.testName,
    flaky: String(Boolean(ctx.flaky)),
    retry: ctx.retry ?? 0,
    node_version: process.version,
    os_platform: os.platform(),
    os_release: os.release(),
    ci: ciProvider() ?? 'local',
    trigger: detectTrigger(process.env),
    actor_type: actor.type,
    actor_name: actor.name,
    repository: repository() ?? undefined,
    branch: branch() ?? undefined,
    commit_sha: commitSha() ?? undefined,
  };
}

/**
 * Tags derived from run-scoped Cypress metadata (`before:run` browser details
 * and the resolved config's testing type).
 */
export function runMetaTags(meta?: RunMeta): Record<string, Primitive> {
  return {
    browser_name: meta?.browserName,
    browser_version: meta?.browserVersion,
    test_type: meta?.testType,
  };
}

export function extras(
  ctx: FailureContext,
  meta?: RunMeta,
): Record<string, unknown> {
  return {
    duration_ms: ctx.durationMs,
    logs: ctx.logs,
    suite_path: ctx.suitePath,
    cypress_version: meta?.cypressVersion,
    // Debug aids mapped from the run-event payloads (when Cypress provides
    // them): screenshot paths/dimensions, the spec's video recording, the
    // spec's run statistics and the code frame around the failing line.
    screenshots: ctx.screenshots,
    video_path: ctx.videoPath,
    spec_stats: ctx.specStats,
    code_frame: ctx.codeFrame,
    env: providerEnvSnapshot(),
  };
}
