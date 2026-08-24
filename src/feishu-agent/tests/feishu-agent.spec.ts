import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as feishuAgent from 'dsh-feishu-control/feishu-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'

interface SentText {
  chatId: string
  text: string
}

interface SentCard {
  chatId: string
  card: unknown
}

/** A minimal session stand-in: the approval service reaches `.append`/`.events`. */
interface FakeSession {
  id: SessionId
  events: Array<{ type: string }>
  append: (type: string, data: Record<string, unknown>) => unknown
}

interface FakeAgent {
  session: FakeSession
  followups: unknown[]
  disposed: boolean
  followup(message: unknown): void
}

function makeAgent(sessionId: SessionId): FakeAgent {
  const session: FakeSession = {
    id: sessionId,
    events: [],
    append(type: string, data: Record<string, unknown>) {
      session.events.push({ type })
      return { type, data }
    },
  }
  return {
    session,
    followups: [],
    disposed: false,
    followup(message: unknown) {
      this.followups.push(message)
    },
  }
}

function makeFeishu(options: { failSend?: boolean; failReaction?: boolean; failSendCard?: boolean } = {}) {
  const handlers: ((event: unknown) => void | Promise<void>)[] = []
  const sends: SentText[] = []
  const cards: SentCard[] = []
  const reactions: { messageId: string; emojiType: string }[] = []
  return {
    handlers,
    sends,
    cards,
    reactions,
    subscribe(handler: (event: unknown) => void | Promise<void>) {
      handlers.push(handler)
      return () => {}
    },
    sendText(request: SentText) {
      sends.push(request)
      return options.failSend ? Promise.reject(new Error('send failed')) : Promise.resolve()
    },
    sendCard(request: SentCard) {
      cards.push(request)
      return options.failSendCard ? Promise.reject(new Error('card failed')) : Promise.resolve()
    },
    addReaction(request: { messageId: string; emojiType: string }) {
      reactions.push(request)
      return options.failReaction ? Promise.reject(new Error('reaction failed')) : Promise.resolve()
    },
  }
}

function makeAgents() {
  const created: FakeAgent[] = []
  const createOptions: unknown[] = []
  return {
    created,
    createOptions,
    async create(options: { sessionId: SessionId }) {
      const agent = makeAgent(options.sessionId)
      created.push(agent)
      createOptions.push(options)
      return { agent, dispose: () => { agent.disposed = true; return Promise.resolve() } }
    },
  }
}

interface Mounted {
  ctx: Context
  fiber: Awaited<ReturnType<Context['plugin']>>
  feishu: ReturnType<typeof makeFeishu>
  agents: ReturnType<typeof makeAgents>
}

async function mount(
  config: Record<string, unknown> = {},
  feishuOptions: { failSend?: boolean; failReaction?: boolean; failSendCard?: boolean } = {},
): Promise<Mounted> {
  const ctx = new Context()
  const feishu = makeFeishu(feishuOptions)
  const agents = makeAgents()
  ctx.provide('feishu', feishu)
  ctx.provide('agents', agents)
  await ctx.plugin(ApprovalService)
  const fiber = await ctx.plugin(feishuAgent, { allowedOpenIds: ['ou_user'], ...config })
  return { ctx, fiber, feishu, agents }
}

function messageEvent(overrides: Record<string, unknown> = {}): unknown {
  return {
    kind: 'message',
    messageId: 'm1',
    chatId: 'ou_user',
    chatType: 'p2p',
    senderOpenId: 'ou_user',
    text: 'hi',
    mentioned: false,
    ...overrides,
  }
}

function cardActionEvent(overrides: Record<string, unknown> = {}): unknown {
  return {
    kind: 'card-action',
    chatId: 'ou_user',
    operatorOpenId: 'ou_user',
    tag: 'button',
    value: { decisionId: 'd1', choice: 'allow-once' },
    ...overrides,
  }
}

async function deliver(feishu: ReturnType<typeof makeFeishu>, event: unknown): Promise<void> {
  await feishu.handlers[0]!(event)
}

function assistantEvent(sessionId: SessionId, content: unknown): [Session, SessionEvent] {
  return [
    { header: { id: sessionId } },
    { type: 'assistant/message', data: { turn: 1, step: 1, message: { content } } },
  ] as unknown as [Session, SessionEvent]
}

/** Cast one created fake agent into the Agent the approval service expects. */
function asAgent(agent: FakeAgent): Agent {
  return agent as unknown as Agent
}

/** Open a turn on the fake session (the approval service's enclosure precondition). */
function openTurn(agent: FakeAgent): void {
  agent.session.events.push({ type: 'turn/start' })
}

/** The first button value of the approval card the consumer sent. */
function cardButtons(feishu: ReturnType<typeof makeFeishu>): Array<{ value: Record<string, string> }> {
  const card = feishu.cards[0]!.card as { elements: Array<{ actions?: Array<{ value: Record<string, string> }> }> }
  const actions = card.elements[1]?.actions
  if (actions === undefined) throw new Error('approval card has no actions element')
  return actions
}

describe('feishu-agent allowlist', () => {
  it('rejects a sender outside the allowlist without driving the agent', async () => {
    const { feishu, agents } = await mount({ allowedOpenIds: ['ou_boss'] })
    await deliver(feishu, messageEvent({ senderOpenId: 'ou_stranger' }))
    expect(feishu.sends).toEqual([{ chatId: 'ou_user', text: expect.stringContaining('未授权') as unknown as string }])
    expect(agents.created).toHaveLength(0)
  })

  it('guides a beginner through allowlisting the sender without exposing an env-var name', async () => {
    const { feishu } = await mount({ allowedOpenIds: ['ou_boss'] })
    await deliver(feishu, messageEvent({ senderOpenId: 'ou_stranger' }))
    const refusal = feishu.sends[0]!.text
    expect(refusal).toContain('ou_stranger')
    expect(refusal).toContain('pnpm dlx dsh-feishu-control@latest setup')
    expect(refusal).toContain('粘贴该值并完成配置，然后重启飞书控制服务')
    expect(refusal).not.toContain('FEISHU_CONTROL_ALLOWED_OPEN_IDS')
  })

  it('swallows a failed rejection reply', async () => {
    const { feishu, agents } = await mount({ allowedOpenIds: ['ou_boss'] }, { failSend: true })
    await deliver(feishu, messageEvent({ senderOpenId: 'ou_stranger' }))
    expect(agents.created).toHaveLength(0)
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('denies every sender when the allowlist is empty', async () => {
    const { feishu, agents } = await mount({ allowedOpenIds: [] })
    await deliver(feishu, messageEvent())
    expect(agents.created).toHaveLength(0)
    expect(feishu.sends[0]?.text).toContain('未授权')
  })
})

describe('feishu-agent message → session → reply', () => {
  it('creates one session per chat and follows up with the message text', async () => {
    const { feishu, agents } = await mount()
    await deliver(feishu, messageEvent({ text: 'hello' }))
    expect(agents.created).toHaveLength(1)
    expect(agents.created[0]!.followups).toHaveLength(1)
    expect(agents.created[0]!.followups[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    })

    await deliver(feishu, messageEvent({ messageId: 'm2', text: 'again' }))
    expect(agents.created).toHaveLength(1)
    expect(agents.created[0]!.followups).toHaveLength(2)
  })

  it('passes cwd, provider, and model to the agent factory', async () => {
    const { feishu, agents } = await mount({ cwd: '/work', provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    await deliver(feishu, messageEvent())
    expect(agents.createOptions[0]).toMatchObject({
      meta: { cwd: '/work' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
  })

  it('omits absent agent options', async () => {
    const { feishu, agents } = await mount()
    await deliver(feishu, messageEvent())
    expect(agents.createOptions[0]).not.toHaveProperty('meta')
    expect((agents.createOptions[0] as { agentOptions: unknown }).agentOptions).toEqual({})
  })

  it('sends committed assistant text back to the owning chat', async () => {
    const { ctx, feishu, agents } = await mount()
    await deliver(feishu, messageEvent())
    const [session, event] = assistantEvent(agents.created[0]!.session.id, [{ type: 'text', text: 'pong' }])
    ctx.emit('session/event', session, event)
    expect(feishu.sends).toEqual([{ chatId: 'ou_user', text: 'pong' }])
  })

  it('reacts THINKING on receive and OK on reply', async () => {
    const { ctx, feishu, agents } = await mount()
    await deliver(feishu, messageEvent({ messageId: 'm_1', text: 'hello' }))
    expect(feishu.reactions).toEqual([{ messageId: 'm_1', emojiType: 'THINKING' }])

    const [session, event] = assistantEvent(agents.created[0]!.session.id, [{ type: 'text', text: 'pong' }])
    ctx.emit('session/event', session, event)
    await vi.waitFor(() => {
      expect(feishu.reactions).toEqual([
        { messageId: 'm_1', emojiType: 'THINKING' },
        { messageId: 'm_1', emojiType: 'OK' },
      ])
    })
  })

  it('reacts THINKING for the latest message in a chat', async () => {
    const { ctx, feishu, agents } = await mount()
    await deliver(feishu, messageEvent({ messageId: 'm_1', text: 'one' }))
    await deliver(feishu, messageEvent({ messageId: 'm_2', text: 'two' }))
    expect(feishu.reactions).toEqual([
      { messageId: 'm_1', emojiType: 'THINKING' },
      { messageId: 'm_2', emojiType: 'THINKING' },
    ])

    const [session, event] = assistantEvent(agents.created[0]!.session.id, [{ type: 'text', text: 'pong' }])
    ctx.emit('session/event', session, event)
    await vi.waitFor(() => {
      expect(feishu.reactions.at(-1)).toEqual({ messageId: 'm_2', emojiType: 'OK' })
    })
  })

  it('swallows failed reactions without breaking the flow', async () => {
    const { ctx, feishu, agents } = await mount({}, { failReaction: true })
    await deliver(feishu, messageEvent({ messageId: 'm_1', text: 'hello' }))
    expect(agents.created).toHaveLength(1)
    const [session, event] = assistantEvent(agents.created[0]!.session.id, [{ type: 'text', text: 'pong' }])
    ctx.emit('session/event', session, event)
    expect(feishu.sends).toEqual([{ chatId: 'ou_user', text: 'pong' }])
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('skips a reply when the assistant text is empty', async () => {
    const { ctx, feishu, agents } = await mount()
    await deliver(feishu, messageEvent())
    const [session, event] = assistantEvent(agents.created[0]!.session.id, [{ type: 'reasoning', text: 'thinking' }])
    ctx.emit('session/event', session, event)
    expect(feishu.sends).toHaveLength(0)
  })

  it('ignores assistant events from other sessions', async () => {
    const { ctx, feishu } = await mount()
    const [session, event] = assistantEvent(SessionId('00000000-0000-0000-0000-000000000000'), [{ type: 'text', text: 'nope' }])
    ctx.emit('session/event', session, event)
    expect(feishu.sends).toHaveLength(0)
  })

  it('logs and swallows a failed reply', async () => {
    const { ctx, feishu, agents } = await mount({}, { failSend: true })
    await deliver(feishu, messageEvent())
    const [session, event] = assistantEvent(agents.created[0]!.session.id, [{ type: 'text', text: 'pong' }])
    ctx.emit('session/event', session, event)
    // Allow the rejected promise's catch to run without surfacing an unhandled rejection.
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('sends long assistant output as ordered Unicode-safe chunks', async () => {
    const { ctx, feishu, agents } = await mount()
    await deliver(feishu, messageEvent())
    const output = `${'a'.repeat(4_000)}${'😀'.repeat(4_000)}tail`
    const [session, event] = assistantEvent(agents.created[0]!.session.id, [{ type: 'text', text: output }])

    ctx.emit('session/event', session, event)
    await vi.waitFor(() => { expect(feishu.sends).toHaveLength(3) })

    expect(feishu.sends.map(send => send.text).join('')).toBe(output)
    expect([...feishu.sends[0]!.text]).toHaveLength(4_000)
    expect([...feishu.sends[1]!.text]).toHaveLength(4_000)
    expect(feishu.sends[2]!.text).toBe('tail')
  })

  it('disposes every session agent on plugin teardown', async () => {
    const { feishu, agents, fiber } = await mount()
    await deliver(feishu, messageEvent({ text: 'one' }))
    await deliver(feishu, messageEvent({ messageId: 'm2', chatId: 'ou_other', text: 'two' }))
    expect(agents.created).toHaveLength(2)
    await fiber.dispose()
    expect(agents.created.every(agent => agent.disposed)).toBe(true)
  })

  it('waits for in-flight session creation before teardown completes', async () => {
    const { feishu, agents, fiber } = await mount()
    const originalCreate = agents.create.bind(agents)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let creating = false
    agents.create = async (options) => {
      creating = true
      await gate
      return originalCreate(options)
    }

    const delivery = feishu.handlers[0]!(messageEvent())
    await vi.waitFor(() => { expect(creating).toBe(true) })
    const disposal = fiber.dispose()
    release()
    await Promise.all([delivery, disposal])

    expect(agents.created).toHaveLength(1)
    expect(agents.created[0]!.disposed).toBe(true)
  })
})

describe('feishu-agent message deduplication and group gating', () => {
  it('drives the agent once when Feishu redelivers a message id', async () => {
    const { feishu, agents } = await mount()
    await deliver(feishu, messageEvent({ messageId: 'm_duplicate' }))
    await deliver(feishu, messageEvent({ messageId: 'm_duplicate' }))
    expect(agents.created).toHaveLength(1)
    expect(agents.created[0]!.followups).toHaveLength(1)
  })

  it('serializes simultaneous first messages in one chat', async () => {
    const { feishu, agents } = await mount()
    const first = feishu.handlers[0]!(messageEvent({ messageId: 'm_first', text: 'first' }))
    const second = feishu.handlers[0]!(messageEvent({ messageId: 'm_second', text: 'second' }))
    await Promise.all([first, second])

    expect(agents.created).toHaveLength(1)
    expect(agents.created[0]!.followups).toHaveLength(2)
  })

  it('ignores an unmentioned group message', async () => {
    const { feishu, agents } = await mount({ allowGroupChats: true })
    await deliver(feishu, messageEvent({ chatType: 'group', chatId: 'oc_group', mentioned: false }))
    expect(agents.created).toHaveLength(0)
  })

  it('drives the agent for a mentioned group message', async () => {
    const { feishu, agents } = await mount({ allowGroupChats: true })
    await deliver(feishu, messageEvent({ chatType: 'group', chatId: 'oc_group', mentioned: true }))
    expect(agents.created).toHaveLength(1)
  })

  it('ignores group messages by default', async () => {
    const { feishu, agents } = await mount()
    await deliver(feishu, messageEvent({ chatType: 'group', chatId: 'oc_group', mentioned: true }))
    expect(agents.created).toHaveLength(0)
    expect(feishu.sends).toHaveLength(0)
  })
})

describe('feishu-agent approval card bridge', () => {
  it('asks an approval on a card and allows once on the button click', async () => {
    const { ctx, feishu, agents } = await mount({ allowedOpenIds: ['ou_user'] })
    await deliver(feishu, messageEvent())
    const agent = agents.created[0]!
    openTurn(agent)

    const promise = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash', reason: 'sandbox escalation' })
    await vi.waitFor(() => { expect(feishu.cards).toHaveLength(1) })

    const buttons = cardButtons(feishu)
    expect(buttons).toHaveLength(2)
    const value = buttons[0]!.value
    expect(value).toMatchObject({ choice: 'allow-once' })
    await deliver(feishu, cardActionEvent({ value: { ...value, choice: 'allow-once' } }))

    await expect(promise).resolves.toBe('allowed-once')
    expect(feishu.sends.at(-1)?.text).toContain('已允许')
  })

  it('rejects on the refuse button', async () => {
    const { ctx, feishu, agents } = await mount({ allowedOpenIds: ['ou_user'] })
    await deliver(feishu, messageEvent())
    const agent = agents.created[0]!
    openTurn(agent)

    const promise = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash' })
    await vi.waitFor(() => { expect(feishu.cards).toHaveLength(1) })
    const value = cardButtons(feishu)[1]!.value
    expect(value).toMatchObject({ choice: 'rejected' })
    await deliver(feishu, cardActionEvent({ value }))

    await expect(promise).resolves.toBe('rejected')
    expect(feishu.sends.at(-1)?.text).toContain('已拒绝')
  })

  it('ignores a card click without the originating chat context', async () => {
    const { ctx, feishu, agents } = await mount({ approvalTimeoutMs: 10 })
    await deliver(feishu, messageEvent())
    const agent = agents.created[0]!
    openTurn(agent)

    const promise = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash' })
    await vi.waitFor(() => { expect(feishu.cards).toHaveLength(1) })
    const value = cardButtons(feishu)[0]!.value
    await deliver(feishu, cardActionEvent({ chatId: undefined, value }))

    await expect(promise).resolves.toBe('unavailable')
    expect(feishu.sends.some(send => send.text.includes('已允许'))).toBe(false)
  })

  it('ignores non-button card actions even with a valid decision id', async () => {
    const { ctx, feishu, agents } = await mount({ approvalTimeoutMs: 10 })
    await deliver(feishu, messageEvent())
    const agent = agents.created[0]!
    openTurn(agent)

    const promise = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash' })
    await vi.waitFor(() => { expect(feishu.cards).toHaveLength(1) })
    const value = cardButtons(feishu)[0]!.value
    await deliver(feishu, cardActionEvent({ tag: 'select_static', value }))

    await expect(promise).resolves.toBe('unavailable')
    expect(feishu.sends.some(send => send.text.includes('已允许'))).toBe(false)
  })

  it('fails closed when the card is never answered', async () => {
    const { ctx, feishu, agents } = await mount({ approvalTimeoutMs: 10 })
    await deliver(feishu, messageEvent())
    const agent = agents.created[0]!
    openTurn(agent)

    const promise = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash' })
    await expect(promise).resolves.toBe('unavailable')
    expect(feishu.cards).toHaveLength(1)
  })

  it('settles cancelled when the request is aborted', async () => {
    const { ctx, feishu, agents } = await mount()
    await deliver(feishu, messageEvent())
    const agent = agents.created[0]!
    openTurn(agent)
    const controller = new AbortController()

    const promise = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash', signal: controller.signal })
    await vi.waitFor(() => { expect(feishu.cards).toHaveLength(1) })
    controller.abort()
    await expect(promise).resolves.toBe('cancelled')
  })

  it('delegates a foreign session down the waterfall', async () => {
    const { ctx, feishu } = await mount()
    const foreign = {
      session: { id: SessionId('00000000-0000-0000-0000-000000000000'), events: [{ type: 'turn/start' }], append: () => ({}) },
    } as unknown as Agent
    const outcome = await ctx.approval.request({ agent: foreign, toolName: 'bash' })
    expect(outcome).toBe('unavailable')
    expect(feishu.cards).toHaveLength(0)
  })

  it('falls back to a text question when card delivery fails', async () => {
    const { ctx, feishu, agents } = await mount({ allowedOpenIds: ['ou_user'] }, { failSendCard: true })
    await deliver(feishu, messageEvent())
    const agent = agents.created[0]!
    openTurn(agent)

    const promise = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash', reason: 'escalate' })
    await vi.waitFor(() => { expect(feishu.sends.some(send => send.text.includes('需要你审批'))).toBe(true) })

    await deliver(feishu, messageEvent({ messageId: 'm_answer', text: '允许' }))
    await expect(promise).resolves.toBe('allowed-once')
    // The answer settled the question; it never drove the agent.
    expect(agents.created[0]!.followups).toHaveLength(1)
  })

  it('settles the coded request among concurrent text approvals', async () => {
    const { ctx, fiber, feishu, agents } = await mount({}, { failSendCard: true })
    await deliver(feishu, messageEvent())
    const agent = agents.created[0]!
    openTurn(agent)

    const first = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash', reason: 'first' })
    const second = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash', reason: 'second' })
    await vi.waitFor(() => {
      expect(feishu.sends.filter(send => send.text.includes('需要你审批'))).toHaveLength(2)
    })
    const questions = feishu.sends.filter(send => send.text.includes('需要你审批'))
    const code = /允许 ([0-9a-f]{6})/.exec(questions[1]!.text)?.[1]
    expect(code).toBeDefined()

    await deliver(feishu, messageEvent({ messageId: 'm_answer', text: `允许 ${code}` }))
    await expect(second).resolves.toBe('allowed-once')
    await fiber.dispose()
    await expect(first).resolves.toBe('cancelled')
  })

  it('fails closed instead of asking as text when the fallback is disabled', async () => {
    const { ctx, feishu, agents } = await mount(
      { allowedOpenIds: ['ou_user'], approvalTextFallback: false, approvalTimeoutMs: 10 },
      { failSendCard: true },
    )
    await deliver(feishu, messageEvent())
    const agent = agents.created[0]!
    openTurn(agent)

    const promise = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash' })
    await expect(promise).resolves.toBe('unavailable')
    expect(feishu.sends.some(send => send.text.includes('需要你审批'))).toBe(false)
  })

  it('ignores card clicks from a non-allowlisted operator', async () => {
    const { ctx, feishu, agents } = await mount({ allowedOpenIds: ['ou_user'], approvalTimeoutMs: 10 })
    await deliver(feishu, messageEvent())
    const agent = agents.created[0]!
    openTurn(agent)

    const promise = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash' })
    await vi.waitFor(() => { expect(feishu.cards).toHaveLength(1) })
    await deliver(feishu, cardActionEvent({ operatorOpenId: 'ou_stranger' }))

    await expect(promise).resolves.toBe('unavailable')
  })

  it('ignores clicks for an unknown decision', async () => {
    const { ctx, feishu, agents } = await mount({ approvalTimeoutMs: 10 })
    await deliver(feishu, messageEvent())
    const agent = agents.created[0]!
    openTurn(agent)

    const promise = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash' })
    await vi.waitFor(() => { expect(feishu.cards).toHaveLength(1) })
    await deliver(feishu, cardActionEvent({ value: { decisionId: 'unknown', choice: 'allow-once' } }))

    await expect(promise).resolves.toBe('unavailable')
  })

  it('ignores a card click reported from a different chat', async () => {
    const { ctx, feishu, agents } = await mount({ approvalTimeoutMs: 10 })
    await deliver(feishu, messageEvent())
    const agent = agents.created[0]!
    openTurn(agent)

    const promise = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash' })
    await vi.waitFor(() => { expect(feishu.cards).toHaveLength(1) })
    const value = cardButtons(feishu)[0]!.value
    await deliver(feishu, cardActionEvent({ chatId: 'oc_other', value }))

    await expect(promise).resolves.toBe('unavailable')
  })

  it('withdraws pending questions on teardown', async () => {
    const { ctx, feishu, agents, fiber } = await mount({ approvalTimeoutMs: 60_000 })
    await deliver(feishu, messageEvent())
    const agent = agents.created[0]!
    openTurn(agent)

    const promise = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash' })
    await vi.waitFor(() => { expect(feishu.cards).toHaveLength(1) })
    await fiber.dispose()

    await expect(promise).resolves.toBe('cancelled')
  })

  it('records the audit pair on the deciding session', async () => {
    const { ctx, feishu, agents } = await mount({ allowedOpenIds: ['ou_user'] })
    await deliver(feishu, messageEvent())
    const agent = agents.created[0]!
    openTurn(agent)

    const promise = ctx.approval.request({ agent: asAgent(agent), toolName: 'bash' })
    await vi.waitFor(() => { expect(feishu.cards).toHaveLength(1) })
    await deliver(feishu, cardActionEvent({ value: { ...cardButtons(feishu)[0]!.value, choice: 'allow-once' } }))
    await expect(promise).resolves.toBe('allowed-once')

    expect(agent.session.events.map(event => event.type)).toEqual([
      'turn/start',
      'approval/asked',
      'approval/decided',
    ])
  })
})
