import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  log: { set: vi.fn(), getContext: vi.fn(() => ({ requestId: 'request-id' })), error: vi.fn(), warn: vi.fn(), emit: vi.fn() },
  withSentry: vi.fn((_options, handler) => handler),
  instrumentWorkflowWithSentry: vi.fn((_options, workflow) => workflow),
  waitForLatestWorkersDeployment: vi.fn(),
  listInstances: vi.fn(),
}))

vi.mock('@sentry/cloudflare', () => ({
  withSentry: mocks.withSentry,
  instrumentWorkflowWithSentry: mocks.instrumentWorkflowWithSentry,
  setTag: vi.fn(),
  setContext: vi.fn(),
}))
vi.mock('cloudflare:workers', () => ({ WorkflowEntrypoint: class {} }))
vi.mock('cloudflare:workflows', () => ({ NonRetryableError: class extends Error {} }))
vi.mock('evlog', () => ({ createRequestLogger: () => mocks.log }))
vi.mock('evlog/workers', () => ({ initWorkersLogger: vi.fn(), createWorkersLogger: () => mocks.log }))
vi.mock('../src/cloudflare', () => ({ cloudflare: { workflows: { instances: { list: mocks.listInstances } } } }))
vi.mock('../src/workers', () => ({ waitForLatestWorkersDeployment: mocks.waitForLatestWorkersDeployment }))

const { default: worker, RedeploySoubiranDev } = await import('../src/index')
const httpInstrumentation = mocks.withSentry.mock.calls[0]
const workflowInstrumentation = mocks.instrumentWorkflowWithSentry.mock.calls[0]
const hook = 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/secret-token'
const create = vi.fn()
const env = { REDEPLOY_SOUBIRAN_DEV: { create } } as unknown as Env
const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  create.mockResolvedValue({})
  mocks.listInstances.mockResolvedValue({ result: [] })
})

async function request(body: string, path = '/url', method = 'POST') {
  return worker.fetch(new Request(`https://redeploy.soubiran.dev${path}`, {
    method,
    ...(method === 'POST' ? { body } : {}),
    headers: { 'x-service': 'caller' },
  }), env, ctx)
}

async function runWorkflow(workerToWait?: string) {
  const workflow = new RedeploySoubiranDev(ctx, env)
  const event = {
    instanceId: 'workflow-id',
    timestamp: new Date(),
    payload: { deploy_hook_url: hook, workerToWait },
  } as WorkflowEvent<Parameters<typeof workflow.run>[0]['payload']>
  const step = {
    do: vi.fn(async (_name: string, configOrCallback: unknown, callback?: () => Promise<unknown>) => {
      const run = typeof configOrCallback === 'function' ? configOrCallback : callback
      return run!()
    }),
  } as unknown as WorkflowStep
  return workflow.run(event, step)
}

describe('Worker', () => {
  it('instruments HTTP and Workflow entrypoints', () => {
    expect(httpInstrumentation[0]).toBeTypeOf('function')
    expect(httpInstrumentation[1]).toBe(worker)
    expect(workflowInstrumentation[0]).toBe(httpInstrumentation[0])
    expect(workflowInstrumentation[1]).toBe(RedeploySoubiranDev)
  })

  it('creates and correlates an immediate workflow', async () => {
    expect((await request(JSON.stringify({ deploy_hook_url: hook }))).status).toBe(200)
    expect(create).toHaveBeenCalledWith({
      id: expect.any(String),
      params: { deploy_hook_url: hook, workerToWait: undefined, requestedByService: 'caller', triggerRequestId: 'request-id' },
    })
    expect(mocks.log.emit).toHaveBeenCalledOnce()
    expect(mocks.log.emit).toHaveBeenCalledWith({ status: 200 })
  })

  it.each(['{bad json', '{}', '', '{"deploy_hook_url":"invalid"}'])('rejects invalid body %s', async (body) => {
    expect((await request(body)).status).toBe(400)
    expect(create).not.toHaveBeenCalled()
    expect(mocks.log.emit).toHaveBeenCalledOnce()
  })

  it('returns 404 for unknown routes and methods', async () => {
    expect((await request('{}', '/unknown')).status).toBe(404)
    expect((await request('', '/url', 'GET')).status).toBe(404)
    expect(create).not.toHaveBeenCalled()
  })

  it('logs workflow creation errors and rethrows them for Sentry', async () => {
    create.mockRejectedValueOnce(new Error('Workflow creation failed'))
    await expect(request(JSON.stringify({ deploy_hook_url: hook }))).rejects.toThrow('Workflow creation failed')
    expect(mocks.log.emit).toHaveBeenCalledWith({ status: 500 })
  })
})

describe('Workflow', () => {
  it('triggers a deploy hook immediately', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await runWorkflow()
    expect(fetch).toHaveBeenCalledWith(hook, { method: 'POST' })
    expect(mocks.waitForLatestWorkersDeployment).not.toHaveBeenCalled()
    expect(mocks.log.emit).toHaveBeenCalledWith({ status: 200 })
  })

  it('waits for the production deployment before triggering the hook', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    mocks.waitForLatestWorkersDeployment.mockResolvedValueOnce({ worker: 'example', versionId: 'version-id' })
    await runWorkflow('example')
    expect(mocks.waitForLatestWorkersDeployment).toHaveBeenCalledWith('example')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not trigger the hook when the deployment check fails', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    mocks.waitForLatestWorkersDeployment.mockRejectedValueOnce(new Error('Still building'))
    await expect(runWorkflow('example')).rejects.toThrow('Still building')
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.log.emit).toHaveBeenCalledWith({ status: 500 })
  })

  it('does not log upstream bodies that may contain the hook token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(hook, { status: 500 })))
    await expect(runWorkflow()).rejects.toThrow('Deploy hook trigger failed with 500')
    expect(mocks.log.error.mock.calls[0][0].message).not.toContain('secret-token')
  })

  it('does not log fetch errors that may contain the hook token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`Failed to fetch ${hook}`)))
    await expect(runWorkflow()).rejects.toThrow('Deploy hook request failed')
    expect(mocks.log.error.mock.calls[0][0].message).not.toContain('secret-token')
  })
})
