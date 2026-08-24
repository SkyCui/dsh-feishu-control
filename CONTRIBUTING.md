# Contributing

## Development setup

This repository resolves DeepSeek Harness APIs from published npm packages and does not require a sibling Harness checkout.

```sh
pnpm install
pnpm verify
```

Behavior changes require unit coverage. Keep `README.md` and `README.zh.md` synchronized, never commit credentials, and run `pnpm verify` before opening a pull request.

## Release

`prepack` runs the complete verification pipeline and produces `lib/`. Git dependencies run `prepare`, so a trusted GitHub checkout can build itself after the profile authorizes its install script. Registry packages contain prebuilt JavaScript and declarations.
