/**
 * Feishu long-connection provider for `ctx.feishu`: receives `im.message.receive_v1`
 * and `card.action.trigger` events over the open-platform WebSocket channel and
 * sends text and interactive cards through the message REST API. Credentials are
 * the Feishu app id and secret; no public address is needed because the long
 * connection is outbound.
 * @module dsh-feishu-control/feishu-local/provider
 */

import * as Lark from '@larksuiteoapi/node-sdk'
import { FeishuError } from '../feishu/index.ts'
import type {
  FeishuCardActionEvent,
  FeishuEvent,
  FeishuMessageEvent,
  FeishuProvider,
  FeishuReactionRequest,
  FeishuSendCardRequest,
  FeishuSendTextRequest,
} from '../feishu/index.ts'

/** Stable id this provider registers under. */
export const FEISHU_LOCAL_PROVIDER_ID = 'feishu-local'

/** Resolved credentials for one provider instance. */
export interface FeishuLocalCredentials {
  readonly appId: string
  readonly appSecret: string
}

/** The subset of the SDK's `im.message.receive_v1` payload this provider reads. */
interface ReceiveMessagePayload {
  readonly sender?: { readonly sender_id?: { readonly open_id?: string } }
  readonly message?: {
    readonly message_id?: string
    readonly chat_id?: string
    readonly chat_type?: string
    readonly content?: string
    readonly mentions?: readonly unknown[]
  }
}

/**
 * The subset of the SDK's `card.action.trigger` payload this provider reads.
 * The dispatcher merges the v2 envelope, so `context` (and the top-level
 * fallbacks) carry the message/chat ids.
 */
interface CardActionPayload {
  readonly operator?: { readonly open_id?: string }
  readonly action?: { readonly value?: unknown; readonly tag?: string }
  readonly context?: { readonly open_message_id?: string; readonly open_chat_id?: string }
  readonly open_message_id?: string
  readonly open_chat_id?: string
}

/** The Feishu long-connection provider. */
export class LongConnectionFeishuProvider implements FeishuProvider {
  readonly id = FEISHU_LOCAL_PROVIDER_ID

  /** Reused REST client; the SDK caches the tenant token across calls. */
  private client: Lark.Client | undefined

  constructor(private readonly credentials: FeishuLocalCredentials) {}

  /** Cheap local check: both credentials are non-empty; no network. */
  available(): boolean {
    return this.credentials.appId !== '' && this.credentials.appSecret !== ''
  }

  /** The shared REST client, created once per provider instance. */
  private clientInstance(): Lark.Client {
    this.client ??= new Lark.Client({ appId: this.credentials.appId, appSecret: this.credentials.appSecret })
    return this.client
  }

  async sendText(request: FeishuSendTextRequest, signal?: AbortSignal): Promise<void> {
    return this.sendMessage({
      receive_id: request.chatId,
      content: JSON.stringify({ text: request.text }),
      msg_type: 'text',
    }, signal)
  }

  async addReaction(request: FeishuReactionRequest, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new FeishuError('feishu reaction aborted', 'FEISHU_ABORTED')
    await this.clientInstance().im.v1.messageReaction.create({
      path: { message_id: request.messageId },
      data: { reaction_type: { emoji_type: request.emojiType } },
    })
  }

  async sendCard(request: FeishuSendCardRequest, signal?: AbortSignal): Promise<void> {
    return this.sendMessage({
      receive_id: request.chatId,
      content: JSON.stringify(request.card),
      msg_type: 'interactive',
    }, signal)
  }

  /**
   * Send one message through the REST API. The event's `message.chat_id` is a
   * chat id for both p2p and group chats; the SDK's own examples send replies
   * with `receive_id_type: 'chat_id'`.
   */
  private async sendMessage(
    data: { receive_id: string; content: string; msg_type: 'text' | 'interactive' },
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new FeishuError('feishu send aborted', 'FEISHU_ABORTED')
    await this.clientInstance().im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data,
    })
  }

  start(emit: (event: FeishuEvent) => void): () => void {
    // Without credentials there is no connection to open; the no-op disposer keeps
    // a keyless composition bootable while `available()` stays false.
    if (!this.available()) return () => {}
    // The liveness watchdog (180s without inbound after a ping) terminates a
    // half-open connection so the SDK's autoReconnect re-establishes it; the
    // SDK default disables this, which lets a silently dropped Feishu
    // connection leave the bridge alive but deaf.
    const wsClient = new Lark.WSClient({
      appId: this.credentials.appId,
      appSecret: this.credentials.appSecret,
      wsConfig: { pingTimeout: 180 },
    })
    const eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': (data: ReceiveMessagePayload) => {
        const event = toMessageEvent(data)
        if (event !== undefined) emit(event)
      },
      'card.action.trigger': (data: CardActionPayload) => {
        const event = toCardActionEvent(data)
        if (event !== undefined) emit(event)
      },
    })
    void wsClient.start({ eventDispatcher }).catch((error: unknown) => {
      process.stderr.write(`dsh-feishu-control: long connection stopped: ${String(error)}\n`)
    })
    return () => { wsClient.close() }
  }
}

/** Convert an SDK receive-message payload to the seam's event; drop non-text or malformed messages. */
function toMessageEvent(data: ReceiveMessagePayload): FeishuMessageEvent | undefined {
  const message = data.message
  if (message === undefined) return undefined
  const { message_id: messageId, chat_id: chatId, chat_type: chatType, content, mentions } = message
  const senderOpenId = data.sender?.sender_id?.open_id
  if (messageId === undefined || chatId === undefined || content === undefined || senderOpenId === undefined) return undefined
  if (chatType !== 'p2p' && chatType !== 'group') return undefined
  const text = parseText(content)
  if (text === undefined) return undefined
  return {
    kind: 'message',
    messageId,
    chatId,
    chatType,
    senderOpenId,
    text,
    mentioned: chatType === 'group' && (mentions?.length ?? 0) > 0,
  }
}

/** Parse Feishu's JSON-string `content` field, returning the plain text when present. */
function parseText(content: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const text = (parsed as { readonly text?: unknown }).text
  return typeof text === 'string' ? text : undefined
}

/**
 * Convert an SDK card-action payload to the seam's event. Drops clicks without
 * an operator; string-valued button payload entries pass through, non-string
 * entries are skipped so the consumer never receives unserializable values.
 */
function toCardActionEvent(data: CardActionPayload): FeishuCardActionEvent | undefined {
  const operatorOpenId = data.operator?.open_id
  const action = data.action
  if (operatorOpenId === undefined || action === undefined) return undefined
  const value: Record<string, string> = {}
  if (typeof action.value === 'object' && action.value !== null) {
    for (const [key, entry] of Object.entries(action.value as Record<string, unknown>)) {
      if (typeof entry === 'string') value[key] = entry
    }
  }
  const chatId = data.context?.open_chat_id ?? data.open_chat_id
  const messageId = data.context?.open_message_id ?? data.open_message_id
  return {
    kind: 'card-action',
    ...chatId !== undefined ? { chatId } : {},
    ...messageId !== undefined ? { messageId } : {},
    operatorOpenId,
    tag: action.tag ?? 'button',
    value,
  }
}
