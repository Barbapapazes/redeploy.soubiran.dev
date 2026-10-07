# redeploy.soubiran.dev

[![License][license-src]][license-href]
[![Cloudflare Workers][workers-src]][workers-href]

A Cloudflare Worker + Workflow service that optionally waits for the latest deployment of a Worker and then `POST`s a Cloudflare deploy hook URL.

- ⚙️ Runtime: Cloudflare Workers + Workflows, developed and built with the Cloudflare Vite plugin
- 🧠 Validation: `zod`
- 🪵 Logging: `evlog/workers` in the Worker + `evlog` wide events in the Workflow
- 🐛 Monitoring: `@sentry/cloudflare` for HTTP errors and Workflow step failures

## Installation

```bash
pnpm install
```

Use Node.js 24 and the pnpm version specified in `package.json`.

Copy `.dev.vars.example` to `.dev.vars` for local Worker bindings. Vite can also read `.env`, but do not define the same bindings in both files. Never commit tokens or local environment files.

If you use `cloudflare.to_wait.worker`, provide a user API token with access to the Workers resources needed to inspect deployments. If you only trigger `deploy_hook_url` immediately, the token is not used by the redeploy flow itself.

```txt
CLOUDFLARE_API_TOKEN=...
```

`CLOUDFLARE_API_TOKEN` in this file is the **Worker's runtime token**. It is separate from the credentials Wrangler uses to deploy the service. The required-secret declaration makes its type reproducible; local development warns if it is missing, but the immediate redeploy path does not use it.

Run locally:

```bash
pnpm run dev
```

## Usage

Every request emits a Worker log event, and every workflow execution emits its own wide event. To make events easy to identify and correlate:

- send `x-service` when calling the Worker
- the Worker logs the caller service and generated workflow id
- the Workflow log includes the originating request id and caller service
- deploy hook URLs are sanitized in logs so the secret hook token is not exposed

Trigger a Cloudflare deploy hook URL after another worker deployment is successful:

```txt
POST /url
Content-Type: application/json

{
  "deploy_hook_url": "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abc123",
  "cloudflare": {
    "to_wait": {
      "worker": "talks"
    }
  }
}
```

Trigger a Cloudflare deploy hook URL immediately without waiting:

```txt
POST /url
Content-Type: application/json

{
  "deploy_hook_url": "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abc123"
}
```

If input is invalid (malformed JSON or schema mismatch), the API returns `400 Bad Request`.

If workflow execution fails later, the workflow run emits its own error event with the workflow instance id and Cloudflare deployment context when available.

## Observability

The existing evlog wide events stay in Cloudflare Workers Logs. **There is no evlog drain to Sentry.** Sentry console capture and Sentry Logs are disabled, so evlog output is not forwarded indirectly either.

To enable Sentry locally, set `SENTRY_DSN` in `.dev.vars`. Leave it empty to disable Sentry. For production, set the public project DSN in `wrangler.jsonc` (`vars.SENTRY_DSN`) before deploying. `SENTRY_ENVIRONMENT` defaults to `production` and is overridden to `development` in the local example.

The Sentry SDK wraps both the HTTP handler and the named Workflow export. It handles request delivery with `waitUntil` and flushes Workflow telemetry around steps. Workflow step errors are captured by the SDK (rather than manually capturing the same errors again). HTTP errors and Workflow events carry the workflow id for correlation with evlog. Malformed input still returns `400`, not an exception reported to Sentry.

HTTP and Workflow step traces are sampled at 10%. Outgoing fetch instrumentation is intentionally disabled: deploy-hook URLs contain credentials, and we do not want these URLs in spans or breadcrumbs. Sentry events and transactions omit request bodies, cookies, headers and query parameters. Deploy-hook failures log only the status or a generic network error, never the upstream body or URL-bearing network error.

The Vite build emits source maps for debugging. Uploading these maps to Sentry is not configured; that requires your Sentry project/organization and an authenticated build-time upload setup. No Sentry auth token belongs in Worker runtime bindings.

## Development and deployment

- Install: `pnpm install`
- Dev (workerd runtime, port 8787): `pnpm run dev`
- Regenerate worker types after binding/config changes: `pnpm run cf-typegen`
- Lint: `pnpm run lint`
- Typecheck: `pnpm run typecheck`
- Unit tests (one worker): `pnpm run test`
- Build: `pnpm run build`
- Preview the built Worker locally: `pnpm run preview`
- Deploy: `pnpm run deploy`

The deploy command builds first. The Cloudflare Vite plugin writes the deployable Worker/config into `dist/` and creates Wrangler's generated-config redirect in `.wrangler/deploy/config.json`. Wrangler then deploys that **built output**, not the original TypeScript entrypoint. Do not run a plain `wrangler deploy` from a fresh checkout without building first.

Provision the runtime Cloudflare token without committing it:

```bash
pnpm exec wrangler secret put CLOUDFLARE_API_TOKEN
```

The Workflow name, binding, class export and custom domain are unchanged. `nodejs_compat` is enabled for Sentry's async context handling; the existing compatibility date is retained.

CI regenerates Worker types, lints, typechecks, runs unit tests, builds with Vite and performs a Wrangler deployment dry run. No Cloudflare credentials or Sentry DSN are needed for CI. Unit tests mock platform entrypoints; CI's build/dry run validates bundling, while real Workflow retry/replay behavior still needs a Cloudflare staging smoke test.

## HTTPie examples (development)

When running locally, you can use [HTTPie](https://httpie.io/) to test the API. This is easier than using a GUI like Postman.

Trigger a Cloudflare deploy hook URL after another worker deployment is successful:

```bash
http --verbose --json POST localhost:8787/url \
  deploy_hook_url=https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abc123 \
  cloudflare:='{"to_wait":{"worker":"talks"}}' \
  x-service:soubiran.dev
```

Trigger a Cloudflare deploy hook URL immediately:

```bash
http --verbose --json POST localhost:8787/url \
  deploy_hook_url=https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abc123 \
  x-service:soubiran.dev
```

> [!NOTE]
> Remember to use real target names that exist in your Cloudflare account.

Quick negative tests:

```bash
# Wrong route (expect 404)
http --verbose --json POST localhost:8787/soubiran-dev cloudflare:='{"to_wait":{"worker":"talks"}}'

# Invalid body shape (expect 400: deploy_hook_url is required)
http --verbose --json POST localhost:8787/url cloudflare:='{"to_wait":{"worker":"talks"}}'

# Invalid body shape (expect 400: invalid deploy hook URL)
http --verbose --json POST localhost:8787/url deploy_hook_url=not-a-url

# Malformed JSON (expect 400)
echo '{bad json' | http --verbose POST localhost:8787/url Content-Type:application/json
```

## Sponsors

<p align="center">
  <a href="https://github.com/sponsors/barbapapazes">
    <img src="https://cdn.jsdelivr.net/gh/barbapapazes/static/sponsors.svg" alt="Sponsors" />
  </a>
</p>

## License

[MIT](./LICENSE) License

<!-- Badges -->
[license-src]: https://img.shields.io/badge/license-MIT-171717.svg?style=flat&colorA=000&colorB=171717
[license-href]: ./LICENSE

[workers-src]: https://img.shields.io/badge/Cloudflare-Workers-F38020.svg?style=flat&logo=cloudflare&logoColor=white
[workers-href]: https://developers.cloudflare.com/workers/
