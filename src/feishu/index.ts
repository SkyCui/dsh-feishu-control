/**
 * Service Definition for the Feishu remote-control capability seam (`ctx.feishu`).
 *
 * The seam owns one provider slot, fans inbound events out to subscribers, and
 * sends outbound text and interactive cards through the registered provider. It
 * carries no configuration of its own: credentials belong to the provider
 * package and the sender allowlist to the consumer package.
 *
 * @module dsh-feishu-control/feishu
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  FeishuEvent,
  FeishuProvider,
  FeishuReactionRequest,
  FeishuSendCardRequest,
  FeishuSendTextRequest,
} from './types.ts'
import { FeishuError } from './types.ts'

export { FeishuError } from './types.ts'
export type {
  FeishuCardActionEvent,
  FeishuEvent,
  FeishuMessageEvent,
  FeishuProvider,
  FeishuReactionRequest,
  FeishuSendCardRequest,
  FeishuSendTextRequest,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    feishu: FeishuRuntime
  }
}

/** One inbound-event subscriber. */
export type FeishuEventHandler = (event: FeishuEvent) => void | Promise<void>

/**
 * The Feishu access service, registered as `ctx.feishu` (one instance per
 * context). A provider registers with {@link registerProvider} and is started
 * lazily once the first subscriber appears; {@link sendText} resolves the
 * provider at call time and fails loud when none is registered or usable.
 */
export class FeishuRuntime extends Service {
  private provider: FeishuProvider | undefined
  private readonly handlers = new Set<FeishuEventHandler>()
  private stopProvider: (() => void) | undefined

  constructor(ctx: Context) {
    super(ctx, 'feishu')
  }

  /**
   * Register the provider backing this seam. A second registration throws
   * {@link FeishuError} `FEISHU_DUPLICATE_PROVIDER`. The returned disposer stops
   * and unregisters the provider; it is also disposed with the calling fiber.
   * @param provider - the provider; its `id` appears only in diagnostics.
   * @returns the disposer that unregisters the provider.
   */
  registerProvider(provider: FeishuProvider): () => void {
    if (this.provider !== undefined) {
      throw new FeishuError('a feishu provider is already registered', 'FEISHU_DUPLICATE_PROVIDER')
    }
    const dispose = this.ctx.effect(() => {
      this.provider = provider
      this.ensureStarted()
      return () => {
        this.stopProvider?.()
        this.stopProvider = undefined
        this.provider = undefined
      }
    }, 'feishu.registerProvider()')
    return () => void dispose()
  }

  /**
   * Subscribe to inbound Feishu events. The provider starts lazily on the first
   * subscription. The returned disposer removes the handler; a handler rejection
   * is logged, never propagated to the provider's emit.
   * @param handler - invoked with each inbound event.
   * @returns the disposer that removes the subscription.
   */
  subscribe(handler: FeishuEventHandler): () => void {
    const dispose = this.ctx.effect(() => {
      this.handlers.add(handler)
      this.ensureStarted()
      return () => {
        this.handlers.delete(handler)
      }
    }, 'feishu.subscribe()')
    return () => void dispose()
  }

  /**
   * Send one text message through the registered provider. Throws
   * {@link FeishuError} `FEISHU_PROVIDER_MISSING` when no provider is registered
   * and `FEISHU_PROVIDER_UNAVAILABLE` when the provider reports unavailable.
   * @param request - target chat and text.
   * @param signal - optional cancellation signal forwarded to the provider.
   */
  async sendText(request: FeishuSendTextRequest, signal?: AbortSignal): Promise<void> {
    return this.requireProvider().sendText(request, signal)
  }

  /**
   * Send one interactive card through the registered provider, with the same
   * resolution and failure codes as {@link sendText}.
   * @param request - target chat and the card JSON object.
   * @param signal - optional cancellation signal forwarded to the provider.
   */
  async sendCard(request: FeishuSendCardRequest, signal?: AbortSignal): Promise<void> {
    return this.requireProvider().sendCard(request, signal)
  }

  /**
   * Add one emoji reaction to a message through the registered provider, with
   * the same resolution and failure codes as {@link sendText}.
   * @param request - the message id and emoji type.
   * @param signal - optional cancellation signal forwarded to the provider.
   */
  async addReaction(request: FeishuReactionRequest, signal?: AbortSignal): Promise<void> {
    return this.requireProvider().addReaction(request, signal)
  }

  /** Resolve the registered provider or throw the seam's fail-loud codes. */
  private requireProvider(): FeishuProvider {
    const provider = this.provider
    if (provider === undefined) {
      throw new FeishuError('no feishu provider is registered', 'FEISHU_PROVIDER_MISSING')
    }
    if (!provider.available()) {
      throw new FeishuError(`feishu provider "${provider.id}" is unavailable`, 'FEISHU_PROVIDER_UNAVAILABLE')
    }
    return provider
  }

  /** Start the provider once a provider and at least one subscriber both exist. */
  private ensureStarted(): void {
    if (this.stopProvider !== undefined || this.provider === undefined || this.handlers.size === 0) return
    this.stopProvider = this.provider.start((event) => { this.dispatch(event) })
  }

  /** Deliver one event to every subscriber, containing handler failures. */
  private dispatch(event: FeishuEvent): void {
    for (const handler of this.handlers) {
      void Promise.resolve(handler(event)).catch((error: unknown) => {
        this.ctx.logger.warn(`feishu: event handler failed: ${String(error)}`)
      })
    }
  }
}

export default FeishuRuntime
