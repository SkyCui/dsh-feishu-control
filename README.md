# dsh-feishu-control

English | [中文](README.zh.md)

Securely control a DeepSeek Harness coding agent on your own machine from Feishu. The bot opens an outbound Feishu long connection, so it needs no public IP, port forwarding, or callback domain.

This package is an installable DSH profile bundle containing the Feishu capability seam, long-connection provider, agent consumer, and interactive approval bridge.

## Secure defaults

- An empty sender allowlist denies everyone.
- Group chats are disabled by default; when enabled, mentions are required by default.
- Recent Feishu message redeliveries do not drive the agent twice.
- Long agent replies are delivered as ordered, Unicode-safe message chunks.
- Card approvals accept only allowlisted operators clicking from the originating chat.
- Text approvals use answer codes to distinguish concurrent requests.
- Unanswered, timed-out, and withdrawn approvals fail closed.
- Missing Feishu credentials stop startup instead of leaving a silent process.

This plugin lets remote messages drive a coding agent that may execute commands, read or change files, and spend API quota. Allowlist only trusted users, and run the agent under a restricted OS account and working directory.

## Prerequisites

- Node.js `^22.19.0` or `>=24.0.0`.
- **The DeepSeek Harness `dsh` CLI must already be installed, configured for a DeepSeek model/API, and successfully started at least once.**
- A Feishu enterprise self-built application.
- A DeepSeek API key.

This plugin is not DeepSeek Harness itself and does not install or configure Harness for you. Confirm that `dsh --version` works and that `dsh` can start normally before continuing.

## Recommended: marketplace install + terminal setup wizard

No repository clone or YAML editing is required. Install through the DeepSeek Harness Desktop marketplace, or run its standard command in the built-in terminal:

```sh
dsh plugin add --save-exact dsh-feishu-control@latest
```

Then run the configuration wizard in a normal terminal:

```sh
pnpm dlx dsh-feishu-control@latest setup
```

The wizard checks `dsh` and `pnpm`, confirms that Harness has run successfully, walks through the required Feishu application settings, collects credentials without displaying the secret, and configures the sender allowlist and restricted workspace. It finds the Profile where the marketplace installed the plugin, skips duplicate installation, validates that Profile, and tells Desktop users to restart. If the plugin is not installed, it clearly switches to standalone-terminal mode and creates an exact-version `feishu-control` Profile.

Feishu credentials are stored in `$DSH_HOME/.env` (normally `~/.dsh/.env`) with owner-only file permissions. The file is outside the project repository, but programs and Agent tools running as the same operating-system account may still read it; use a dedicated, restricted account where practical.

Harness `0.1.0-rc.8` and newer reject `DSH_*` names in dotenv files. Version `0.1.1` therefore uses `FEISHU_CONTROL_*` names; rerunning `setup` automatically migrates the legacy `DSH_FEISHU_*` entries without printing the stored secret. Legacy `DSH_FEISHU_*` variables remain accepted only when explicitly exported by the launching shell.

If you do not know your `open_id`, use this first-authorization flow:

1. Enter `ou_placeholder` during the first setup, finish the remaining prompts, and start the service.
2. Privately message the Feishu bot and copy the real `open_id` shown in its reply.
3. Press `Ctrl+C` to stop terminal mode, or fully quit Harness Desktop.
4. Run `pnpm dlx dsh-feishu-control@latest setup` again.
5. Replace the displayed `[ou_placeholder]` default with the real `open_id` and finish setup.
6. Restart the terminal service or reopen Desktop. Allowlisted messages can then reach the Agent.

After installation:

```sh
pnpm dlx dsh-feishu-control@latest doctor
# Standalone-terminal mode only:
pnpm dlx dsh-feishu-control@latest start
```

Desktop users should not run `start`; fully quit and reopen DeepSeek Harness Desktop instead.

`pnpm dlx` temporarily obtains the published setup utility and runs its `feishu-control` executable, so end users do not need to clone this repository. `pnpm run feishu-control` is only for maintainers working from source.

## Manual installation

The following workflow is for developers who prefer to manage environment variables and the DSH profile themselves. First-time users should use the terminal wizard above.

### 1. Create the Feishu application

1. Open the [Feishu Open Platform](https://open.feishu.cn/) and create an enterprise self-built application.
2. Add the Bot capability.
3. Select long-connection event delivery under Events & Callbacks.
4. Subscribe to `im.message.receive_v1` and `card.action.trigger`.
5. Grant `im:message`, `im:message:send_as_bot`, and `im:message.p2p_msg`.
6. Grant `im:message.group_at_msg` only if group-chat operation is required.
7. Create and publish an application version.

### 2. Configure credentials and the allowlist

Set these variables in the environment that launches `dsh`:

```sh
export DEEPSEEK_API_KEY=replace-with-your-deepseek-key
export FEISHU_CONTROL_APP_ID=replace-with-your-app-id
export FEISHU_CONTROL_APP_SECRET=replace-with-your-app-secret
export FEISHU_CONTROL_ALLOWED_OPEN_IDS=replace-with-your-open-id
export FEISHU_CONTROL_WORKSPACE=/absolute/path/to/a/project
export FEISHU_CONTROL_PERMISSION_MODE=workspace-write
```

Separate multiple `open_id` values with commas. A missing or empty allowlist denies every message.

To discover your `open_id`, temporarily configure a nonexistent value such as `ou_placeholder`, start the profile, and privately message the bot. Copy the sender `open_id` from the reply, stop the service, rerun `setup` to replace the placeholder, and restart. Continue separating multiple `open_id` values with commas.

Never commit `.env` or real credentials. This repository's `.env.example` contains placeholders only.

### 3. Install and start

#### DeepSeek Harness Desktop marketplace

```sh
dsh plugin add --save-exact dsh-feishu-control@latest
pnpm dlx dsh-feishu-control@latest setup
```

Fully quit and reopen DeepSeek Harness Desktop after installation and configuration. The marketplace command targets the active Desktop Profile, so it does not need an explicit `--profile`.

#### Standalone terminal Profile

```sh
dsh plugin --profile feishu-control add --save-exact dsh-feishu-control@latest
dsh --profile feishu-control --dump-config
cd /path/to/the/workspace-the-agent-may-control
dsh --profile feishu-control
```

`feishu-control` is the DSH profile name. The npm package also exposes a setup executable with the same name; the wizard ultimately starts DeepSeek Harness through `dsh --profile feishu-control`.

The plugin prefers `FEISHU_CONTROL_WORKSPACE` as both the Agent working directory and Harness sandbox root, falling back to the directory from which `dsh` starts. Choose a dedicated project directory, keep `FEISHU_CONTROL_PERMISSION_MODE=workspace-write`, and never use your home directory or a filesystem root.

#### GitHub

```sh
dsh plugin --profile feishu-control add --save-exact github:SkyCui/dsh-feishu-control#<commit-sha>
```

A Git dependency runs this package's `prepare` build. pnpm 10 and newer block dependency install scripts until explicitly allowed. If the first install is rejected, follow the `dsh`/pnpm diagnostic, copy its exact package key into that profile's `pnpm-workspace.yaml` `allowBuilds` section, and retry with a pinned commit SHA. Authorize only trusted source.

Registry and marketplace installs contain prebuilt artifacts and do not require build-script approval for this package.

## Model routing

Agent sessions created by the bot use the current Profile's default model
selection (the `agent-default-model` composition entry shipped by `dsh-base`,
also read by the Desktop GUI and the one-shot `dsh -p "task"` runner), including
its reasoning effort, so no extra model configuration is needed. On each new
turn, unpinned fields read the current shared default; one in-flight turn keeps
the selection captured when its prompt was assembled.

To pin a different model for Feishu sessions, either:

- **Environment variables** (no YAML editing): set `FEISHU_CONTROL_PROVIDER`
  and/or `FEISHU_CONTROL_MODEL` in `$DSH_HOME/.env`, then restart the service.
  Each variable pins only its own field. While a route field remains unset, it
  and reasoning effort continue to follow the Profile's shared default. Setting
  both opts into a fully fixed route instead.
- **Profile configuration**: override the complete `feishu-agent` configuration
  in the Profile's `cordis.patch.yml` and add `provider` and/or `model`;
  explicit configuration wins per field over the default selection.

Note that a `cordis.patch.yml` entry replaces the targeted row's whole
`config`, so a full override must restate the other fields (`cwd`,
`allowedOpenIds`, `allowGroupChats`, `requireMentionInGroups`).

## Group chats

Group chats are disabled by default. To enable them, override the complete `feishu-agent` configuration in the Profile where the plugin is installed, for example `$DSH_HOME/profiles/feishu-control/cordis.patch.yml`:

```yaml
- id: feishu-agent
  config:
    cwd: !!js process.env.FEISHU_CONTROL_WORKSPACE ?? process.cwd()
    allowedOpenIds: !!js "process.env.FEISHU_CONTROL_ALLOWED_OPEN_IDS?.split(',').map(value => value.trim()).filter(Boolean) ?? []"
    allowGroupChats: true
    requireMentionInGroups: true
```

Mention detection currently confirms only that a mention exists, not that the bot itself was mentioned. Keep group chats disabled for higher-security deployments.

## Approvals

Actions that require user approval send an interactive card. If card delivery fails, the bot sends a text question carrying a six-character answer code:

```text
允许 a1b2c3
拒绝 a1b2c3
```

A bare allow/reject answer works when the chat has exactly one pending text approval. Concurrent approvals require the matching code.

## Development and verification

This repository resolves published DSH API packages from npm and does not require a sibling `deepseek-harness` checkout.

```sh
pnpm install
pnpm verify
pnpm pack
```

`pnpm verify` runs type checking, unit tests, a build, and published-entry validation. `prepack` runs the complete verification pipeline before packing or publishing.

`pnpm check:package-types` additionally validates the packed ESM declarations with Are The Types Wrong.

## Known limitations

- Sessions and redelivery records are in memory and reset when the process restarts.
- At most 2,000 recent message IDs are retained for deduplication.
- Group mention detection cannot identify the specifically mentioned user.
- Only text messages and approval cards are supported; media and attachments are ignored.

## Security reporting

See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
