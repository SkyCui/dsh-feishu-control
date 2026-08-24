# dsh-feishu-control

[English](README.md) | 中文

通过飞书安全地远程控制运行在自己机器上的 DeepSeek Harness 编码 Agent。机器人使用飞书长连接主动出站连接，不需要公网 IP、端口转发或回调域名。

本包是可安装的 DSH profile bundle，包含飞书能力接口、长连接 provider、Agent consumer 和交互式审批桥。

## 安全默认值

- 发送者白名单为空时拒绝所有人。
- 群聊默认关闭；启用后默认要求消息包含提及。
- 飞书重投的近期消息不会重复驱动 Agent。
- 较长的 Agent 回复会按顺序拆成不破坏 Unicode 字符的多条消息。
- 卡片审批只接受白名单操作者及原会话中的点击。
- 文本审批使用应答码区分并发请求。
- 未回答、超时或撤回的审批失败关闭。
- 缺少飞书凭证时启动直接失败，不会静默运行。

这个插件能让远程消息触发本机编码 Agent。Agent 可能执行命令、读写文件并消耗 API 额度。只应把白名单授予可信用户，并让 Agent 在权限受限的账户和工作目录中运行。

## 前置条件

- Node.js `^22.19.0` 或 `>=24.0.0`。
- **已经安装 DeepSeek Harness 的 `dsh` CLI，完成 DeepSeek 模型/API 配置，并至少成功启动过一次。**
- 一个飞书企业自建应用。
- DeepSeek API key。

本插件不是 DeepSeek Harness 本体，也不会替你安装或配置 Harness。请先在终端确认 `dsh --version` 有结果，并确认 `dsh` 本身可以正常启动，再继续安装插件。

## 小白推荐：插件广场安装 + 终端向导

不需要下载源码，也不需要编辑 YAML。先在 DeepSeek Harness Desktop 的插件广场安装，或在其内置终端运行标准安装命令：

```sh
dsh plugin add --save-exact dsh-feishu-control
```

然后在普通终端运行配置向导：

```sh
pnpm dlx dsh-feishu-control setup
```

向导会逐步完成：

1. 检查 `dsh` 和 `pnpm` 是否存在，并再次确认 Harness 已经成功运行过。
2. 提醒你完成飞书机器人、长连接、事件、权限和应用发布设置。
3. 安全输入 App ID 和 App Secret；Secret 输入时不会显示。
4. 配置允许控制 Agent 的飞书用户 `open_id`。
5. 选择 Agent 只能操作的项目工作目录。
6. 自动寻找插件实际安装的 Profile，不会在插件广场安装后重复安装。
7. 写入本机配置并检查对应 Profile；最后提示重启 Desktop。

如果尚未通过插件广场安装，向导会明确说明并切换到独立终端模式，使用精确版本创建 `feishu-control` Profile。

向导将飞书凭证保存到 `$DSH_HOME/.env`（默认是 `~/.dsh/.env`），并把文件权限设为仅当前系统用户可读写。这个文件不会位于项目仓库中，但同一系统账户下运行的程序和 Agent 工具仍可能读取它；建议使用专用低权限账户。

Harness `0.1.0-rc.8` 及以上版本禁止在 `.env` 中使用 `DSH_*` 名称，因此 `0.1.1` 改用 `FEISHU_CONTROL_*`。再次运行 `setup` 会自动迁移旧的 `DSH_FEISHU_*` 配置，并且不会打印已保存的密钥；旧名称仅在启动终端显式 `export` 时继续兼容。

如果不知道自己的 `open_id`，向导会让你先使用 `ou_placeholder`。启动后私聊机器人，拒绝消息会显示你的真实 `open_id`；复制后再次运行同一个 `setup` 命令即可更新。

安装后常用命令：

```sh
# 检查是否安装和配置完整（不会显示密钥）
pnpm dlx dsh-feishu-control doctor

# 仅限独立终端模式：在向导保存的工作目录中启动
pnpm dlx dsh-feishu-control start
```

Desktop 用户不要另外运行 `start`；请完全退出并重新打开 DeepSeek Harness Desktop。

`pnpm dlx` 会临时取得 npm 上发布的安装向导并执行 `feishu-control` 命令，所以用户无需克隆仓库。只有项目维护者从源码开发时才需要使用 `pnpm run feishu-control`。

## 手动安装

以下步骤适合希望自己管理环境变量和 DSH profile 的开发者；第一次使用建议采用上面的终端向导。

### 1. 创建飞书应用

1. 进入[飞书开放平台](https://open.feishu.cn/)并创建企业自建应用。
2. 添加“机器人”能力。
3. 在“事件与回调”中选择“使用长连接接收事件”。
4. 订阅 `im.message.receive_v1` 和 `card.action.trigger`。
5. 开通 `im:message`、`im:message:send_as_bot` 和 `im:message.p2p_msg` 权限。
6. 仅在需要群聊功能时开通 `im:message.group_at_msg`。
7. 创建版本并发布应用。

### 2. 配置凭证和白名单

在启动 `dsh` 的环境中设置：

```sh
export DEEPSEEK_API_KEY=replace-with-your-deepseek-key
export FEISHU_CONTROL_APP_ID=replace-with-your-app-id
export FEISHU_CONTROL_APP_SECRET=replace-with-your-app-secret
export FEISHU_CONTROL_ALLOWED_OPEN_IDS=replace-with-your-open-id
export FEISHU_CONTROL_WORKSPACE=/absolute/path/to/a/project
export FEISHU_CONTROL_PERMISSION_MODE=workspace-write
```

多个 `open_id` 用英文逗号分隔。白名单为空或缺失时，机器人会拒绝所有消息。

如果不知道自己的 `open_id`，可先配置一个不存在的值，例如 `ou_placeholder`，启动后私聊机器人。拒绝消息会显示发送者自己的 `open_id`，将其写回环境变量并重新启动。

不要提交 `.env` 或真实凭证。本仓库的 `.env.example` 只包含占位值。

### 3. 安装并启动

#### DeepSeek Harness Desktop 插件广场

```sh
dsh plugin add --save-exact dsh-feishu-control
pnpm dlx dsh-feishu-control setup
```

安装及配置完成后，完全退出并重新打开 DeepSeek Harness Desktop。插件广场命令使用当前 Desktop Profile，因此不需要手工指定 `--profile`。

#### 独立终端 Profile

```sh
dsh plugin --profile feishu-control add --save-exact dsh-feishu-control
dsh --profile feishu-control --dump-config
cd /path/to/the/workspace-the-agent-may-control
dsh --profile feishu-control
```

这里的 `feishu-control` 是 DSH profile 名称。npm 包同时提供同名的安装向导命令；向导最终仍然通过 `dsh --profile feishu-control` 启动 DeepSeek Harness。

插件优先使用 `FEISHU_CONTROL_WORKSPACE` 作为 Agent 工作目录和 Harness 沙箱根目录；未设置时才使用启动 `dsh` 时所在的目录。请选择专用项目目录，保持 `FEISHU_CONTROL_PERMISSION_MODE=workspace-write`，不要使用用户主目录或文件系统根目录。

#### 从 GitHub 安装

```sh
dsh plugin --profile feishu-control add --save-exact github:SkyCui/dsh-feishu-control#<commit-sha>
```

Git 安装会执行本包的 `prepare` 构建脚本。pnpm 10 及以上默认阻止依赖安装脚本；第一次安装若被拒绝，请按照 `dsh`/pnpm 输出，把精确的包键加入该 profile 的 `pnpm-workspace.yaml` 中的 `allowBuilds`，然后使用固定 commit SHA 重试。只应授权可信源码。

npm 和插件市场安装使用预构建产物，不需要授权本包的构建脚本。

## 群聊

群聊默认关闭。若确实需要群聊，在插件实际所在 Profile 的 `cordis.patch.yml` 中覆盖完整的 `feishu-agent` 配置，例如 `$DSH_HOME/profiles/feishu-control/cordis.patch.yml`：

```yaml
- id: feishu-agent
  config:
    cwd: !!js process.env.FEISHU_CONTROL_WORKSPACE ?? process.cwd()
    allowedOpenIds: !!js "process.env.FEISHU_CONTROL_ALLOWED_OPEN_IDS?.split(',').map(value => value.trim()).filter(Boolean) ?? []"
    allowGroupChats: true
    requireMentionInGroups: true
```

当前提及检测只确认消息存在提及，不能确认被提及的一定是机器人。对安全要求较高的部署应保持群聊关闭。

## 审批行为

需要用户批准的操作会发送交互式卡片。卡片发送失败时，机器人改发带六位应答码的文本：

```text
允许 a1b2c3
拒绝 a1b2c3
```

同一聊天只有一个文本审批时，也可以直接回复“允许”或“拒绝”。存在多个审批时，必须携带对应应答码。

## 开发与验证

本仓库独立解析 npm 上发布的 DSH API 包，不需要相邻的 `deepseek-harness` checkout。

```sh
pnpm install
pnpm verify
pnpm pack
```

`pnpm verify` 依次执行类型检查、单元测试、构建和发布入口验证。`prepack` 会在打包或发布前自动执行完整验证。

`pnpm check:package-types` 还会使用 Are The Types Wrong 检查打包后的 ESM 类型声明。

## 已知限制

- 会话和消息去重记录仅保存在内存中，进程重启后会清空。
- 消息去重最多保留最近 2,000 个消息 ID。
- 群聊提及检测无法确认具体被提及的用户。
- 只支持文本消息和审批卡片，不支持媒体与附件。

## 安全报告

请参阅 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)
