import type { CloudflareOptions, Event } from '@sentry/cloudflare'

export function sanitizeSentryEvent<T extends Event>(event: T): T {
  // The POST body contains the secret deploy hook. Never send it to Sentry.
  if (event.request) {
    delete event.request.data
    delete event.request.cookies
    delete event.request.query_string
    delete event.request.headers
    if (event.request.url) {
      event.request.url = event.request.url.split('?')[0]
    }
  }
  return event
}

export function getSentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN || undefined,
    enabled: Boolean(env.SENTRY_DSN),
    environment: env.SENTRY_ENVIRONMENT,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    enableLogs: false,
    // Don't capture evlog console output or outgoing fetch URLs (hook tokens).
    integrations: defaults => defaults.filter(integration => !['Console', 'Fetch'].includes(integration.name)),
    beforeSend: sanitizeSentryEvent,
    beforeSendTransaction: sanitizeSentryEvent,
    initialScope: { tags: { service: 'redeploy-soubiran-dev' } },
  }
}
