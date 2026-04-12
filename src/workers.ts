import type { BuildInfo } from './types'
import { env } from 'cloudflare:workers'
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

export async function redeployWorker(workerToRedeploy: string): Promise<void> {
  const deployments = await cloudflare.workers.scripts.deployments.list(workerToRedeploy, { account_id: ACCOUNT_ID })
  const latestDeployment = deployments.deployments[0]
  if (!latestDeployment) {
    throw new Error(`No deployment found for worker ${workerToRedeploy}`)
  }

  const latestVersion = latestDeployment.versions[0]
  if (!latestVersion) {
    throw new Error(`No version found for latest deployment of worker ${workerToRedeploy}`)
  }

  const versionId = latestVersion.version_id

  const buildsByVersion = await cloudflare.get(
    `/accounts/${ACCOUNT_ID}/builds/builds?version_ids=${versionId}`,
  ) as BuildInfo
  const build = buildsByVersion.result?.builds?.[versionId]
  if (!build) {
    throw new Error(`Latest deployment of worker ${workerToRedeploy} has no associated build trigger to retrigger`)
  }
  const triggerUuid = build.trigger?.trigger_uuid
  if (!triggerUuid) {
    throw new Error(`Missing build trigger UUID for latest deployment of worker ${workerToRedeploy}`)
  }

  const branch = build.build_trigger_metadata?.branch
  const commitHash = build.build_trigger_metadata?.commit_hash
  if (!branch || !commitHash) {
    throw new Error(`Missing build trigger metadata for latest deployment of worker ${workerToRedeploy}`)
  }

  // FIXME: cloudflare.post doesn't work for this endpoint for some reason.
  // Returns `Error: 400 {"success":false,"messages":[],"errors":[{"code":12002,"message":"Invalid request body"}],"result":null}`
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/builds/triggers/${triggerUuid}/builds`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        branch,
        commit_hash: commitHash,
      }),
    },
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Worker redeploy failed with ${response.status}${error ? `: ${error}` : ''}`)
  }
}
