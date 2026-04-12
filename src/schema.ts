import z from 'zod'

export const bodySchema = z.object({
  deploy_hook_url: z.url(),
  cloudflare: z.object({
    to_wait: z.object({
      worker: z.string().regex(/^[\w-]+$/),
    }).optional(),
  }).optional(),
})
