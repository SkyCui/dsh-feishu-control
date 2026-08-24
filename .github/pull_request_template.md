## Summary

Describe the user-visible change and why it belongs in this plugin.

## Security impact

Describe changes to sender authorization, group behavior, approvals, credentials,
filesystem/command access, logging, dependencies, or installation scripts. Write
`None` only after checking each category.

## Verification

- [ ] Added or updated behavior tests.
- [ ] Ran `pnpm verify`.
- [ ] Ran `pnpm check:package-types` when package exports or declarations changed.
- [ ] Ran `pnpm audit` when dependencies or the bundled runtime changed.
- [ ] Updated both `README.md` and `README.zh.md` for user-facing changes.
- [ ] Confirmed no credentials or identifying Feishu values are included.
