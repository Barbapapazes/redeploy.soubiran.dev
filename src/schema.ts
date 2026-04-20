import z from 'zod'

const cloudflareWorkerSchema = z.object({
  worker: z.string().regex(/^[\w-]+$/),
})

export const bodySchema = z.object({
  deploy_hook_url: z.url(),
  cloudflare: z.object({
    to_wait: cloudflareWorkerSchema.optional(),
  }).optional(),
})
