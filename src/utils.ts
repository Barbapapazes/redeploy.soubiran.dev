export function getWorkflowId(workerToWait?: string): string {
  if (!workerToWait) {
    return crypto.randomUUID()
  }

  return `worker:${workerToWait}:${crypto.randomUUID()}`
}

export function getWorkflowIdPrefix(workerToWait: string): string {
  return `worker:${workerToWait}:`
}
