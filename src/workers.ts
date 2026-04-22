import type { BuildOutcome, BuildsByVersionInfo, BuildStatus, LatestBuildsByScriptInfo, WorkerBuild, WorkersScriptsInfo } from './types'
import { cloudflare } from './cloudflare'
import { ACCOUNT_ID } from './constants'

export interface LatestWorkersDeploymentInfo {
  worker: string
  versionId: string
  hasBuild: boolean
  buildUuid?: string
  buildStatus?: BuildStatus
  buildOutcome?: BuildOutcome
  externalScriptId?: string
  triggerUuid?: string
  branch?: string
  commitHash?: string
}

async function getWorkerScriptTag(workerToWait: string): Promise<string> {
  const workersScripts = await cloudflare.get(
    `/accounts/${ACCOUNT_ID}/workers/scripts`,
  ) as WorkersScriptsInfo

  const workerScript = workersScripts.result.find(script => script.id === workerToWait)
  if (!workerScript?.tag) {
    throw new Error(`No worker script tag found for worker ${workerToWait}`)
  }

  return workerScript.tag
}

async function getLatestProductionDeploymentBuild(workerToWait: string): Promise<{
  versionId: string
  build?: WorkerBuild
}> {
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
  ) as BuildsByVersionInfo

  return {
    versionId,
    build: buildsByVersion.result?.builds?.[versionId],
  }
}

async function getLatestWorkerBuild(externalScriptId: string): Promise<WorkerBuild | undefined> {
  const latestBuildsByScript = await cloudflare.get(
    `/accounts/${ACCOUNT_ID}/builds/builds/latest?external_script_ids=${externalScriptId}`,
  ) as LatestBuildsByScriptInfo

  return latestBuildsByScript.result?.builds?.[externalScriptId]
}

export async function waitForLatestWorkersDeployment(workerToWait: string): Promise<LatestWorkersDeploymentInfo> {
  const [externalScriptId, latestProductionDeployment] = await Promise.all([
    getWorkerScriptTag(workerToWait),
    getLatestProductionDeploymentBuild(workerToWait),
  ])

  const latestBuild = await getLatestWorkerBuild(externalScriptId)
  if (!latestBuild) {
    return {
      worker: workerToWait,
      versionId: latestProductionDeployment.versionId,
      hasBuild: false,
      externalScriptId,
    }
  }

  if (latestBuild.status !== 'stopped') {
    throw new Error(`Latest build for worker ${workerToWait} is still in progress. Current status: ${latestBuild.status}`)
  }

  if (latestBuild.build_outcome !== 'success') {
    throw new Error(`Latest build for worker ${workerToWait} did not succeed. Current outcome: ${latestBuild.build_outcome}`)
  }

  const latestProductionBuild = latestProductionDeployment.build
  if (!latestProductionBuild || latestProductionBuild.build_uuid !== latestBuild.build_uuid) {
    throw new Error(`Latest successful build for worker ${workerToWait} is not deployed to production yet. Current production version: ${latestProductionDeployment.versionId}`)
  }

  if (latestProductionBuild.build_outcome === 'success') {
    return {
      worker: workerToWait,
      versionId: latestProductionDeployment.versionId,
      hasBuild: true,
      buildUuid: latestBuild.build_uuid,
      buildStatus: latestBuild.status,
      buildOutcome: latestBuild.build_outcome,
      externalScriptId,
      triggerUuid: latestBuild.trigger.trigger_uuid,
      branch: latestBuild.build_trigger_metadata.branch,
      commitHash: latestBuild.build_trigger_metadata.commit_hash,
    }
  }

  throw new Error(`Latest production deployment for worker ${workerToWait} is not successful yet. Current status: ${latestProductionBuild.build_outcome}`)
}
