#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createPlugin, packPlugin, packageChecksum, readManifest } from "./index.js";

export function main(args = process.argv.slice(2)): void {
  const [command, path = ".", ...rest] = args;
  if (!command || command === "help" || command === "--help") {
    console.log(
      "Usage: create-flux-plugin <directory> | flux-plugin validate [directory] | flux-plugin pack [directory] [--out file]"
    );
    return;
  }
  if (command === "validate") {
    readManifest(path);
    console.log("Valid Flux plugin manifest");
    return;
  }
  if (command === "pack") {
    const outIndex = rest.indexOf("--out");
    const output = outIndex >= 0 ? rest[outIndex + 1] : undefined;
    if (outIndex >= 0 && !output) throw new Error("--out requires a file path");
    const packed = packPlugin(path, output);
    console.log(`${packed}\nSHA256 ${packageChecksum(packed)}`);
    return;
  }
  if (command === "create") {
    console.log(createPlugin(path));
    return;
  }
  console.log(createPlugin(command));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
