export async function getDeployHookUrlHash(deployHookUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(deployHookUrl))
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

export async function getWorkflowId(workerToWait: string | undefined, deployHookUrl: string): Promise<string> {
  if (!workerToWait) {
    return crypto.randomUUID()
  }

  const deployHookUrlHash = await getDeployHookUrlHash(deployHookUrl)
  return `worker-${workerToWait}-hook-${deployHookUrlHash}-${crypto.randomUUID()}`
}

export async function getWorkflowIdPrefix(workerToWait: string, deployHookUrl: string): Promise<string> {
  const deployHookUrlHash = await getDeployHookUrlHash(deployHookUrl)
  return `worker-${workerToWait}-hook-${deployHookUrlHash}-`
}

export function getDeployHookLogContext(deployHookUrl: string): { host: string, pathname: string } {
  const url = new URL(deployHookUrl)
  const segments = url.pathname.split('/').filter(Boolean)
  const pathname = segments.length > 0
    ? `/${[...segments.slice(0, -1), '[redacted]'].join('/')}`
    : '/'

  return {
    host: url.host,
    pathname,
  }
}

export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}
