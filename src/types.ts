export interface BuildInfo {
  result: {
    builds: {
      [versionId: string]: {
        build_outcome: 'success' | 'fail' | 'skipped' | 'cancelled' | 'terminated'
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
