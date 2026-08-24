/**
 * Package-owned invariant companion for `dsh-feishu-control/feishu`.
 * @module dsh-feishu-control/feishu/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-feishu-control/feishu'

/** Cordis companion plugin name. */
export const name = 'feishu-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider slot and subscriber set are private, and
 * the seam publishes no independent registry or inbound/outbound observation
 * stream; provider availability and outbound dispatch are enforced per call.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
