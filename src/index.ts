import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { WorkflowEntrypoint } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { createWorkersLogger, initWorkersLogger } from 'evlog/workers'
import z from 'zod'
import { cloudflare } from './cloudflare'
import { ACCOUNT_ID, WORKFLOW_NAME } from './constants'
import { bodySchema } from './schema'
import { getWorkflowId, getWorkflowIdPrefix } from './utils'
import { waitForLatestWorkersDeployment } from './workers'

initWorkersLogger({
  env: { service: 'redeploy-soubiran-dev' },
})

export default {
  fetch: async (request: Request, env: Env) => {
    const url = new URL(request.url)

    const log = createWorkersLogger(request, {
      headers: ['x-service'],
    })
    log.set({ path: url.pathname, method: request.method })

    if (request.method === 'POST' && /^\/url\/?$/.test(url.pathname)) {
      let body: unknown = {}
      try {
        const text = await request.text()
        if (text.trim()) {
          body = JSON.parse(text)
        }
      }
      catch {
        log.set({ error: 'Invalid JSON body' })
        log.emit()
        return new Response('Bad Request', { status: 400 })
      }

      const validatedBody = bodySchema.safeParse(body)
      if (!validatedBody.success) {
        log.set({ request: { body }, error: z.treeifyError(validatedBody.error) })
        log.emit()
        return new Response('Bad Request', { status: 400 })
      }

      const deployHookUrl = validatedBody.data.deploy_hook_url
      const workerToWait = validatedBody.data.cloudflare?.to_wait?.worker

      const workflowId = getWorkflowId(workerToWait)
      const params = {
        deploy_hook_url: deployHookUrl,
        workerToWait,
      }
      log.set({ workflow: { params, id: workflowId } })

      await env.REDEPLOY_SOUBIRAN_DEV.create({
        id: workflowId,
        params,
      })

      log.emit()
      return new Response('OK', { status: 200 })
    }

    log.emit()
    return new Response('Not Found', { status: 404 })
  },
}

interface RedeploySoubiranDevPayload {
  deploy_hook_url?: string
  workerToWait?: string
}

export class RedeploySoubiranDev extends WorkflowEntrypoint<Env, RedeploySoubiranDevPayload> {
  async run(event: Readonly<WorkflowEvent<RedeploySoubiranDevPayload>>, step: WorkflowStep) {
    const { deploy_hook_url, workerToWait } = event.payload

    if (!deploy_hook_url) {
      throw new NonRetryableError('No deploy hook URL specified')
    }

    if (workerToWait) {
      await step.do(`check-if-workflow-exists-${workerToWait}`, async () => {
        const json = await cloudflare.workflows.instances.list(WORKFLOW_NAME, {
          account_id: ACCOUNT_ID,
          status: 'running',
        })

        const workflowIdPrefix = getWorkflowIdPrefix(workerToWait)

        const otherInstances = json.result
          .filter(instance => instance.id !== event.instanceId) // Remove itself from the list
          .filter(instance => instance.id.startsWith(workflowIdPrefix)) // Keep only instances related to the same target to wait for

        if (otherInstances.length > 0) {
          throw new NonRetryableError(`Another instance of ${WORKFLOW_NAME} is already running for worker ${workerToWait}. Instance ID: ${otherInstances[0].id}`)
        }
      })

      await step.do(`wait-for-latest-production-deployment-${workerToWait}`, {
        retries: {
          limit: 60,
          delay: '1 minute',
          backoff: 'constant',
        },
        timeout: '1 hour',
      }, async () => {
        await waitForLatestWorkersDeployment(workerToWait)
      })
    }

    await step.do('trigger-deploy-hook', async () => {
      const response = await fetch(deploy_hook_url, { method: 'POST' })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Deploy hook trigger failed with ${response.status}${error ? `: ${error}` : ''}`)
      }
    })
  }
}
