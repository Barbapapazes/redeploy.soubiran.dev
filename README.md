# redeploy.soubiran.dev

[![License][license-src]][license-href]
[![Cloudflare Workers][workers-src]][workers-href]

A Cloudflare Worker + Workflow service that optionally waits for the latest deployment of a Worker and then `POST`s a Cloudflare deploy hook URL.

- ⚙️ Runtime: Cloudflare Workers + Workflows
- 🧠 Validation: `zod`
- 🪵 Logging: `evlog/workers`

## Installation

```bash
pnpm install
```

## Usage

Copy `.env.example` to `.env` and use a user API token with access to the Workers resources needed to inspect the latest deployment while waiting.

```txt
CLOUDFLARE_API_TOKEN=...
```

Run locally:

```bash
pnpm run dev
```

Trigger a deploy hook after another worker deployment is successful:

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

> [!NOTE]
> The worker always triggers the target URL with an HTTP `POST`, which matches Cloudflare deploy hooks.

Redeploy immediately without waiting (omit `cloudflare.to_wait` but still provide `deploy_hook_url`):

```txt
POST /url
Content-Type: application/json

{
  "deploy_hook_url": "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abc123"
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

Trigger a deploy hook after another worker deployment is successful:

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

> [!NOTE]
> Remember to use real target names that exist in your Cloudflare account.

Quick negative tests:

```bash
# Wrong route (expect 404)
http --verbose --json POST localhost:8787/soubiran-dev cloudflare:='{"to_wait":{"worker":"talks"}}'

# Invalid body shape (expect 400)
http --verbose --json POST localhost:8787/url deploy_hook_url=not-a-url cloudflare:='{"to_wait":{"worker":"talks"}}'

# Malformed JSON (expect 400)
echo '{bad json' | http --verbose POST localhost:8787/url Content-Type:application/json
```

## Sponsors

<p align="center">
  <a href="https://github.com/sponsors/barbapapazes">
    <img src="https://cdn.jsdelivr.net/gh/barbapapazes/static/sponsors.svg"/>
  </a>
</p>

## License

[MIT](./LICENSE) License © 2026-PRESENT [Estéban Soubiran](https://github.com/barbapapazes)

<!-- Badges -->
[license-src]: https://img.shields.io/badge/license-MIT-171717.svg?style=flat&colorA=000&colorB=171717
[license-href]: ./LICENSE

[workers-src]: https://img.shields.io/badge/Cloudflare-Workers-F38020.svg?style=flat&logo=cloudflare&logoColor=white
[workers-href]: https://developers.cloudflare.com/workers/
