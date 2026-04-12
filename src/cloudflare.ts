import Cloudflare from 'cloudflare'
import { env } from 'cloudflare:workers'

export const cloudflare = new Cloudflare({
  apiToken: env.CLOUDFLARE_API_TOKEN,
})
