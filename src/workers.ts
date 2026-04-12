import type { BuildInfo } from './types'
import { cloudflare } from './cloudflare'
import { ACCOUNT_ID } from './constants'

export async function waitForLatestWorkersDeployment(workerToWait: string): Promise<void> {
  const deployments = await cloudflare.workers.scripts.deployments.list(workerToWait, { account_id: ACCOUNT_ID })
  const latestDeployment = deployments.deployments[0]
  if (!latestDeployment) {
    throw new Error(`No production deployment found for worker ${workerToWait}`)
  }

  const latestVersion = latestDeployment.versions[0]
  if (!latestVersion) {
    throw new Error(`No version found for latest deployment of worker ${workerToWait}`)
  }

  const versionId = latestVersion.version_id
  const buildsByVersion = await cloudflare.get(
    `/accounts/${ACCOUNT_ID}/builds/builds?version_ids=${versionId}`,
  ) as BuildInfo

  const build = buildsByVersion.result?.builds?.[versionId]
  if (!build) {
    return // Not every worker version has an associated build (for example manual deployments)
  }

  if (build.status === 'success') {
    return
  }

  throw new Error(`Latest production deployment for worker ${workerToWait} is not successful yet. Current status: ${build.status}`)
}
