import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { instrumentWorkflowWithSentry, setContext, setTag, withSentry } from '@sentry/cloudflare'
import { WorkflowEntrypoint } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { createRequestLogger } from 'evlog'
import { createWorkersLogger, initWorkersLogger } from 'evlog/workers'
import z from 'zod'
import { cloudflare } from './cloudflare'
import { ACCOUNT_ID, WORKFLOW_NAME } from './constants'
import { bodySchema } from './schema'
import { getSentryOptions } from './sentry'
import { getDeployHookLogContext, getWorkflowId, getWorkflowIdPrefix, toError } from './utils'
import { waitForLatestWorkersDeployment } from './workers'

initWorkersLogger({
  env: { service: 'redeploy-soubiran-dev' },
})

export default withSentry(getSentryOptions, {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    const url = new URL(request.url)
    const callerService = request.headers.get('x-service') ?? undefined

    const log = createWorkersLogger(request, {
      headers: ['x-service'],
      executionCtx: ctx,
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

        const workflowId = await getWorkflowId(workerToWait, deployHookUrl)
        setTag('workflow.id', workflowId)
        if (requestId) {
          setTag('request.id', requestId)
        }
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
})

interface RedeploySoubiranDevPayload {
  deploy_hook_url: string
  workerToWait?: string
  requestedByService?: string
  triggerRequestId?: string
}

class RedeploySoubiranDevWorkflow extends WorkflowEntrypoint<Env, RedeploySoubiranDevPayload> {
  async run(event: Readonly<WorkflowEvent<RedeploySoubiranDevPayload>>, step: WorkflowStep) {
    const { deploy_hook_url, requestedByService, triggerRequestId, workerToWait } = event.payload

    setTag('workflow.id', event.instanceId)
    setContext('workflow', {
      name: WORKFLOW_NAME,
      id: event.instanceId,
      triggerRequestId,
      worker: workerToWait,
    })

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

          const workflowIdPrefix = await getWorkflowIdPrefix(workerToWait, deploy_hook_url)

          const otherInstances = json.result
            .filter(instance => instance.id !== event.instanceId) // Remove itself from the list
            .filter(instance => instance.id.startsWith(workflowIdPrefix)) // Keep only instances related to the same target and deploy hook to wait for

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

        let response: Response
        try {
          response = await fetch(deploy_hook_url, { method: 'POST' })
        }
        catch {
          // Fetch errors can contain the full URL. Don't log the secret hook.
          throw new Error('Deploy hook request failed')
        }

        if (!response.ok) {
          // Upstream response bodies can also echo the hook token.
          throw new Error(`Deploy hook trigger failed with ${response.status}`)
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

// Preserve the named export used by the Workflow binding.
export const RedeploySoubiranDev = instrumentWorkflowWithSentry(getSentryOptions, RedeploySoubiranDevWorkflow)
