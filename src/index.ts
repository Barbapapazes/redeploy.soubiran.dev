import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { WorkflowEntrypoint } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { createRequestLogger } from 'evlog'
import { createWorkersLogger, initWorkersLogger } from 'evlog/workers'
import z from 'zod'
import { cloudflare } from './cloudflare'
import { ACCOUNT_ID, WORKFLOW_NAME } from './constants'
import { bodySchema } from './schema'
import { getDeployHookLogContext, getWorkflowId, getWorkflowIdPrefix, toError } from './utils'
import { waitForLatestWorkersDeployment } from './workers'

initWorkersLogger({
  env: { service: 'redeploy-soubiran-dev' },
})

export default {
  fetch: async (request: Request, env: Env) => {
    const url = new URL(request.url)
    const callerService = request.headers.get('x-service') ?? undefined

    const log = createWorkersLogger(request, {
      headers: ['x-service'],
    })
    const requestContext = log.getContext()
    const requestId = typeof requestContext.requestId === 'string' ? requestContext.requestId : undefined

    log.set({
      entrypoint: {
        kind: 'worker',
        name: 'fetch',
      },
      request: {
        route: url.pathname,
      },
      ...(callerService
        ? {
            caller: {
              service: callerService,
            },
          }
        : {}),
    })

    if (request.method === 'POST' && /^\/url\/?$/.test(url.pathname)) {
      try {
        let body: unknown = {}
        try {
          const text = await request.text()
          if (text.trim()) {
            body = JSON.parse(text)
          }
        }
        catch {
          log.error(new Error('Invalid JSON body'))
          log.emit({ status: 400 })
          return new Response('Bad Request', { status: 400 })
        }

        const validatedBody = bodySchema.safeParse(body)
        if (!validatedBody.success) {
          log.warn('Invalid request body', {
            request: {
              route: url.pathname,
            },
            validation: z.treeifyError(validatedBody.error),
          })
          log.emit({ status: 400 })
          return new Response('Bad Request', { status: 400 })
        }

        const deployHookUrl = validatedBody.data.deploy_hook_url
        const workerToWait = validatedBody.data.cloudflare?.to_wait?.worker

        const workflowId = getWorkflowId(workerToWait)
        const params = {
          deploy_hook_url: deployHookUrl,
          workerToWait,
          requestedByService: callerService,
          triggerRequestId: requestId,
        }

        log.set({
          deployHook: getDeployHookLogContext(deployHookUrl),
          workflow: {
            name: WORKFLOW_NAME,
            id: workflowId,
          },
          ...(workerToWait
            ? {
                target: {
                  worker: workerToWait,
                },
              }
            : {
                target: {
                  mode: 'immediate',
                },
              }),
          ...(requestId || callerService
            ? {
                trigger: {
                  ...(requestId ? { requestId } : {}),
                  ...(callerService ? { service: callerService } : {}),
                },
              }
            : {}),
        })

        await env.REDEPLOY_SOUBIRAN_DEV.create({
          id: workflowId,
          params,
        })

        log.emit({ status: 200 })
        return new Response('OK', { status: 200 })
      }
      catch (error) {
        log.error(toError(error))
        log.emit({ status: 500 })
        throw error
      }
    }

    log.emit({ status: 404 })
    return new Response('Not Found', { status: 404 })
  },
}

interface RedeploySoubiranDevPayload {
  deploy_hook_url: string
  workerToWait?: string
  requestedByService?: string
  triggerRequestId?: string
}

export class RedeploySoubiranDev extends WorkflowEntrypoint<Env, RedeploySoubiranDevPayload> {
  async run(event: Readonly<WorkflowEvent<RedeploySoubiranDevPayload>>, step: WorkflowStep) {
    const { deploy_hook_url, requestedByService, triggerRequestId, workerToWait } = event.payload

    const workflowLog = createRequestLogger({
      method: 'WORKFLOW',
      path: `/${WORKFLOW_NAME}`,
      requestId: event.instanceId,
    })

    workflowLog.set({
      entrypoint: {
        kind: 'workflow',
        name: WORKFLOW_NAME,
      },
      workflow: {
        name: WORKFLOW_NAME,
        id: event.instanceId,
      },
      deployHook: getDeployHookLogContext(deploy_hook_url),
      ...(workerToWait
        ? {
            target: {
              worker: workerToWait,
            },
          }
        : {
            target: {
              mode: 'immediate',
            },
          }),
      ...(triggerRequestId || requestedByService
        ? {
            trigger: {
              ...(triggerRequestId ? { requestId: triggerRequestId } : {}),
              ...(requestedByService ? { service: requestedByService } : {}),
            },
          }
        : {}),
    })

    try {
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

        const deployment = await step.do(`wait-for-latest-production-deployment-${workerToWait}`, {
          retries: {
            limit: 60,
            delay: '1 minute',
            backoff: 'constant',
          },
          timeout: '1 hour',
        }, async () => {
          return await waitForLatestWorkersDeployment(workerToWait)
        })

        workflowLog.set({
          cloudflare: {
            deployment,
          },
        })
      }

      const deployHookTrigger = await step.do('trigger-deploy-hook', async () => {
        if (!deploy_hook_url) {
          throw new NonRetryableError('No deploy hook URL specified')
        }

        const response = await fetch(deploy_hook_url, { method: 'POST' })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`Deploy hook trigger failed with ${response.status}${error ? `: ${error}` : ''}`)
        }

        return {
          status: response.status,
        }
      })

      workflowLog.set({
        deployHook: {
          ...getDeployHookLogContext(deploy_hook_url),
          triggered: true,
          status: deployHookTrigger.status,
        },
      })

      workflowLog.emit({ status: 200 })
    }
    catch (error) {
      workflowLog.error(toError(error), {
        workflow: {
          name: WORKFLOW_NAME,
          id: event.instanceId,
        },
      })
      workflowLog.emit({ status: 500 })
      throw error
    }
  }
}
