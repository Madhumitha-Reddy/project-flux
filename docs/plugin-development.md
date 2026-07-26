# Flux plugin development

Plugin source stays outside Flux monorepo. Generator creates template; app installs packaged
`.flux-plugin`.

## Published toolchain

```sh
bunx create-flux-plugin ~/Code/my-flux-plugin
cd ~/Code/my-flux-plugin
bun install
bun run validate
bun run pack
```

## Local monorepo toolchain

Use this until `create-flux-plugin` and `@flux/plugin-sdk` are published:

```sh
cd /path/to/flux
bun run --cwd packages/create-flux-plugin build
cd packages/create-flux-plugin && bun link
cd ../plugin-sdk && bun link

cd ~/Code
node /path/to/flux/packages/create-flux-plugin/dist/cli.js my-flux-plugin
cd my-flux-plugin
bun link create-flux-plugin
bun link @flux/plugin-sdk
bun run validate
bun run pack
```

`pack` prints artifact path and SHA-256. Rebuild after code changes. Increment manifest version
before installing an update.

## Install and run

1. Open target vault in Flux.
2. Open Plugins → Manage plugins → Installed.
3. Select **Install from file…** and choose generated `.flux-plugin`.
4. Review staged permissions, activate version, then enable it for current vault.
5. Click **Run Search welcome notes**. Success toast proves worker activated, event handler ran,
   and declared `vault.search` capability completed.
6. Check plugin card for failure count or last error when command fails.

Plugin package is global app metadata. Permission grants, enablement, settings, worker, and errors
are per vault. Installing does not silently enable plugin in every vault.

## Development loop

```sh
# edit src/main.ts and flux.plugin.json
bun run validate
bun run pack
```

Install new version, activate it, enable for test vault, run contributed command. Roll back from
plugin manager when new version fails. Flux currently records failures and last error, not usage
analytics.
