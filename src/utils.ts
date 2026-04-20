export function getWorkflowId(workerToWait?: string): string {
  if (!workerToWait) {
    return crypto.randomUUID()
  }

  return `worker-${workerToWait}-${crypto.randomUUID()}`
}

export function getWorkflowIdPrefix(workerToWait: string): string {
  return `worker-${workerToWait}-`
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
