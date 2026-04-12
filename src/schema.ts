import z from 'zod'

const cloudflareWorkerSchema = z.object({
  worker: z.string().regex(/^[\w-]+$/),
})

export const bodySchema = z.object({
  deploy_hook_url: z.url().optional(),
  cloudflare: z.object({
    to_wait: cloudflareWorkerSchema.optional(),
    to_redeploy: cloudflareWorkerSchema.optional(),
  }).optional(),
}).refine(
  data => Boolean(data.deploy_hook_url || data.cloudflare?.to_redeploy?.worker),
  {
    message: 'Either deploy_hook_url or cloudflare.to_redeploy.worker must be provided',
    path: ['deploy_hook_url'],
  },
)
