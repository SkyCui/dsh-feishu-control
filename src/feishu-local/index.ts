/**
 * `dsh-feishu-control/feishu-local`: registers the Feishu long-connection provider
 * with `ctx.feishu`. A function/namespace plugin that registers INTO the seam's
 * provider slot, like the web fetch/search providers register into theirs.
 * @module dsh-feishu-control/feishu-local
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '../feishu/index.ts'
import { FeishuError } from '../feishu/index.ts'
import { LongConnectionFeishuProvider } from './provider.ts'

export { FEISHU_LOCAL_PROVIDER_ID, LongConnectionFeishuProvider } from './provider.ts'
export type { FeishuLocalCredentials } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'feishu-local'

/** The feishu seam this provider registers into. */
export const inject = ['feishu']

/** Default env var name the app id falls back to. */
export const DEFAULT_APP_ID_ENV = 'FEISHU_CONTROL_APP_ID'
/** Default env var name the app secret falls back to. */
export const DEFAULT_APP_SECRET_ENV = 'FEISHU_CONTROL_APP_SECRET'
/** Legacy inherited env var accepted for backwards compatibility. */
export const LEGACY_APP_ID_ENV = 'DSH_FEISHU_APP_ID'
/** Legacy inherited env var accepted for backwards compatibility. */
export const LEGACY_APP_SECRET_ENV = 'DSH_FEISHU_APP_SECRET'

/** Plugin config: literal credentials or the env var names that hold them. */
export interface Config {
  /** Literal Feishu app id; prefer {@link appIdEnv} so no secret enters configuration files. */
  appId?: string
  /** Literal Feishu app secret; prefer {@link appSecretEnv} so no secret enters configuration files. */
  appSecret?: string
  /** Env var name holding the app id; defaults to `FEISHU_CONTROL_APP_ID`. */
  appIdEnv?: string
  /** Env var name holding the app secret; defaults to `FEISHU_CONTROL_APP_SECRET`. */
  appSecretEnv?: string
}

export const Config: z<Config> = z.object({
  appId: z.string(),
  appSecret: z.string(),
  appIdEnv: z.string(),
  appSecretEnv: z.string(),
})

/** Register the Feishu long-connection provider with `ctx.feishu`. */
export function apply(ctx: Context, config: Config): void {
  const appId = config.appId
    ?? process.env[config.appIdEnv ?? DEFAULT_APP_ID_ENV]
    ?? (config.appIdEnv === undefined ? process.env[LEGACY_APP_ID_ENV] : undefined)
    ?? ''
  const appSecret = config.appSecret
    ?? process.env[config.appSecretEnv ?? DEFAULT_APP_SECRET_ENV]
    ?? (config.appSecretEnv === undefined ? process.env[LEGACY_APP_SECRET_ENV] : undefined)
    ?? ''
  if (appId === '' || appSecret === '') {
    throw new FeishuError(
      'Feishu credentials are missing; set FEISHU_CONTROL_APP_ID and FEISHU_CONTROL_APP_SECRET',
      'FEISHU_CREDENTIALS_MISSING',
    )
  }
  ctx.feishu.registerProvider(new LongConnectionFeishuProvider({ appId, appSecret }))
}
