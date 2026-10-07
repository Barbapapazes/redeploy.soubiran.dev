import type { Event } from '@sentry/cloudflare'
import { describe, expect, it } from 'vitest'
import { bodySchema } from '../src/schema'
import { getSentryOptions, sanitizeSentryEvent } from '../src/sentry'
import { getDeployHookLogContext, getWorkflowId, getWorkflowIdPrefix } from '../src/utils'

const hook = 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/secret-token?secret=query'

function env(dsn = ''): Env {
  return {
    SENTRY_DSN: dsn,
    SENTRY_ENVIRONMENT: 'test',
    CLOUDFLARE_API_TOKEN: '',
    REDEPLOY_SOUBIRAN_DEV: {} as Env['REDEPLOY_SOUBIRAN_DEV'],
  }
}

describe('telemetry privacy', () => {
  it('redacts the deploy hook token and omits query parameters from evlog context', () => {
    expect(getDeployHookLogContext(hook)).toEqual({
      host: 'api.cloudflare.com',
      pathname: '/client/v4/workers/builds/deploy_hooks/[redacted]',
    })
  })

  it('removes request bodies, cookies, headers and query parameters from Sentry events', () => {
    const event: Event = {
      request: {
        url: 'https://redeploy.soubiran.dev/url?secret=query',
        data: { deploy_hook_url: hook },
        cookies: { session: 'secret' },
        headers: { authorization: 'Bearer secret' },
        query_string: 'secret=query',
      },
    }
    expect(sanitizeSentryEvent(event).request).toEqual({ url: 'https://redeploy.soubiran.dev/url' })
    expect(sanitizeSentryEvent({})).toEqual({})
  })

  it('disables Sentry without a DSN and enables it with one', () => {
    expect(getSentryOptions(env()).enabled).toBe(false)
    const options = getSentryOptions(env('https://public@example.com/1'))
    expect(options.enabled).toBe(true)
    expect(options.beforeSendLog?.({} as never)).toBeNull()
    expect(options.dataCollection?.userInfo).toBe(false)
    expect(options.dataCollection?.httpBodies).toEqual([])
    expect(options.beforeSend).toBe(sanitizeSentryEvent)
    expect(options.beforeSendTransaction).toBe(sanitizeSentryEvent)
  })

  it('does not capture evlog console output or secret outbound URLs', () => {
    const options = getSentryOptions(env())
    if (typeof options.integrations !== 'function') {
      throw new TypeError('Expected an integration filter')
    }
    expect(options.integrations([
      { name: 'Console' },
      { name: 'Fetch' },
      { name: 'Dedupe' },
    ])).toEqual([{ name: 'Dedupe' }])
  })
})

describe('workflow identity and input', () => {
  it('uses a hash instead of leaking the deploy hook token into workflow IDs', async () => {
    const prefix = await getWorkflowIdPrefix('example-worker', hook)
    const id = await getWorkflowId('example-worker', hook)
    expect(prefix).toMatch(/^worker-example-worker-hook-[a-f0-9]{16}-$/)
    expect(id.startsWith(prefix)).toBe(true)
    expect(id).not.toContain('secret-token')
    expect(await getWorkflowId('example-worker', `${hook}other`)).not.toContain(prefix)
  })

  it('creates unique immediate workflow IDs', async () => {
    const first = await getWorkflowId(undefined, hook)
    expect(first).not.toBe(await getWorkflowId(undefined, hook))
  })

  it('accepts immediate and wait-for-worker payloads', () => {
    expect(bodySchema.safeParse({ deploy_hook_url: hook }).success).toBe(true)
    expect(bodySchema.safeParse({
      deploy_hook_url: hook,
      cloudflare: { to_wait: { worker: 'example-worker' } },
    }).success).toBe(true)
  })

  it('rejects invalid URLs and worker names', () => {
    expect(bodySchema.safeParse({ deploy_hook_url: 'invalid' }).success).toBe(false)
    expect(bodySchema.safeParse({
      deploy_hook_url: hook,
      cloudflare: { to_wait: { worker: '../invalid' } },
    }).success).toBe(false)
  })
})
