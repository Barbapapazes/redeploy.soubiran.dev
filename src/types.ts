export type BuildOutcome = 'success' | 'fail' | 'skipped' | 'cancelled' | 'terminated'

export type BuildStatus = 'queued' | 'initializing' | 'running' | 'stopped'

export interface WorkerBuild {
  build_uuid: string
  status: BuildStatus
  build_outcome: BuildOutcome
  trigger: {
    trigger_uuid: string
    external_script_id: string
  }
  build_trigger_metadata: {
    branch: string
    commit_hash: string
  }
}

export interface BuildsByVersionInfo {
  result: {
    builds: Record<string, WorkerBuild>
  }
}

export interface LatestBuildsByScriptInfo {
  result: {
    builds: Record<string, WorkerBuild>
  }
}

export interface WorkersScriptsInfo {
  result: Array<{
    id: string
    tag: string
  }>
}
