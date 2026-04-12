export interface BuildInfo {
  result: {
    builds: {
      [versionId: string]: {
        status: 'queued' | 'in_progress' | 'success' | 'failure' | 'canceled'
        trigger: {
          trigger_uuid: string
        }
        build_trigger_metadata: {
          branch: string
          commit_hash: string
        }
      }
    }
  }
}
