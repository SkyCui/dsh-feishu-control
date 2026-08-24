# Marketplace submission draft

Canonical repository: `https://github.com/SkyCui/dsh-feishu-control`.

## Identity

- Name: `dsh-feishu-control`
- Type: DeepSeek Harness bundle (`dsh.bundle`)
- Category: Integrations / Runtime
- npm package: `dsh-feishu-control`
- Repository: `https://github.com/SkyCui/dsh-feishu-control`
- License: MIT
- Profile name used in examples: `feishu-control`

## English summary

Secure Feishu/Lark remote control for a DeepSeek Harness coding agent running
on the user's own machine. Uses an outbound long connection, a fail-closed
sender allowlist, duplicate-message suppression, chat-bound card approvals,
coded text fallback, and group chats disabled by default.

## 中文简介

通过飞书安全地远程控制用户自己机器上运行的 DeepSeek Harness 编码 Agent。
采用主动出站长连接、失败关闭的发送者白名单、重复消息抑制、绑定会话的审批，
并默认关闭群聊。

## Install

```sh
dsh plugin add --save-exact dsh-feishu-control@latest
pnpm dlx dsh-feishu-control@latest setup
```

Then fully quit and reopen DeepSeek Harness Desktop. The setup wizard detects
the Profile selected by the marketplace and does not install the package again.

## Compatibility

- Node.js: `^22.19.0 || >=24.0.0`
- DeepSeek Harness APIs: `>=0.1.0-rc.6 <0.1.1-0`
- Clean-profile installation and bundle loading verified with DSH rc.6 and
  rc.8 before the initial release.

## Security signals

- Empty or missing sender allowlist denies all users.
- Missing Feishu credentials abort startup.
- Group chats are disabled by default.
- Approval clicks require an allowed operator, a button action, and the
  originating chat context.
- No inbound callback server, public port, or telemetry is added by the plugin.
- Security policy: `SECURITY.md` in the canonical repository.
- CI runs tests, build/export validation, package type validation, and a full
  dependency audit.

## Known limitations

- Session and duplicate-message state is in memory and resets on restart.
- Group mention detection currently confirms that a mention exists, not that
  the mention specifically targets the bot; group chats should remain disabled
  in higher-security deployments.
- Text messages and approval cards are supported; media and attachments are
  not supported.
