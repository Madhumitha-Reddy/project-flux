# Flux Plugin SDK

Typed manifest and capability API for sandboxed Flux plugins.

```ts
import { definePlugin } from "@flux/plugin-sdk";

export default definePlugin({
  async activate(context) {
    const { results } = await context.capabilities.invoke("vault.search", { query: "hello" });
    console.info(results);
  },
});
```

Declare every used capability in `flux.plugin.json`. Runtime approval remains authoritative.
