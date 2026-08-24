/**
 * Vocabulary for the Feishu remote-control capability seam (`ctx.feishu`).
 * The seam moves two inbound event kinds — text messages and card button
 * clicks — and two outbound request kinds: text and interactive cards.
 * @module dsh-feishu-control/feishu/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Typed Feishu error with a stable machine-routable `code` and chained `cause`.
 * Consumers route on `code`, never by parsing `message`.
 */
export class FeishuError extends HarnessError {}

/**
 * A text message delivered from Feishu over the long-connection event stream.
 * `messageId`/`chatId`/`senderOpenId` are Feishu's opaque identifiers, passed
 * through uninterpreted so the consumer can key sessions on them.
 */
export interface FeishuMessageEvent {
  readonly kind: 'message'
  /** Feishu message id, unique per message. */
  readonly messageId: string
  /** Feishu chat id: the peer's `open_id` for single chat, else the group `chat_id`. */
  readonly chatId: string
  /** Chat kind: single chat or group. The provider uses it to route replies. */
  readonly chatType: 'p2p' | 'group'
  /** Sender's `open_id`. */
  readonly senderOpenId: string
  /** Plain text of the message. */
  readonly text: string
  /** True when the bot was @-mentioned (group messages); false in single chat. */
  readonly mentioned: boolean
}

/**
 * A card button click delivered from Feishu over the long-connection event
 * stream. `value` is the custom JSON the sender attached to the button; the
 * approval-card consumer carries its request id and the chosen outcome there.
 * Feishu's card callback may omit the chat or message id, so both are optional.
 */
export interface FeishuCardActionEvent {
  readonly kind: 'card-action'
  /** The chat the card lives in, when the event carries it. */
  readonly chatId?: string
  /** The card message id, when the event carries it. */
  readonly messageId?: string
  /** The Feishu user who clicked the button. */
  readonly operatorOpenId: string
  /** The clicked element's tag, e.g. `button`. */
  readonly tag: string
  /** The button's custom value payload, keyed by the sender. */
  readonly value: Readonly<Record<string, string>>
}

/**
 * Inbound events the seam dispatches to subscribers. Closed in this package; a
 * new kind is a coordinated change, and consumers switch on `kind` ending in
 * `assertNever`.
 */
export type FeishuEvent = FeishuMessageEvent | FeishuCardActionEvent

/**
 * One outbound text message. The seam imposes no length cap; the provider owns
 * Feishu's per-message limits and truncation policy.
 */
export interface FeishuSendTextRequest {
  /** Target chat id, matching an inbound event's `chatId`. */
  readonly chatId: string
  /** Message body. */
  readonly text: string
}

/**
 * One emoji reaction to add to an inbound message. The emoji type string is
 * Feishu's reaction vocabulary (e.g. `THINKING` for 🤔, `OK` for 👍); invalid
 * types fail on the Feishu API, so the provider passes them through unverified.
 */
export interface FeishuReactionRequest {
  /** The inbound message id to react to. */
  readonly messageId: string
  /** Feishu emoji type string, e.g. `THINKING`. */
  readonly emojiType: string
}

/**
 * One outbound interactive card. The card object follows Feishu's interactive
 * card JSON schema; the provider serializes it, and Feishu rejects malformed
 * cards on the API, so the seam performs no schema validation.
 */
export interface FeishuSendCardRequest {
  /** Target chat id, matching an inbound event's `chatId`. */
  readonly chatId: string
  /** Interactive card JSON object (Feishu card schema). */
  readonly card: unknown
}

/**
 * A Feishu-capable backend registered with `ctx.feishu`. Exactly one provider
 * may be registered at a time; tests substitute a scripted provider.
 */
export interface FeishuProvider {
  /** Stable provider id, used only in diagnostics and error codes. */
  readonly id: string
  /** Cheap local usability check (credentials configured); must not make network calls. */
  available(): boolean
  /** Send one text message; honor `signal` for cancellation. */
  sendText(request: FeishuSendTextRequest, signal?: AbortSignal): Promise<void>
  /** Send one interactive card; honor `signal` for cancellation. */
  sendCard(request: FeishuSendCardRequest, signal?: AbortSignal): Promise<void>
  /** Add one emoji reaction to a message; honor `signal` for cancellation. */
  addReaction(request: FeishuReactionRequest, signal?: AbortSignal): Promise<void>
  /** Begin delivering inbound events to `emit`; the returned disposer stops the source. */
  start(emit: (event: FeishuEvent) => void): () => void
}
