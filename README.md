# redeploy.soubiran.dev

[![License][license-src]][license-href]
[![Cloudflare Workers][workers-src]][workers-href]

A Cloudflare Worker + Workflow service that optionally waits for the latest deployment of a Worker and then `POST`s a Cloudflare deploy hook URL.

- ⚙️ Runtime: Cloudflare Workers + Workflows
- 🧠 Validation: `zod`
- 🪵 Logging: `evlog/workers` in the Worker + `evlog` wide events in the Workflow

## Installation

```bash
pnpm install
```

Copy `.env.example` to `.env`.

If you use `cloudflare.to_wait.worker`, provide a user API token with access to the Workers resources needed to inspect deployments. If you only trigger `deploy_hook_url` immediately, the token is not used by the redeploy flow itself.

```txt
CLOUDFLARE_API_TOKEN=...
```

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

## Development

- Install: `pnpm install`
- Dev: `pnpm run dev`
- Lint: `pnpm run lint`
- Deploy: `pnpm run deploy`
- Regenerate worker types: `pnpm run cf-typegen`

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
