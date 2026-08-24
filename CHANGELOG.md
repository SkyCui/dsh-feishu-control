# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
