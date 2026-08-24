import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import FeishuRuntime, {
  FeishuError,
  type FeishuEvent,
  type FeishuMessageEvent,
  type FeishuProvider,
  type FeishuSendCardRequest,
  type FeishuSendTextRequest,
} from 'dsh-feishu-control/feishu'

/** A scripted provider that records outbound sends and exposes the emit sink. */
function makeProvider(available: boolean): FeishuProvider & {
  sends: FeishuSendTextRequest[]
  cards: FeishuSendCardRequest[]
  reactions: { messageId: string; emojiType: string }[]
  emits: ((event: FeishuEvent) => void)[]
} {
  const sends: FeishuSendTextRequest[] = []
  const cards: FeishuSendCardRequest[] = []
  const reactions: { messageId: string; emojiType: string }[] = []
  const emits: ((event: FeishuEvent) => void)[] = []
  return {
    id: 'mock',
    available: () => available,
    sendText: (request) => {
      sends.push(request)
      return Promise.resolve()
    },
    sendCard: (request) => {
      cards.push(request)
      return Promise.resolve()
    },
    addReaction: (request) => {
      reactions.push(request)
      return Promise.resolve()
    },
    start: (emit) => {
      emits.push(emit)
      return () => { emits.length = 0 }
    },
    sends,
    cards,
    reactions,
    emits,
  }
}

function messageEvent(overrides: Partial<FeishuMessageEvent> = {}): FeishuMessageEvent {
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

/** Mount a FeishuRuntime on a fresh root context. */
async function mountFeishu(): Promise<{ ctx: Context; feishu: FeishuRuntime }> {
  const ctx = new Context()
  await ctx.plugin(FeishuRuntime)
  return { ctx, feishu: ctx.feishu }
}

describe('FeishuRuntime registration', () => {
  it('registers a provider and unregisters it via the returned disposer', async () => {
    const { feishu } = await mountFeishu()
    const provider = makeProvider(true)

    const dispose = feishu.registerProvider(provider)
    await expect(feishu.sendText({ chatId: 'ou_user', text: 'hello' })).resolves.toBeUndefined()
    expect(provider.sends).toEqual([{ chatId: 'ou_user', text: 'hello' }])

    dispose()
    await expect(feishu.sendText({ chatId: 'ou_user', text: 'hello' })).rejects.toThrow(
      expect.objectContaining({ code: 'FEISHU_PROVIDER_MISSING' }),
    )
  })

  it('throws FEISHU_DUPLICATE_PROVIDER on a second registration', async () => {
    const { feishu } = await mountFeishu()
    feishu.registerProvider(makeProvider(true))
    expect(() => feishu.registerProvider(makeProvider(true))).toThrow(
      expect.objectContaining({ code: 'FEISHU_DUPLICATE_PROVIDER' }),
    )
  })

  it('disposes provider registrations when the contributing fiber is disposed (HMR safety)', async () => {
    const { ctx, feishu } = await mountFeishu()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.feishu.registerProvider(makeProvider(true))
    }, { inject: ['feishu'] }))
    await expect(feishu.sendText({ chatId: 'ou_user', text: 'hi' })).resolves.toBeUndefined()
    await fiber.dispose()
    await expect(feishu.sendText({ chatId: 'ou_user', text: 'hi' })).rejects.toThrow(
      expect.objectContaining({ code: 'FEISHU_PROVIDER_MISSING' }),
    )
  })
})

describe('FeishuRuntime send resolution', () => {
  it('throws FEISHU_PROVIDER_MISSING when nothing is registered', async () => {
    const { feishu } = await mountFeishu()
    await expect(feishu.sendText({ chatId: 'ou_user', text: 'hi' })).rejects.toThrow(
      expect.objectContaining({ code: 'FEISHU_PROVIDER_MISSING' }),
    )
  })

  it('throws FEISHU_PROVIDER_UNAVAILABLE when the provider is unavailable', async () => {
    const { feishu } = await mountFeishu()
    feishu.registerProvider(makeProvider(false))
    await expect(feishu.sendText({ chatId: 'ou_user', text: 'hi' })).rejects.toThrow(
      expect.objectContaining({ code: 'FEISHU_PROVIDER_UNAVAILABLE' }),
    )
  })

  it('propagates the abort signal to the provider', async () => {
    const { feishu } = await mountFeishu()
    const seen: (AbortSignal | undefined)[] = []
    feishu.registerProvider({
      id: 'mock',
      available: () => true,
      sendText: (_request, signal) => {
        seen.push(signal)
        return Promise.resolve()
      },
      sendCard: () => Promise.resolve(),
      addReaction: () => Promise.resolve(),
      start: () => () => {},
    })
    const controller = new AbortController()
    await feishu.sendText({ chatId: 'ou_user', text: 'hi' }, controller.signal)
    expect(seen[0]).toBe(controller.signal)
  })
})

describe('FeishuRuntime card send resolution', () => {
  it('delegates sendCard to the registered provider', async () => {
    const { feishu } = await mountFeishu()
    const provider = makeProvider(true)
    feishu.registerProvider(provider)
    const card = { elements: [{ tag: 'div' }] }
    await expect(feishu.sendCard({ chatId: 'ou_user', card })).resolves.toBeUndefined()
    expect(provider.cards).toEqual([{ chatId: 'ou_user', card }])
  })

  it('throws FEISHU_PROVIDER_MISSING when nothing is registered', async () => {
    const { feishu } = await mountFeishu()
    await expect(feishu.sendCard({ chatId: 'ou_user', card: {} })).rejects.toThrow(
      expect.objectContaining({ code: 'FEISHU_PROVIDER_MISSING' }),
    )
  })

  it('throws FEISHU_PROVIDER_UNAVAILABLE when the provider is unavailable', async () => {
    const { feishu } = await mountFeishu()
    feishu.registerProvider(makeProvider(false))
    await expect(feishu.sendCard({ chatId: 'ou_user', card: {} })).rejects.toThrow(
      expect.objectContaining({ code: 'FEISHU_PROVIDER_UNAVAILABLE' }),
    )
  })
})

describe('FeishuRuntime reaction resolution', () => {
  it('delegates addReaction to the registered provider', async () => {
    const { feishu } = await mountFeishu()
    const provider = makeProvider(true)
    feishu.registerProvider(provider)
    await expect(feishu.addReaction({ messageId: 'm1', emojiType: 'THINKING' })).resolves.toBeUndefined()
    expect(provider.reactions).toEqual([{ messageId: 'm1', emojiType: 'THINKING' }])
  })

  it('throws FEISHU_PROVIDER_MISSING when nothing is registered', async () => {
    const { feishu } = await mountFeishu()
    await expect(feishu.addReaction({ messageId: 'm1', emojiType: 'THINKING' })).rejects.toThrow(
      expect.objectContaining({ code: 'FEISHU_PROVIDER_MISSING' }),
    )
  })

  it('throws FEISHU_PROVIDER_UNAVAILABLE when the provider is unavailable', async () => {
    const { feishu } = await mountFeishu()
    feishu.registerProvider(makeProvider(false))
    await expect(feishu.addReaction({ messageId: 'm1', emojiType: 'THINKING' })).rejects.toThrow(
      expect.objectContaining({ code: 'FEISHU_PROVIDER_UNAVAILABLE' }),
    )
  })
})

describe('FeishuRuntime event fan-out', () => {
  it('starts the provider lazily on first subscription and delivers events', async () => {
    const { feishu } = await mountFeishu()
    const provider = makeProvider(true)
    feishu.registerProvider(provider)
    expect(provider.emits).toHaveLength(0)

    const received: FeishuEvent[] = []
    feishu.subscribe((event) => { received.push(event) })
    expect(provider.emits).toHaveLength(1)

    provider.emits[0]!(messageEvent({ text: 'first' }))
    expect(received).toEqual([messageEvent({ text: 'first' })])
  })

  it('starts the provider when a subscription predates registration', async () => {
    const { feishu } = await mountFeishu()
    const provider = makeProvider(true)

    const received: FeishuEvent[] = []
    feishu.subscribe((event) => { received.push(event) })
    expect(provider.emits).toHaveLength(0)

    feishu.registerProvider(provider)
    expect(provider.emits).toHaveLength(1)
  })

  it('removes a handler via its disposer', async () => {
    const { feishu } = await mountFeishu()
    const provider = makeProvider(true)
    feishu.registerProvider(provider)

    const received: FeishuEvent[] = []
    const dispose = feishu.subscribe((event) => { received.push(event) })
    provider.emits[0]!(messageEvent())
    expect(received).toHaveLength(1)

    dispose()
    provider.emits[0]!(messageEvent())
    expect(received).toHaveLength(1)
  })

  it('supports an async handler', async () => {
    const { feishu } = await mountFeishu()
    const provider = makeProvider(true)
    feishu.registerProvider(provider)

    const received: FeishuEvent[] = []
    feishu.subscribe(async (event) => { received.push(event) })
    provider.emits[0]!(messageEvent())
    await Promise.resolve()
    await Promise.resolve()
    expect(received).toEqual([messageEvent()])
  })

  it('logs and swallows a rejecting handler', async () => {
    const { feishu } = await mountFeishu()
    const provider = makeProvider(true)
    feishu.registerProvider(provider)

    feishu.subscribe(() => Promise.reject(new Error('boom')))
    expect(() => { provider.emits[0]!(messageEvent()) }).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
  })

  it('delivers card-action events to subscribers', async () => {
    const { feishu } = await mountFeishu()
    const provider = makeProvider(true)
    feishu.registerProvider(provider)

    const received: FeishuEvent[] = []
    feishu.subscribe((event) => { received.push(event) })
    provider.emits[0]!({
      kind: 'card-action',
      chatId: 'oc_group',
      messageId: 'om_card',
      operatorOpenId: 'ou_boss',
      tag: 'button',
      value: { requestId: 'req-1', choice: 'allow-once' },
    })
    expect(received).toEqual([{
      kind: 'card-action',
      chatId: 'oc_group',
      messageId: 'om_card',
      operatorOpenId: 'ou_boss',
      tag: 'button',
      value: { requestId: 'req-1', choice: 'allow-once' },
    }])
  })
})

describe('FeishuError', () => {
  it('is a HarnessError carrying its code', () => {
    const error = new FeishuError('boom', 'FEISHU_PROVIDER_MISSING')
    expect(error.code).toBe('FEISHU_PROVIDER_MISSING')
    expect(error.name).toBe('FeishuError')
  })
})
