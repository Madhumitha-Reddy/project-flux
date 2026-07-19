import { FluxApp, type FluxRuntime } from "@flux/app-core";
import { WebFluxClient } from "@flux/client-web";

const client = new WebFluxClient();

const webRuntime: FluxRuntime = {
  label: "Web",
  client,
  connect: async () => {
    try {
      const status = await client.getStatus();
      return status.openVault
        ? `Go backend connected · ${status.openVault.name}`
        : "Go backend connected · no vault open";
    } catch {
      return "Go backend offline · start the server on port 8080";
    }
  },
  selectVaultDirectory: async (mode) =>
    window
      .prompt(
        mode === "create" ? "Absolute path for new local vault" : "Absolute path of local vault"
      )
      ?.trim() || null,
};

export default function App() {
  return <FluxApp runtime={webRuntime} windowControlsInset={0} />;
}
