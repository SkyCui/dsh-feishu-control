/**
 * Consumer for the Feishu remote-control seam: maps Feishu text messages to
 * agent sessions, drives the agent, sends committed assistant text back to the
 * chat, and answers approval requests for Feishu-owned sessions with an
 * interactive card — or a text-question fallback when card delivery fails. The
 * sender allowlist gates who may drive the agent and who may decide approvals.
 * @module dsh-feishu-control/feishu-agent
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { FeishuCardActionEvent, FeishuEvent } from '../feishu/index.ts'
import type {} from '../feishu/index.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
// Side-effect type import: declaration-merges the approval waterfall answered below.
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-approval'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'feishu-agent'
/** The feishu seam this consumer reads and the agent factory it drives. */
export const inject = ['feishu', 'agents']

/** Plugin config: the sender allowlist, session working directory, and model route. */
export interface Config {
  /** Sender `open_id`s allowed to drive the agent; empty denies every sender. */
  allowedOpenIds: string[]
  /** Absolute working directory for agent sessions created here. */
  cwd?: string
  /** Provider route for created agents. */
  provider?: string
  /** Model name for created agents. */
  model?: string
  /** How long an unanswered approval question waits before failing closed. */
  approvalTimeoutMs?: number
  /** Ask the same question as text when card delivery fails. */
  approvalTextFallback?: boolean
  /** Allow group chats to drive the agent. Disabled by default. */
  allowGroupChats?: boolean
  /** Require a mention in allowed group chats. */
  requireMentionInGroups?: boolean
}

export const Config: z<Config> = z.object({
  allowedOpenIds: z.array(z.string()),
  cwd: z.string(),
  provider: z.string(),
  model: z.string(),
  approvalTimeoutMs: z.number().default(300_000),
  approvalTextFallback: z.boolean().default(true),
  allowGroupChats: z.boolean().default(false),
  requireMentionInGroups: z.boolean().default(true),
})

/** One live chat's agent session and the message currently driving it. */
interface ChatState {
  readonly chatId: string
  readonly sessionId: SessionId
  readonly agent: Agent
  readonly dispose: () => Promise<void>
  /** The latest inbound message id for this chat, used for completion reactions. */
  messageId: string
}

/** One pending approval question awaiting a card click or a chat text answer. */
interface PendingDecision {
  readonly chatId: string
  /** `card` questions settle on button clicks; `text` on chat messages. */
  mode: 'card' | 'text'
  /** Short answer code printed by the text fallback. */
  readonly code: string
  readonly settle: (outcome: ApprovalOutcome) => void
}

/** The button value the approval card carries back on a click. */
interface ApprovalButtonValue {
  decisionId: string
  choice: 'allow-once' | 'rejected'
}

/** A parsed text answer and its optional approval request code. */
interface TextAnswer {
  code?: string
  outcome: 'allowed-once' | 'rejected'
}

/** Text words that answer a text-mode approval question. */
const ALLOW_WORDS = new Set(['允许', 'allow', 'yes', 'y', '1'])
const REJECT_WORDS = new Set(['拒绝', 'reject', 'refuse', 'no', 'n', '0'])

/** Number of recent inbound message ids retained for redelivery suppression. */
const MAX_SEEN_MESSAGES = 2_000

/** Number of leading UUID hex characters shown in a text approval question. */
const ANSWER_CODE_LENGTH = 6

/** Conservative per-message character cap below Feishu's serialized payload limit. */
const MAX_REPLY_CHARACTERS = 4_000

/**
 * Mount the Feishu → agent bridge.
 * @param ctx - Cordis context carrying the feishu seam and the agent factory.
 * @param config - the sender allowlist and optional session working directory.
 */
export function apply(ctx: Context, config: Config): void {
  const agents = ctx.agents
  const feishu = ctx.feishu
  const allowed = new Set(config.allowedOpenIds)
  // Both maps hold the SAME ChatState objects, keyed by chat id and session id
  // respectively, so mutation through either map stays consistent.
  const chats = new Map<string, ChatState>()
  const stateBySession = new Map<SessionId, ChatState>()
  const pending = new Map<string, PendingDecision>()
  const seenMessages = new Map<string, true>()
  // Serialize messages within one chat so two first messages cannot race and
  // create duplicate agent sessions. Different chats still run concurrently.
  const chatQueues = new Map<string, Promise<void>>()
  let stopping = false

  const sendText = (chatId: string, text: string): Promise<void> =>
    feishu.sendText({ chatId, text })
  const react = (messageId: string, emojiType: string): Promise<void> =>
    feishu.addReaction({ messageId, emojiType })
  /** Settle a pending decision and send the click's confirmation text. */
  const confirm = (entry: PendingDecision, outcome: 'allowed-once' | 'rejected'): void => {
    entry.settle(outcome)
    void sendText(entry.chatId, outcome === 'allowed-once' ? '✅ 已允许一次' : '❌ 已拒绝')
      .catch((error: unknown) => { ctx.logger.warn(`feishu-agent: confirmation failed: ${String(error)}`) })
  }

  /** Remember one handled message id and evict the oldest id past the cap. */
  function rememberMessage(messageId: string): void {
    seenMessages.set(messageId, true)
    if (seenMessages.size <= MAX_SEEN_MESSAGES) return
    const oldest = seenMessages.keys().next().value
    if (oldest !== undefined) seenMessages.delete(oldest)
  }

  // Committed assistant text goes back to the chat that owns the session, and
  // the message that triggered the turn gets a completion reaction.
  ctx.on('session/event', (session, event: SessionEvent) => {
    const state = stateBySession.get(session.header.id)
    if (state === undefined || event.type !== 'assistant/message') return
    const text = extractText(event.data.message.content)
    if (text === '') return
    void sendReply(state.chatId, state.messageId, text)
  })

  /** Send long agent output in ordered chunks, then mark the turn complete. */
  async function sendReply(chatId: string, messageId: string, text: string): Promise<void> {
    try {
      for (const chunk of splitText(text, MAX_REPLY_CHARACTERS)) {
        await sendText(chatId, chunk)
      }
    } catch (error) {
      ctx.logger.warn(`feishu-agent: reply failed: ${String(error)}`)
      return
    }
    try {
      await react(messageId, 'OK')
    } catch (error) {
      ctx.logger.warn(`feishu-agent: completion reaction failed: ${String(error)}`)
    }
  }

  feishu.subscribe(async (event) => {
    if (stopping) return
    if (event.kind === 'card-action') {
      handleCardAction(event)
      return
    }
    if (seenMessages.has(event.messageId)) return
    rememberMessage(event.messageId)
    if (event.chatType === 'group' && !config.allowGroupChats) return
    if (event.chatType === 'group' && config.requireMentionInGroups && !event.mentioned) return
    if (!allowed.has(event.senderOpenId)) {
      void sendText(event.chatId, `未授权：你的 open_id（${event.senderOpenId}）不在白名单中。请把它加入 FEISHU_CONTROL_ALLOWED_OPEN_IDS 后重启。`)
        .catch(() => {})
      return
    }
    // A matching text answer settles a pending text-mode question instead of
    // driving the agent.
    if (consumeTextAnswer(event.chatId, event.text)) return
    return enqueueMessage(event)
  })

  /** Append one ordinary message to its chat's processing queue. */
  function enqueueMessage(event: Extract<FeishuEvent, { kind: 'message' }>): Promise<void> {
    const previous = chatQueues.get(event.chatId) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(() => driveMessage(event))
    chatQueues.set(event.chatId, current)
    const cleanup = () => {
      if (chatQueues.get(event.chatId) === current) chatQueues.delete(event.chatId)
    }
    void current.then(cleanup, cleanup)
    return current
  }

  /** Create or reuse the chat session, then hand the message to its agent. */
  async function driveMessage(event: Extract<FeishuEvent, { kind: 'message' }>): Promise<void> {
    // The THINKING reaction is the visible "processing" indicator on the
    // sender's message, proving the bridge is connected and working.
    void react(event.messageId, 'THINKING').catch(() => {})
    let chat = chats.get(event.chatId)
    if (chat === undefined) {
      const handle = await agents.create({
        sessionId: SessionId(randomUUID()),
        ...config.cwd !== undefined ? { meta: { cwd: config.cwd } } : {},
        agentOptions: {
          ...config.provider !== undefined ? { provider: config.provider } : {},
          ...config.model !== undefined ? { model: config.model } : {},
        },
      })
      chat = {
        chatId: event.chatId,
        sessionId: handle.agent.session.id,
        agent: handle.agent,
        dispose: () => handle.dispose(),
        messageId: event.messageId,
      }
      chats.set(event.chatId, chat)
      stateBySession.set(chat.sessionId, chat)
    } else {
      chat.messageId = event.messageId
    }
    chat.agent.followup(createUserMessage({
      content: [{ type: 'text', text: event.text }],
      source: { kind: 'user' },
    }))
  }

  // Approval requests for Feishu-owned sessions are asked in the owning chat;
  // every other session delegates down the waterfall (e.g. to the Web UI).
  ctx.on('approval/request', (request, next) => {
    const state = stateBySession.get(request.agent.session.id)
    if (state === undefined) return next()
    return askOnCard(state, request)
  })

  ctx.effect(() => async () => {
    stopping = true
    // Withdraw every unanswered question so its tool call fails closed.
    for (const entry of pending.values()) entry.settle('cancelled')
    // Let any session creation already in flight finish so it is included in
    // the disposal set instead of becoming an orphan after plugin teardown.
    await Promise.allSettled(chatQueues.values())
    await Promise.all([...chats.values()].map(chat => chat.dispose()))
  }, 'feishu-agent.dispose')

  /** Route one card button click to its pending decision. */
  function handleCardAction(event: FeishuCardActionEvent): void {
    if (event.tag !== 'button') return
    const value = event.value as Readonly<Partial<ApprovalButtonValue>>
    if (value.decisionId === undefined || (value.choice !== 'allow-once' && value.choice !== 'rejected')) return
    const entry = pending.get(value.decisionId)
    if (entry === undefined) return
    // Fail closed when Feishu omits the chat context: a valid decision id is
    // not sufficient on its own to authorize a click.
    if (event.chatId !== entry.chatId) return
    // The same allowlist gates decisions: only allowed operators may click.
    if (!allowed.has(event.operatorOpenId)) return
    // The button vocabulary ('allow-once') differs from the outcome vocabulary
    // ('allowed-once'); translate before settling.
    confirm(entry, value.choice === 'allow-once' ? 'allowed-once' : 'rejected')
  }

  /** Settle an unambiguous text-mode question or the question named by code. */
  function consumeTextAnswer(chatId: string, text: string): boolean {
    const answer = parseTextAnswer(text)
    if (answer === undefined) return false
    const candidates = [...pending.values()].filter(entry => entry.chatId === chatId && entry.mode === 'text')
    const entry = answer.code === undefined
      ? candidates.length === 1 ? candidates[0] : undefined
      : candidates.find(candidate => candidate.code === answer.code)
    if (entry === undefined) return false
    confirm(entry, answer.outcome)
    return true
  }

  /** Ask one approval decision on an interactive card in the owning chat. */
  function askOnCard(state: ChatState, request: ApprovalRequest): Promise<ApprovalOutcome> {
    const decisionId = randomUUID()
    const code = decisionId.slice(0, ANSWER_CODE_LENGTH)
    const chatId = state.chatId
    return new Promise<ApprovalOutcome>((resolve) => {
      let settled = false
      const signal = request.signal
      const onAbort = () => { settle('cancelled') }
      const settle = (outcome: ApprovalOutcome): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        pending.delete(decisionId)
        resolve(outcome)
      }
      const timer = setTimeout(() => { settle('unavailable') }, config.approvalTimeoutMs)
      if (signal?.aborted) {
        settle('cancelled')
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      pending.set(decisionId, { chatId, code, mode: 'card', settle })
      void feishu.sendCard({ chatId, card: buildApprovalCard(decisionId, request) })
        .catch((error: unknown) => {
          ctx.logger.warn(`feishu-agent: approval card failed: ${String(error)}`)
          if (!config.approvalTextFallback) {
            settle('unavailable')
            return
          }
          const entry = pending.get(decisionId)
          if (entry === undefined) return
          entry.mode = 'text'
          void sendText(chatId, textQuestion(request, code)).catch(() => { settle('unavailable') })
        })
    })
  }
}

/** Build the interactive card that asks one approval decision. */
function buildApprovalCard(decisionId: string, request: ApprovalRequest): unknown {
  const lines = [
    `**${request.toolName}** 请求审批`,
    ...request.reason !== undefined ? [request.reason] : [],
  ]
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: 'DSH Agent 审批请求' }, template: 'orange' },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: lines.join('\n') } },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '允许一次' },
            type: 'primary',
            value: { decisionId, choice: 'allow-once' },
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '拒绝' },
            type: 'danger',
            value: { decisionId, choice: 'rejected' },
          },
        ],
      },
    ],
  }
}

/** Build the text question that replaces the card when card delivery fails. */
function textQuestion(request: ApprovalRequest, code: string): string {
  const reason = request.reason !== undefined ? `（${request.reason}）` : ''
  return `需要你审批：**${request.toolName}**${reason}。回复「允许 ${code}」或「拒绝 ${code}」。`
}

/** Parse a chat message into an approval outcome and optional request code. */
function parseTextAnswer(text: string): TextAnswer | undefined {
  const trimmed = text.trim()
  const coded = /^(允许|拒绝|allow|reject)\s+([0-9a-f]{6})$/i.exec(trimmed)
  if (coded !== null) {
    const word = coded[1]!.toLowerCase()
    return {
      code: coded[2]!.toLowerCase(),
      outcome: word === '允许' || word === 'allow' ? 'allowed-once' : 'rejected',
    }
  }
  const word = trimmed.toLowerCase()
  if (ALLOW_WORDS.has(word)) return { outcome: 'allowed-once' }
  if (REJECT_WORDS.has(word)) return { outcome: 'rejected' }
  return undefined
}

/** Concatenate the text blocks of an assistant message. */
function extractText(content: readonly ContentBlock[]): string {
  let out = ''
  for (const block of content) {
    if (block.type === 'text') out += block.text
  }
  return out
}

/** Split by Unicode code points so a chunk never cuts a surrogate pair. */
function splitText(text: string, maxCharacters: number): string[] {
  const characters = [...text]
  const chunks: string[] = []
  for (let offset = 0; offset < characters.length; offset += maxCharacters) {
    chunks.push(characters.slice(offset, offset + maxCharacters).join(''))
  }
  return chunks
}
