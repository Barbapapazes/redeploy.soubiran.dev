import Cloudflare from 'cloudflare'
import { env } from 'cloudflare:workers'

export const cloudflare = new Cloudflare({
  apiToken: env.CF_API_TOKEN,
})
