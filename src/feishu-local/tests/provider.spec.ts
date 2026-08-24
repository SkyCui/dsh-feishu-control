import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  reactionCreate: vi.fn(),
  wsStart: vi.fn(),
  wsClose: vi.fn(),
  register: vi.fn(),
  clientInstances: [] as unknown[],
  wsClientInstances: [] as unknown[],
}))

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: class {
    im = { v1: { message: { create: sdk.create }, messageReaction: { create: sdk.reactionCreate } } }
    constructor(args: unknown) {
      sdk.clientInstances.push(args)
    }
  },
  WSClient: class {
    start = sdk.wsStart
    close = sdk.wsClose
    constructor(args: unknown) {
      sdk.wsClientInstances.push(args)
    }
  },
  EventDispatcher: class {
    register(handles: Record<string, unknown>) {
      sdk.register(handles)
      return this
    }
  },
}))

import { LongConnectionFeishuProvider } from 'dsh-feishu-control/feishu-local'
import * as feishuLocalPlugin from 'dsh-feishu-control/feishu-local'
import FeishuRuntime from 'dsh-feishu-control/feishu'
import type { FeishuEvent } from 'dsh-feishu-control/feishu'

function provider(appId = 'cli_0000000000000000', appSecret = 'secret'): LongConnectionFeishuProvider {
  return new LongConnectionFeishuProvider({ appId, appSecret })
}

/** The handler the provider registers for `im.message.receive_v1`. */
function receiveHandler(): (data: unknown) => Promise<unknown> {
  const call = sdk.register.mock.calls[0]
  const handles = call?.[0] as Record<string, (data: unknown) => Promise<unknown>> | undefined
  const handler = handles?.['im.message.receive_v1']
  if (handler === undefined) throw new Error('im.message.receive_v1 handler was not registered')
  return handler
}

/** The handler the provider registers for `card.action.trigger`. */
function cardActionHandler(): (data: unknown) => Promise<unknown> {
  const call = sdk.register.mock.calls[0]
  const handles = call?.[0] as Record<string, (data: unknown) => Promise<unknown>> | undefined
  const handler = handles?.['card.action.trigger']
  if (handler === undefined) throw new Error('card.action.trigger handler was not registered')
  return handler
}

function payload(overrides: Record<string, unknown> = {}): unknown {
  return {
    sender: { sender_id: { open_id: 'ou_user' } },
    message: {
      message_id: 'om_1',
      chat_id: 'ou_user',
      chat_type: 'p2p',
      content: JSON.stringify({ text: 'hello' }),
      mentions: [],
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.unstubAllEnvs()
  sdk.create.mockReset()
  sdk.reactionCreate.mockReset()
  sdk.wsStart.mockReset()
  sdk.wsClose.mockReset()
  sdk.register.mockReset()
  sdk.clientInstances.length = 0
  sdk.wsClientInstances.length = 0
  sdk.create.mockResolvedValue(undefined)
  sdk.reactionCreate.mockResolvedValue(undefined)
  sdk.wsStart.mockResolvedValue(undefined)
})

describe('LongConnectionFeishuProvider.available', () => {
  it('is available when both credentials are non-empty', () => {
    expect(provider().available()).toBe(true)
  })

  it('is unavailable when either credential is empty', () => {
    expect(provider('', 'secret').available()).toBe(false)
    expect(provider('cli_0000000000000000', '').available()).toBe(false)
  })
})

describe('LongConnectionFeishuProvider.sendText', () => {
  it('sends to a p2p chat with receive_id_type chat_id', async () => {
    await provider().sendText({ chatId: 'ou_user', text: 'hi' })
    expect(sdk.create).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: 'ou_user', content: JSON.stringify({ text: 'hi' }), msg_type: 'text' },
    })
  })

  it('reuses one REST client across sends and reactions', async () => {
    const p = provider()
    await p.sendText({ chatId: 'ou_user', text: 'hi' })
    await p.sendCard({ chatId: 'ou_user', card: { config: {}, header: { title: { tag: 'plain_text', content: 't' }, template: 'blue' } } })
    await p.addReaction({ messageId: 'om_1', emojiType: 'THINKING' })
    expect(sdk.clientInstances).toHaveLength(1)
  })

  it('sends to a group chat with receive_id_type chat_id', async () => {
    await provider().sendText({ chatId: 'oc_group', text: 'hi' })
    expect(sdk.create).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: 'oc_group', content: JSON.stringify({ text: 'hi' }), msg_type: 'text' },
    })
  })

  it('throws FEISHU_ABORTED when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(provider().sendText(
      { chatId: 'ou_user', text: 'hi' },
      controller.signal,
    )).rejects.toThrow(expect.objectContaining({ code: 'FEISHU_ABORTED' }))
    expect(sdk.create).not.toHaveBeenCalled()
  })
})

describe('LongConnectionFeishuProvider.sendCard', () => {
  it('sends the card serialized as an interactive message', async () => {
    const card = { elements: [{ tag: 'div', text: { tag: 'lark_md', content: 'approve?' } }] }
    await provider().sendCard({ chatId: 'ou_user', card })
    expect(sdk.create).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'ou_user',
        content: JSON.stringify(card),
        msg_type: 'interactive',
      },
    })
  })

  it('throws FEISHU_ABORTED when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(provider().sendCard(
      { chatId: 'ou_user', card: {} },
      controller.signal,
    )).rejects.toThrow(expect.objectContaining({ code: 'FEISHU_ABORTED' }))
    expect(sdk.create).not.toHaveBeenCalled()
  })
})

describe('LongConnectionFeishuProvider.addReaction', () => {
  it('adds an emoji reaction to the message', async () => {
    await provider().addReaction({ messageId: 'om_1', emojiType: 'THINKING' })
    expect(sdk.reactionCreate).toHaveBeenCalledWith({
      path: { message_id: 'om_1' },
      data: { reaction_type: { emoji_type: 'THINKING' } },
    })
  })

  it('throws FEISHU_ABORTED when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(provider().addReaction(
      { messageId: 'om_1', emojiType: 'THINKING' },
      controller.signal,
    )).rejects.toThrow(expect.objectContaining({ code: 'FEISHU_ABORTED' }))
    expect(sdk.reactionCreate).not.toHaveBeenCalled()
  })
})

describe('LongConnectionFeishuProvider.start', () => {
  it('registers the receive handler, emits text events, and closes via the disposer', async () => {
    const emitted: FeishuEvent[] = []
    const dispose = provider().start((event) => { emitted.push(event) })

    expect(sdk.register).toHaveBeenCalledTimes(1)
    // The liveness watchdog must be armed so a half-open Feishu connection is
    // detected and reconnected instead of leaving the bridge deaf.
    expect(sdk.wsClientInstances[0]).toMatchObject({ wsConfig: { pingTimeout: 180 } })
    await receiveHandler()(payload())

    expect(emitted).toEqual([{
      kind: 'message',
      messageId: 'om_1',
      chatId: 'ou_user',
      chatType: 'p2p',
      senderOpenId: 'ou_user',
      text: 'hello',
      mentioned: false,
    }])

    dispose()
    expect(sdk.wsClose).toHaveBeenCalledTimes(1)
  })

  it('does not open a connection without credentials', () => {
    const dispose = provider('', '').start(() => {})
    expect(sdk.wsStart).not.toHaveBeenCalled()
    expect(sdk.register).not.toHaveBeenCalled()
    dispose()
  })

  it('marks a group message with any mention as mentioned', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await receiveHandler()(payload({
      message: {
        message_id: 'om_2',
        chat_id: 'oc_group',
        chat_type: 'group',
        content: JSON.stringify({ text: 'hi' }),
        mentions: [{ name: 'bot' }],
      },
    }))
    expect(emitted[0]).toMatchObject({ chatType: 'group', mentioned: true })
  })

  it('drops a non-text message', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await receiveHandler()(payload({
      message: {
        message_id: 'om_3',
        chat_id: 'ou_user',
        chat_type: 'p2p',
        content: JSON.stringify({ image_key: 'img' }),
        mentions: [],
      },
    }))
    expect(emitted).toHaveLength(0)
  })

  it('drops a message whose content is not valid JSON', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await receiveHandler()(payload({
      message: {
        message_id: 'om_4',
        chat_id: 'ou_user',
        chat_type: 'p2p',
        content: 'not-json',
        mentions: [],
      },
    }))
    expect(emitted).toHaveLength(0)
  })

  it('drops a message missing required fields', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await receiveHandler()({ sender: { sender_id: { open_id: 'ou_user' } }, message: { chat_id: 'ou_user', chat_type: 'p2p' } })
    expect(emitted).toHaveLength(0)
  })

  it('drops a message with an unknown chat type', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await receiveHandler()(payload({
      message: {
        message_id: 'om_5',
        chat_id: 'oc_x',
        chat_type: 'unknown',
        content: JSON.stringify({ text: 'hi' }),
        mentions: [],
      },
    }))
    expect(emitted).toHaveLength(0)
  })

  it('drops a message whose content parses to a non-object', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await receiveHandler()(payload({
      message: { message_id: 'om_6', chat_id: 'ou_user', chat_type: 'p2p', content: '"a string"', mentions: [] },
    }))
    expect(emitted).toHaveLength(0)
  })

  it('drops a message whose content parses to null', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await receiveHandler()(payload({
      message: { message_id: 'om_7', chat_id: 'ou_user', chat_type: 'p2p', content: 'null', mentions: [] },
    }))
    expect(emitted).toHaveLength(0)
  })

  it('drops a message whose text is not a string', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await receiveHandler()(payload({
      message: { message_id: 'om_8', chat_id: 'ou_user', chat_type: 'p2p', content: JSON.stringify({ text: 123 }), mentions: [] },
    }))
    expect(emitted).toHaveLength(0)
  })

  it('drops a payload without a message', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await receiveHandler()({ sender: { sender_id: { open_id: 'ou_user' } } })
    expect(emitted).toHaveLength(0)
  })

  it('marks a group message without mentions as not mentioned', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await receiveHandler()(payload({
      message: {
        message_id: 'om_9',
        chat_id: 'oc_group',
        chat_type: 'group',
        content: JSON.stringify({ text: 'hi' }),
      },
    }))
    expect(emitted[0]).toMatchObject({ chatType: 'group', mentioned: false })
  })

  it('registers the card-action handler and emits button clicks', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await cardActionHandler()({
      operator: { open_id: 'ou_boss' },
      action: { value: { requestId: 'req-1', choice: 'allow-once' }, tag: 'button' },
      context: { open_message_id: 'om_card', open_chat_id: 'oc_group' },
    })
    expect(emitted).toEqual([{
      kind: 'card-action',
      chatId: 'oc_group',
      messageId: 'om_card',
      operatorOpenId: 'ou_boss',
      tag: 'button',
      value: { requestId: 'req-1', choice: 'allow-once' },
    }])
  })

  it('falls back to top-level ids when context is absent', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await cardActionHandler()({
      operator: { open_id: 'ou_boss' },
      action: { value: { requestId: 'req-1' } },
      open_message_id: 'om_card',
      open_chat_id: 'oc_group',
    })
    expect(emitted[0]).toMatchObject({
      kind: 'card-action',
      chatId: 'oc_group',
      messageId: 'om_card',
      operatorOpenId: 'ou_boss',
    })
  })

  it('drops non-string button values and defaults a missing tag', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await cardActionHandler()({
      operator: { open_id: 'ou_boss' },
      action: { value: { requestId: 'req-1', count: 3 } },
    })
    expect(emitted).toEqual([{
      kind: 'card-action',
      operatorOpenId: 'ou_boss',
      tag: 'button',
      value: { requestId: 'req-1' },
    }])
  })

  it('drops a card action without an action payload', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await cardActionHandler()({ operator: { open_id: 'ou_boss' } })
    expect(emitted).toHaveLength(0)
  })

  it('drops a card action whose value is not an object', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await cardActionHandler()({
      operator: { open_id: 'ou_boss' },
      action: { tag: 'button' },
    })
    expect(emitted).toEqual([{
      kind: 'card-action',
      operatorOpenId: 'ou_boss',
      tag: 'button',
      value: {},
    }])
  })

  it('drops a card click without an operator', async () => {
    const emitted: FeishuEvent[] = []
    provider().start((event) => { emitted.push(event) })
    await cardActionHandler()({ action: { value: { requestId: 'req-1' } } })
    expect(emitted).toHaveLength(0)
  })
})

describe('feishu-local apply', () => {
  it('registers an available provider from literal config', async () => {
    const ctx = new Context()
    await ctx.plugin(FeishuRuntime)
    await ctx.plugin(feishuLocalPlugin, { appId: 'cli_0000000000000000', appSecret: 'secret' })
    await expect(ctx.feishu.sendText({ chatId: 'ou', text: 'hi' })).resolves.toBeUndefined()
  })

  it('resolves credentials from the default env vars', async () => {
    vi.stubEnv('DSH_FEISHU_APP_ID', 'cli_env')
    vi.stubEnv('DSH_FEISHU_APP_SECRET', 'env_secret')
    const ctx = new Context()
    await ctx.plugin(FeishuRuntime)
    await ctx.plugin(feishuLocalPlugin, {})
    await expect(ctx.feishu.sendText({ chatId: 'ou', text: 'hi' })).resolves.toBeUndefined()
  })

  it('resolves credentials from custom env var names', async () => {
    vi.stubEnv('MY_ID', 'cli_custom')
    vi.stubEnv('MY_SECRET', 'custom_secret')
    const ctx = new Context()
    await ctx.plugin(FeishuRuntime)
    await ctx.plugin(feishuLocalPlugin, { appIdEnv: 'MY_ID', appSecretEnv: 'MY_SECRET' })
    await expect(ctx.feishu.sendText({ chatId: 'ou', text: 'hi' })).resolves.toBeUndefined()
  })

  it('fails loud when credentials are absent', async () => {
    vi.stubEnv('DSH_FEISHU_APP_ID', undefined)
    vi.stubEnv('DSH_FEISHU_APP_SECRET', undefined)
    const ctx = new Context()
    await ctx.plugin(FeishuRuntime)
    await expect(ctx.plugin(feishuLocalPlugin, {})).rejects.toThrow(
      expect.objectContaining({ code: 'FEISHU_CREDENTIALS_MISSING' }),
    )
  })
})
