# redeploy.soubiran.dev

[![License][license-src]][license-href]
[![Cloudflare Workers][workers-src]][workers-href]

A Cloudflare Worker + Workflow service that optionally waits for the latest deployment of a Worker and then either redeploys another Worker or `POST`s a Cloudflare deploy hook URL.

This supports both Workers Builds deploy hooks and a direct Worker redeploy flow for cases such as static-asset-only Workers where a deploy hook URL is not available.

- ⚙️ Runtime: Cloudflare Workers + Workflows
- 🧠 Validation: `zod`
- 🪵 Logging: `evlog/workers`

## Installation

```bash
pnpm install
```

## Usage

Copy `.env.example` to `.env` and use a user API token with access to the Workers resources needed to inspect deployments and, if you use `cloudflare.to_redeploy.worker`, trigger a rebuild.

```txt
CLOUDFLARE_API_TOKEN=...
```

Run locally:

```bash
pnpm run dev
```

Trigger a worker redeploy after another worker deployment is successful:

```txt
POST /url
Content-Type: application/json

{
  "cloudflare": {
    "to_wait": {
      "worker": "talks"
    },
    "to_redeploy": {
      "worker": "my-static-worker"
    }
  }
}
```

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

> [!NOTE]
> If `cloudflare.to_redeploy.worker` is provided, the worker redeploy path is used. `deploy_hook_url` is only required when you want to trigger a deploy hook instead.

> [!NOTE]
> `cloudflare.to_redeploy.worker` is useful for Workers that cannot be redeployed through a deploy hook URL, such as static Workers.

Trigger a Cloudflare deploy hook URL immediately without waiting:

```txt
POST /url
Content-Type: application/json

{
  "deploy_hook_url": "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abc123"
}
```

Redeploy a worker immediately without waiting:

```txt
POST /url
Content-Type: application/json

{
  "cloudflare": {
    "to_redeploy": {
      "worker": "my-static-worker"
    }
  }
}
```

If input is invalid (malformed JSON or schema mismatch), the API returns `400 Bad Request`.

## Development

- Install: `pnpm install`
- Dev: `pnpm run dev`
- Lint: `pnpm run lint`
- Deploy: `pnpm run deploy`
- Regenerate worker types: `pnpm run cf-typegen`

## HTTPie examples (development)

When running locally, you can use [HTTPie](https://httpie.io/) to test the API. This is easier than using a GUI like Postman.

Trigger a worker redeploy after another worker deployment is successful:

```bash
http --verbose --json POST localhost:8787/url \
  cloudflare:='{"to_wait":{"worker":"talks"},"to_redeploy":{"worker":"my-static-worker"}}' \
  x-service:soubiran.dev
```

Trigger a deploy hook URL after another worker deployment is successful:

```bash
http --verbose --json POST localhost:8787/url \
  deploy_hook_url=https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abc123 \
  cloudflare:='{"to_wait":{"worker":"talks"}}' \
  x-service:soubiran.dev
```

Trigger a deploy hook URL immediately:

```bash
http --verbose --json POST localhost:8787/url \
  deploy_hook_url=https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abc123 \
  x-service:soubiran.dev
```

Redeploy a worker immediately:

```bash
http --verbose --json POST localhost:8787/url \
  cloudflare:='{"to_redeploy":{"worker":"my-static-worker"}}' \
  x-service:soubiran.dev
```

> [!NOTE]
> Remember to use real target names that exist in your Cloudflare account.

Quick negative tests:

```bash
# Wrong route (expect 404)
http --verbose --json POST localhost:8787/soubiran-dev cloudflare:='{"to_wait":{"worker":"talks"}}'

# Invalid body shape (expect 400: neither trigger target is provided)
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
