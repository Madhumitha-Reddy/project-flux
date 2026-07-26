# create-flux-plugin

```sh
bunx create-flux-plugin my-plugin
cd my-plugin
bun install
bun run validate
bun run pack
```

`pack` creates a ZIP-compatible `.flux-plugin` and prints its SHA-256 checksum. Plugin source stays outside Flux monorepo.

Local unpublished-toolchain setup, install, activation, and verification:
[`docs/plugin-development.md`](../../docs/plugin-development.md).
