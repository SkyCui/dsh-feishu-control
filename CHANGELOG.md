# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## 0.1.5 - 2026-08-25

### Changed

- Install a live reference to the shared model selection on Feishu sessions,
  so unpinned route fields and reasoning effort are resolved for every turn
  instead of being frozen at session creation. Fully pinned routes stay fixed;
  partially pinned routes keep their remaining fields live.
- Expose an optional env-var model route (`FEISHU_CONTROL_PROVIDER` and
  `FEISHU_CONTROL_MODEL`) in the bundle patch; leaving them unset inherits the
  profile default, so no deployment needs to hardcode a model.

## 0.1.4 - 2026-08-24

### Changed

- Use the explicit `dsh-feishu-control@latest` selector in every user-facing
  registry installation and CLI command, including `dsh plugin add` and
  `pnpm dlx` examples.

### Fixed

- Drive Feishu-created agents with the host profile's default model selection
  (`agent-default-model`) when the `feishu-agent` config does not pin
  `provider`/`model`, mirroring the one-shot `dsh -p "task"` runner. Previously
  every Feishu message turned instantly with `agent ... has no provider/model`,
  leaving the THINKING reaction stuck with no reply. Explicit config values
  still win over the selection per field.

## 0.1.3 - 2026-08-24

### Changed

- Use an explicit `dsh-feishu-control@latest` package selector in every
  user-facing `pnpm dlx` command across the CLI, bot guidance, documentation,
  and marketplace submission notes.

## 0.1.2 - 2026-08-24

### Fixed

- Prompt for an existing App ID and sender allowlist during repeated setup,
  using the saved values as editable defaults instead of silently reusing them.
- Keep an existing App Secret hidden and reusable without printing it.
- Replace the unauthorized reply's environment-variable instruction with a
  beginner-friendly open_id, setup-command, and restart workflow.

## 0.1.1 - 2026-08-24

### Fixed

- Use Harness-compatible `FEISHU_CONTROL_*` dotenv names because Harness
  `0.1.0-rc.8` rejects bootstrap-owned `DSH_*` names in dotenv files.
- Automatically migrate the legacy `DSH_FEISHU_*` setup values without
  printing or discarding stored credentials.
- Keep legacy `DSH_FEISHU_*` values as launch-environment-only fallbacks.
- Normalize the published `feishu-control` binary path to avoid npm's
  package-manifest auto-correction warning.

## 0.1.0 - 2026-08-23

### Added

- Installable DeepSeek Harness bundle for a `feishu-control` profile.
- Feishu long-connection provider and text-message bridge to Harness agents.
- Interactive-card approvals with coded text fallback.
- Fail-closed sender allowlist and credential validation.
- Message redelivery suppression and per-chat processing serialization.
- Ordered, Unicode-safe chunking for long agent replies.
- Group chats disabled by default, with mention gating when explicitly enabled.
- Prebuilt npm runtime, type declarations, third-party license notices, CI, and
  OIDC trusted-publishing workflow.
- Beginner-friendly `feishu-control setup`, `doctor`, and `start` terminal
  commands with explicit DeepSeek Harness prerequisite checks.
- Owner-only local credential storage, workspace validation, and an automated
  DSH profile configuration check in the setup wizard.
- Marketplace-aware setup that reuses an existing Desktop Profile, exact-pins
  standalone installs, and avoids launching a duplicate Harness process.
