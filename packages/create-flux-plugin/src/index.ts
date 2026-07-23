import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, posix, relative, resolve, sep } from "node:path";

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function permissionList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string array`);
  }
  const result = value as string[];
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  for (const capability of result) {
    if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(capability)) {
      throw new Error(`${label} has invalid capability: ${capability}`);
    }
  }
  return result;
}

function safeEntry(value: unknown): string {
  const entry = text(value, "entry");
  if (
    entry.includes("\\") ||
    posix.isAbsolute(entry) ||
    posix.normalize(entry) !== entry ||
    entry.startsWith("../") ||
    entry.includes("/../")
  ) {
    throw new Error("entry must stay inside plugin directory");
  }
  if (!entry.endsWith(".js") && !entry.endsWith(".mjs")) {
    throw new Error("entry must be a .js or .mjs file");
  }
  return entry;
}

function contributionList(value: unknown, label: string): JsonObject[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => object(item, `${label}[${index}]`));
}

function validateContributions(manifest: JsonObject, pluginId: string): void {
  if (manifest.contributes === undefined) return;
  const contributes = object(manifest.contributes, "contributes");
  const seen = new Set<string>();
  const identity = (item: JsonObject, label: string): string => {
    const id = text(item.id, `${label}.id`);
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(id) || !id.startsWith(`${pluginId}.`)) {
      throw new Error(`${label}.id must be scoped to ${pluginId}`);
    }
    text(item.title, `${label}.title`);
    if (seen.has(id)) throw new Error(`duplicate contribution ID: ${id}`);
    seen.add(id);
    return id;
  };
  for (const [index, command] of contributionList(
    contributes.commands ?? [],
    "contributes.commands"
  ).entries()) {
    identity(command, `contributes.commands[${index}]`);
  }
  for (const [index, view] of contributionList(
    contributes.views ?? [],
    "contributes.views"
  ).entries()) {
    const label = `contributes.views[${index}]`;
    identity(view, label);
    const entry = text(view.entry, `${label}.entry`);
    if (
      entry.includes("\\") ||
      posix.isAbsolute(entry) ||
      posix.normalize(entry) !== entry ||
      !entry.endsWith(".html")
    ) {
      throw new Error(`${label}.entry must be a clean relative .html path`);
    }
  }
  for (const [index, setting] of contributionList(
    contributes.settings ?? [],
    "contributes.settings"
  ).entries()) {
    const label = `contributes.settings[${index}]`;
    identity(setting, label);
    if (!new Set(["string", "number", "boolean"]).has(String(setting.type))) {
      throw new Error(`${label}.type must be string, number, or boolean`);
    }
    if (setting.description !== undefined && typeof setting.description !== "string") {
      throw new Error(`${label}.description must be a string`);
    }
    if (setting.default !== undefined && typeof setting.default !== setting.type) {
      throw new Error(`${label}.default must match its type`);
    }
  }
}

export function validateManifest(value: unknown): JsonObject {
  const manifest = object(value, "manifest");
  if (manifest.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  const id = text(manifest.id, "id");
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(id)) {
    throw new Error("id must use lowercase letters, digits, dots, or hyphens");
  }
  if (text(manifest.name, "name").length > 120) throw new Error("name exceeds 120 characters");
  if (manifest.description !== undefined && typeof manifest.description !== "string") {
    throw new Error("description must be a string");
  }
  if (manifest.publisher !== undefined && typeof manifest.publisher !== "string") {
    throw new Error("publisher must be a string");
  }
  const version = text(manifest.version, "version");
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      version
    )
  ) {
    throw new Error("version must be valid semver");
  }
  text(manifest.apiVersion, "apiVersion");
  safeEntry(manifest.entry);
  if (manifest.activationEvents !== undefined) {
    if (
      !Array.isArray(manifest.activationEvents) ||
      manifest.activationEvents.some((event) => typeof event !== "string")
    ) {
      throw new Error("activationEvents must be a string array");
    }
    if (manifest.activationEvents.includes("*")) {
      throw new Error("unbounded activation event is not allowed");
    }
  }
  const required = permissionList(manifest.requiredPermissions ?? [], "requiredPermissions");
  const optional = permissionList(manifest.optionalPermissions ?? [], "optionalPermissions");
  for (const capability of optional) {
    if (required.includes(capability)) {
      throw new Error(`capability cannot be required and optional: ${capability}`);
    }
  }
  validateContributions(manifest, id);
  return manifest;
}

export function readManifest(directory: string): JsonObject {
  const path = join(resolve(directory), "flux.plugin.json");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      }
    );
  }
  return validateManifest(value);
}

function packageName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, "-")
      .replace(/^[^a-z]+|[-.]+$/g, "") || "my-plugin"
  );
}

export function createPlugin(directory: string): string {
  const root = resolve(directory);
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new Error(`target directory is not empty: ${root}`);
  }
  const id = packageName(basename(root));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: id,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
          build: "bun build src/main.ts --target browser --format iife --outfile dist/main.js",
          validate: "flux-plugin validate",
          pack: "bun run build && flux-plugin pack",
        },
        dependencies: { "@flux/plugin-sdk": "^0.1.0" },
        devDependencies: { "create-flux-plugin": "^0.1.0", typescript: "^6.0.2" },
      },
      null,
      2
    )}\n`
  );
  writeFileSync(
    join(root, "flux.plugin.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id,
        name: basename(root),
        version: "0.1.0",
        apiVersion: "1",
        description: "A Flux plugin",
        entry: "dist/main.js",
        activationEvents: ["onVaultOpen"],
        requiredPermissions: ["vault.search"],
        optionalPermissions: [],
      },
      null,
      2
    )}\n`
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM"],
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
        },
        include: ["src"],
      },
      null,
      2
    )}\n`
  );
  writeFileSync(
    join(root, "src/main.ts"),
    `import { definePlugin } from "@flux/plugin-sdk";\n\nexport default definePlugin({\n  async activate(context) {\n    await context.capabilities.invoke("vault.search", {\n      query: "#welcome",\n      limit: 5,\n    });\n  },\n});\n`
  );
  writeFileSync(
    join(root, "README.md"),
    `# ${basename(root)}\n\n\`bun install\` installs dependencies. \`bun run validate\` checks manifest permissions. \`bun run pack\` builds a checksumed \`.flux-plugin\` package.\n`
  );
  writeFileSync(join(root, ".gitignore"), "dist/\n*.flux-plugin\nnode_modules/\n");
  return root;
}

function collectFiles(root: string, manifest: JsonObject): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const add = (path: string): void => {
    const linkInfo = lstatSync(path);
    if (linkInfo.isSymbolicLink()) throw new Error(`symlinks are not allowed: ${path}`);
    if (linkInfo.isDirectory()) {
      for (const child of readdirSync(path).sort()) add(join(path, child));
      return;
    }
    const name = relative(root, path).split(sep).join("/");
    files.set(name, readFileSync(path));
  };
  add(join(root, "flux.plugin.json"));
  add(join(root, "dist"));
  const entry = safeEntry(manifest.entry);
  if (!files.has(entry)) throw new Error(`entry does not exist: ${entry}`);
  if (files.size > 1_000) throw new Error("package exceeds 1000 files");
  const size = [...files.values()].reduce((total, data) => total + data.length, 0);
  if (size > 25 * 1024 * 1024) throw new Error("package exceeds 25 MiB");
  return files;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Map<string, Buffer>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const filename = Buffer.from(name);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += header.length + filename.length + data.length;
  }
  const centralSize = central.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

export function packPlugin(directory: string, output?: string): string {
  const root = resolve(directory);
  const manifest = readManifest(root);
  const files = collectFiles(root, manifest);
  const target = resolve(
    output ?? join(root, `${String(manifest.id)}-${String(manifest.version)}.flux-plugin`)
  );
  writeFileSync(target, zip(files), { flag: "wx" });
  return target;
}

export function packageChecksum(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
