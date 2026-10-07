import { bindings, defineConfig, exports } from 'cf/config'
import * as entrypoint from './src/index' with { type: 'cf-worker' }

export default defineConfig({
  worker: {
    name: 'redeploy-soubiran-dev',
    entrypoint,
    compatibilityDate: '2026-02-20',
    compatibilityFlags: ['nodejs_compat'],
    domains: ['redeploy.soubiran.dev'],
    workersDev: false,
    previewUrls: false,
    observability: {
      enabled: true,
      logs: { invocationLogs: false },
    },
    env: {
      CLOUDFLARE_API_TOKEN: bindings.secret(),
      SENTRY_DSN: bindings.text(''),
      SENTRY_ENVIRONMENT: bindings.text('production'),
      REDEPLOY_SOUBIRAN_DEV: bindings.workflow({
        name: 'redeploy-soubiran-dev',
        worker: 'redeploy-soubiran-dev',
        exportName: 'RedeploySoubiranDev',
      }),
    },
    exports: {
      RedeploySoubiranDev: exports.workflow({ name: 'redeploy-soubiran-dev' }),
    },
  },
})
