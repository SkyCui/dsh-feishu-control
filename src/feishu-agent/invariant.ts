/**
 * Package-owned invariant companion for `dsh-feishu-control/feishu-agent`.
 * @module dsh-feishu-control/feishu-agent/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-feishu-control/feishu-agent'

/** Cordis companion plugin name. */
export const name = 'feishu-agent-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package bridges the feishu seam and the agent
 * factory, but publishes no independent event sequence or mutable data relation
 * beyond what those owning seams already observe.
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
