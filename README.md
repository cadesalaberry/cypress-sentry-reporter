# cypress-sentry-reporter

[![npm version](https://img.shields.io/npm/v/cypress-sentry-reporter.svg)](https://www.npmjs.com/package/cypress-sentry-reporter)
[![npm downloads](https://img.shields.io/npm/dm/cypress-sentry-reporter.svg)](https://www.npmjs.com/package/cypress-sentry-reporter)
[![CI](https://github.com/cadesalaberry/cypress-sentry-reporter/actions/workflows/ci.yml/badge.svg)](https://github.com/cadesalaberry/cypress-sentry-reporter/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/cadesalaberry/cypress-sentry-reporter/graph/badge.svg)](https://codecov.io/gh/cadesalaberry/cypress-sentry-reporter)
[![License: MIT](https://img.shields.io/npm/l/cypress-sentry-reporter.svg)](LICENSE)

Uses Sentry to collect software defects and orchestrate its correction.

## Why report failing Cypress tests to Sentry

- **Faster feedback**: Centralizes failures from CI and local runs for immediate visibility.
- **Actionable context**: Captures stack traces, release, commit SHA, browser, env, and custom tags.
- **Ownership & triage**: Deduplicates, routes to the right team, and suppresses known flakes.
- **Trend & flake insights**: Surfaces regressions and flaky patterns to improve reliability.
- **Shift-left quality**: Treats test failures as first-class defects, not console noise.
- **Production parity**: Mirrors proven prod observability practices in pre-merge pipelines.
- **Continuous improvement**: Dashboards and alerts drive SLIs/SLOs for test health.

Good teams observe production. Great teams also observe their tests.

## Installation

```bash
bun add -D cypress-sentry-reporter @sentry/node
```

## Usage

Register the reporter from `setupNodeEvents` in your `cypress.config.ts`. It
hooks into Cypress's plugin run events (`before:run`, `after:spec`,
`after:run`) rather than being a Mocha reporter — see
[ADR-0001](docs/decisions/0001-integrate-via-plugin-events-not-a-mocha-reporter.md)
for why.

```ts
// cypress.config.ts
import { defineConfig } from 'cypress';
import { registerCypressSentryReporter } from 'cypress-sentry-reporter';

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      return registerCypressSentryReporter(on, config, {
        // If omitted, uses process.env.SENTRY_DSN
        // dsn: process.env.SENTRY_DSN,

        // Enable/disable explicitly. Defaults to enabled if DSN exists.
        // enabled: true,

        // Optional metadata; will fall back to env and CI info if omitted
        environment: process.env.SENTRY_ENVIRONMENT || 'ci',
        release: process.env.SENTRY_RELEASE, // defaults to commit SHA on popular CIs
        serverName: 'local-dev',
        tags: {
          project: 'my-repo', // useful when used across multiple repos
          team: 'qa',
        },

        // Sentry SDK options
        sentryOptions: {
          // debug: true,
        },

        // Filter which failures are reported
        shouldReport: (ctx) => !ctx.flaky,

        // Add or override tags dynamically per failure
        getTags: (ctx) => ({
          spec: ctx.filePath,
          retry: String(ctx.retry ?? 0),
        }),

        // Stable grouping across repos
        getFingerprint: (ctx) => [
          'cypress-failure',
          ctx.filePath ?? 'unknown-file',
          ctx.testName,
        ],

        // Associate a user to help spot who hit the failure locally
        getUser: () => ({ username: process.env.USER }),

        // Mutate the final Sentry event before it is sent
        beforeSend: (event, _hint, ctx) => {
          event.level = 'error';
          event.tags = { ...(event.tags || {}), quicklook: 'true' };
          event.extra = { ...(event.extra || {}),
            suite_path: ctx.suitePath,
            duration_ms: ctx.durationMs,
          };
          return event;
        },

        // Safety valve in large suites
        maxEventsPerRun: 200,

        // If true, logs what would be sent without sending to Sentry
        // dryRun: true,
      });
    },
  },
});
```

The same registration works for the `component` config block; events are
tagged with `test_type: e2e` or `test_type: component` accordingly.

Tested against Cypress 12.17.4 with `@sentry/node` >= 10.

### What gets reported

Each test whose **final state is failed** produces one Sentry event, reported
as soon as its spec finishes (`after:spec`), so a crash later in the run does
not lose earlier failures. A defensive sweep in `after:run` catches anything
missed, and events are flushed before the process exits.

- **Error**: Parsed from the failing test (attempt error or `displayError`),
  including the assertion stack.
- **Tags**: `test_file`, `test_name`, `test_full_title`, `flaky`, `retry`,
  `node_version`, `os_platform`, `os_release`, `ci`, `trigger`, `actor_type`,
  `actor_name`, `repository`, `branch`, `commit_sha`, `browser_name`,
  `browser_version`, `test_type`, plus `code_owners`/`code_owner` when
  CODEOWNERS resolution is enabled, plus any custom tags.
- **Extras**: `duration_ms`, `suite_path`, `cypress_version`, minimal CI env snapshot.
- **Contexts**: `test` context with file/name/fullTitle/duration/retry/flaky.
- **Fingerprint**: Defaults to `['cypress-failure', file, testName]`; override with `getFingerprint`.

Events share their tag vocabulary with
[vitest-sentry-reporter](https://github.com/cadesalaberry/vitest-sentry-reporter),
so failures from both test runners land in Sentry with a near-identical shape
and can be queried and dashboarded together (e.g. `reporter:* test_file:*`).

### Trigger and actor detection (CI vs manual, human vs bot vs AI)

Every failure is tagged with how the run was started and who (or what) started it:

- **`trigger`**: `ci` when a CI provider is detected, `manual` otherwise.
- **`actor_type`**: `human`, `bot`, or `ai`.
- **`actor_name`**: the specific actor, e.g. `claude-code`, `cursor`, `github-copilot`, `openai-codex`, `dependabot`, `renovate` — or `human`.

Out of the box the reporter recognizes:

| Actor | `actor_type` | Markers |
|---|---|---|
| Claude Code | `ai` | `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` |
| Cursor | `ai` | `CURSOR_AGENT` |
| GitHub Copilot coding agent | `ai` | `GITHUB_ACTOR=copilot-swe-agent[bot]` |
| OpenAI Codex | `ai` | `CODEX_SANDBOX`, `CODEX_PROXY_CERT` |
| Gemini CLI | `ai` | `GEMINI_CLI` |
| opencode | `ai` | `OPENCODE`, `OPENCODE_BIN_PATH` |
| Any agent advertising itself | `ai` | `AI_AGENT`, `AGENT` (reported as `actor_name`) |
| Dependabot / Renovate | `bot` | `GITHUB_ACTOR`, `RENOVATE_VERSION` |
| Any `*[bot]` / GitLab token login | `bot` | `GITHUB_ACTOR`, `GITLAB_USER_LOGIN` |
| Everyone else | `human` | — |

Detection lives in a single declarative registry
([`src/actor-detectors/index.ts`](src/actor-detectors/index.ts)): supporting a
new AI agent or bot is a one-entry addition, and PRs adding markers are
welcome. The registry and helpers (`detectActor`, `detectTrigger`,
`ACTOR_DETECTORS`) are exported if you want to reuse them in `getTags`.

When auto-detection cannot know better, specify the markers manually — they
always win over detection:

```bash
CYPRESS_SENTRY_TRIGGER=cron \
CYPRESS_SENTRY_ACTOR_TYPE=bot \
CYPRESS_SENTRY_ACTOR_NAME=nightly-canary \
cypress run
```

The same three tags can also be pinned from the reporter options (`tags` or
`getTags`); manually specified values take precedence over the detected ones.

### Code ownership tags (CODEOWNERS)

Route failures to the team that owns the failing spec. When enabled, the
reporter matches each failing spec file against your repository's `CODEOWNERS`
and attaches:

- **`code_owners`**: every matching owner, comma-joined (e.g. `@acme/api,@alice`).
- **`code_owner`**: the primary (first) owner, handy for single-owner alerts.

The full owner list is also attached as a `code_owners` extra. The feature is
**off by default**; enable it with the `codeowners` option:

```ts
registerCypressSentryReporter(on, config, {
  // Auto-detect the repository root (CI checkout path, else process.cwd()):
  codeowners: true,

  // Or override the root used to locate CODEOWNERS and relativize spec paths:
  // codeowners: { root: '/path/to/repo' },
});
```

The `CODEOWNERS` file is looked up at the standard locations — repository root,
`.github/`, then `docs/` — and matched with gitignore-style precedence (last
matching rule wins). In CI the repository root is taken from the detected
provider's checkout path (`GITHUB_WORKSPACE`, `CI_PROJECT_DIR`,
`BUILDKITE_BUILD_CHECKOUT_PATH`, Jenkins `WORKSPACE`, CircleCI working
directory), falling back to `process.cwd()`. Note that Cypress reports spec
paths relative to the Cypress project root, so when your Cypress project does
not live at the repository root, point `codeowners.root` at it. Both tags can
be overridden via `tags`/`getTags`, which always take precedence over the
resolved owners.

Parsing depends only on [`ignore`](https://www.npmjs.com/package/ignore) (the
zero-dependency gitignore matcher); see
[`docs/decisions/0007-resolve-codeowners-into-sentry-tags.md`](docs/decisions/0007-resolve-codeowners-into-sentry-tags.md)
for the rationale.

### Environment variables and CI auto-detection

- `SENTRY_DSN` (required unless `dsn` is provided)
- `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` are respected when not explicitly set.
- CI metadata auto-detected for GitHub Actions, CircleCI, Buildkite, GitLab, Jenkins.
- `CYPRESS_SENTRY_TRIGGER`, `CYPRESS_SENTRY_ACTOR_TYPE`, `CYPRESS_SENTRY_ACTOR_NAME` manually pin the `trigger`/`actor_type`/`actor_name` tags.

### Limitations

- **Run mode only**: Cypress fires the `before:run`/`after:spec`/`after:run`
  plugin events only in `cypress run` (CI being the target). To experiment in
  `cypress open`, enable `experimentalInteractiveRunEvents`.
- **No console logs**: Plugin events do not expose the browser console, so
  events carry no `logs` extra (unlike the Vitest sibling). If you need this,
  open an issue — it can be added later via an optional support-file task.
- **Failures only**: Tests that pass on a retry (flaky passes) are not
  reported; only tests whose final state is `failed` produce events.
- **One handler per event**: Cypress keeps a single handler per plugin event,
  so registering your own `after:spec`/`after:run` handler after this plugin
  replaces its handlers (and vice versa). Register the reporter last, or call
  the mapping helpers (`mapSpecResults`, `mapRunResults`) from your own
  handlers.

### Multi-repo usage

Use the `tags.project` field and/or `getTags` to inject a stable project identifier. You can also add a `repository` tag if you aggregate across multiple repos.

### License

MIT

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md)
to get started, and note our [Code of Conduct](CODE_OF_CONDUCT.md). For security
issues, see the [Security Policy](SECURITY.md); for help, see [Support](SUPPORT.md).

## Architectural Decision Records (ADR)

We record architectural decisions using MADR (Markdown Architectural Decision Records).

- **Directory**: `docs/decisions`
- **Template**: `docs/decisions/adr-template.md`
- **Format**: MADR. See the docs at [adr.github.io/madr](https://adr.github.io/madr/) and the repository at [github.com/adr/madr](https://github.com/adr/madr).

### Create a new ADR

1. Pick the next number (zero-padded), e.g., `0008`.
2. Copy the template and edit:

```
cp docs/decisions/adr-template.md docs/decisions/0008-short-title.md
```

3. Fill in the sections and set an appropriate status (`proposed`, `accepted`, `rejected`, `superseded`).

The initial ADR adopting MADR lives at `docs/decisions/0000-use-markdown-architectural-decision-records.md`.

## Releasing

Releases are automated from [Conventional Commits](https://www.conventionalcommits.org/)
using [release-please](https://github.com/googleapis/release-please). You do not
bump the version or edit `CHANGELOG.md` by hand.

How it works:

1. Merge your work into `main` using Conventional Commit messages (see
   `docs/COMMIT_CONVENTION.md`). `feat:` → minor, `fix:` → patch,
   `!`/`BREAKING CHANGE:` → major.
2. release-please opens (and keeps updating) a **release PR** that bumps
   `version` in `package.json` and updates `CHANGELOG.md`.
3. Merge the release PR when you want to ship. That creates the `vX.Y.Z` git tag
   and a GitHub release, and automatically publishes the package to npm with
   provenance.

Configuration lives in `release-please-config.json` and the current released
version is tracked in `.release-please-manifest.json`. See
`docs/decisions/0005-automate-releases-with-release-please.md` for the rationale.

### One-time repository setup

- Configure **npm Trusted Publishing** for the package: on npmjs.com open the
  package → Settings → Trusted Publishers and add a GitHub Actions publisher for
  repo `cadesalaberry/cypress-sentry-reporter` and workflow `release.yml`.
  Publishing then uses short-lived OIDC credentials, so there is no `NPM_TOKEN`
  secret to store or rotate and it is not blocked by account 2FA.
- Enable **Allow GitHub Actions to create and approve pull requests** under
  Settings → Actions → General → Workflow permissions, so release-please can
  open its release PR.
