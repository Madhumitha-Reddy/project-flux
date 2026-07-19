import type { DemoDocument } from "./markdown-editor";

const WIKILINK = /!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const MARKDOWN_LINK = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

export interface DocumentLink {
  source: string;
  target: string;
}

export interface DocumentMention {
  source: string;
  target: string;
  line: number;
  excerpt: string;
}

function normalizeTarget(value: string) {
  let target = value.trim().replace(/^<|>$/g, "");
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep malformed-but-readable links searchable.
  }
  return target
    .split(/[?#]/, 1)[0]
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\.(md|markdown)$/i, "")
    .replace(/^\/+|\/+$/g, "");
}

function aliasesFor(document: DemoDocument) {
  const path = normalizeTarget(document.path ?? "");
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return [document.title, normalizeTarget(document.title), path, basename]
    .filter(Boolean)
    .map((value) => value.toLocaleLowerCase());
}

function resolverFor(documents: DemoDocument[]) {
  const known = new Map<string, string>();
  for (const document of documents) {
    for (const alias of aliasesFor(document)) if (!known.has(alias)) known.set(alias, document.title);
  }
  return (rawTarget: string) => {
    if (/^[a-z][a-z\d+.-]*:/i.test(rawTarget)) return undefined;
    const target = normalizeTarget(rawTarget).toLocaleLowerCase();
    return known.get(target) ?? known.get(target.slice(target.lastIndexOf("/") + 1));
  };
}

function rawLinks(content: string) {
  const links: Array<{ target: string; index: number; length: number }> = [];
  for (const match of content.matchAll(WIKILINK)) {
    links.push({ target: match[1].trim(), index: match.index, length: match[0].length });
  }
  for (const match of content.matchAll(MARKDOWN_LINK)) {
    links.push({ target: match[1].trim(), index: match.index, length: match[0].length });
  }
  return links.sort((left, right) => left.index - right.index);
}

function locationFor(content: string, index: number) {
  const line = content.slice(0, index).split("\n").length;
  const start = content.lastIndexOf("\n", index - 1) + 1;
  const end = content.indexOf("\n", index);
  const excerpt = content.slice(start, end < 0 ? content.length : end).trim();
  return { line, excerpt };
}

function maskMarkdown(content: string) {
  const preserveLines = (value: string) => value.replace(/[^\n]/g, " ");
  let masked = content
    .replace(/```[\s\S]*?```/g, preserveLines)
    .replace(/`[^`\n]*`/g, preserveLines)
    .replace(/%%[\s\S]*?%%/g, preserveLines);
  for (const link of rawLinks(masked)) {
    masked =
      masked.slice(0, link.index) + " ".repeat(link.length) + masked.slice(link.index + link.length);
  }
  return masked;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function linkedTitles(content: string) {
  return rawLinks(content).map((link) => normalizeTarget(link.target));
}

export function linkedMentionsFor(documents: DemoDocument[], targetTitle: string) {
  const resolve = resolverFor(documents);
  const mentions: DocumentMention[] = [];
  for (const document of documents) {
    for (const link of rawLinks(document.content)) {
      const target = resolve(link.target);
      if (target !== targetTitle) continue;
      mentions.push({ source: document.title, target, ...locationFor(document.content, link.index) });
    }
  }
  return mentions;
}

export function unlinkedMentionsFor(documents: DemoDocument[], targetTitle: string) {
  const mentions: DocumentMention[] = [];
  if (!targetTitle.trim()) return mentions;
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])(${escapeRegExp(targetTitle)})(?=$|[^\\p{L}\\p{N}_])`,
    "giu"
  );
  for (const document of documents) {
    if (document.title === targetTitle) continue;
    const searchable = maskMarkdown(document.content);
    for (const match of searchable.matchAll(pattern)) {
      const index = match.index + match[1].length;
      mentions.push({
        source: document.title,
        target: targetTitle,
        ...locationFor(document.content, index),
      });
    }
  }
  return mentions;
}

export function buildLinkIndex(documents: DemoDocument[]) {
  const resolve = resolverFor(documents);
  const edges: DocumentLink[] = [];
  const outgoing = new Map<string, Set<string>>();
  const backlinks = new Map<string, Set<string>>();

  for (const document of documents) {
    const targets = new Set(
      rawLinks(document.content)
        .map((link) => resolve(link.target))
        .filter((target): target is string => Boolean(target))
    );
    for (const target of targets) {
      edges.push({ source: document.title, target });
      if (!outgoing.has(document.title)) outgoing.set(document.title, new Set());
      if (!backlinks.has(target)) backlinks.set(target, new Set());
      outgoing.get(document.title)?.add(target);
      backlinks.get(target)?.add(document.title);
    }
  }

  return { edges, outgoing, backlinks };
}
