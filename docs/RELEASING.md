# Release process

## One-time setup

1. Create a public GitHub repository and set `repository`, `homepage`, and
   `bugs` in `package.json` to its real URL.
2. Reserve the new npm package with one maintainer-authenticated bootstrap
   publication. From a clean `main` checkout, run all release checks and then:

   ```sh
   pnpm verify
   pnpm check:package-types
   pnpm audit
   npm publish --access public --provenance=false
   ```

   The explicit override is required only for this first local publication;
   provenance attestations require a supported CI identity.
3. In the npm package settings, add a GitHub Actions trusted publisher using
   the exact public repository and workflow filename `publish.yml`. Allow
   `npm publish`.
4. Enable private vulnerability reporting in the repository Security settings.
5. Protect the `main` branch and release tags, and require the `ci` workflow.
6. Add the GitHub repository topics `dsh-plugin`, `deepseek-harness`, `feishu`,
   and `lark` so topic-based DSH directories can discover it.

The publish workflow uses short-lived OIDC credentials; do not add an
`NPM_TOKEN` secret.

The first version may be published before its matching GitHub Release exists.
When that release is subsequently created, the workflow verifies the release
but safely skips `npm publish` because the exact version already exists.

## Release

1. Update `version` in `package.json` and run `pnpm install` to keep the lockfile
   synchronized.
2. Run `pnpm verify`, `pnpm check:package-types`, and `pnpm audit`.
3. Merge the release commit into `main`.
4. Create a GitHub release whose tag is exactly `v<package version>` (for
   example, `v0.1.0`).

Publishing the GitHub release runs `.github/workflows/publish.yml`. The workflow
repeats all checks, verifies that the tag matches `package.json`, and publishes
the public npm package with provenance.

## Consumer smoke test

After npm publication, test from a clean temporary DeepSeek Harness profile:

```sh
dsh plugin --profile feishu-control add --save-exact dsh-feishu-control@<version>
dsh --profile feishu-control --dump-config
```

The dump must contain a `# == dsh-feishu-control` layer and the `feishu`,
`feishu-local`, and `feishu-agent` entries.

## Community plugin directories

After the public repository, npm version, and smoke-test evidence are live,
submit the canonical repository through the DSH Plugin Registry's
[plugin-submission issue](https://github.com/tjsdyy/dshplugin/issues/new?labels=plugin-submission).
Include the exact npm package/version, install command, supported DSH range,
license, security-policy link, and the clean-profile smoke-test result.

These directories are community-operated and independent of DeepSeek. A
`dsh-plugin` GitHub topic improves discovery but does not replace their review
or prove installability.
