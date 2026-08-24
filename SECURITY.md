# Security policy

## Reporting a vulnerability

Use the repository's **Security** tab to submit a private vulnerability report. Do not open a public issue for an unpatched vulnerability.

Include the affected version, reproduction steps, expected impact, and any proposed mitigation. Please wait for acknowledgement before public disclosure.

## Security-sensitive behavior

This plugin lets a Feishu message drive a coding agent on the host machine. The agent may execute commands, read or modify files, and spend API quota.

- An empty sender allowlist denies every sender.
- Group chats are disabled by default.
- Approval decisions are accepted only from allowlisted operators and the originating chat.
- Recent Feishu message IDs are retained in memory to suppress redelivery.
- Unanswered and withdrawn approval requests fail closed.
- The recommended deployment uses `FEISHU_CONTROL_PERMISSION_MODE=workspace-write` and a
  dedicated project directory as the process working directory.

Only the latest released version receives security fixes.
