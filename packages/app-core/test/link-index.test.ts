import { describe, expect, test } from "bun:test";
import {
  buildLinkIndex,
  linkedMentionsFor,
  unlinkedMentionsFor,
} from "../src/link-index";
import type { DemoDocument } from "../src/markdown-editor";

const documents: DemoDocument[] = [
  { title: "Target", path: "notes/Target.md", content: "# Target\n" },
  {
    title: "Linked",
    path: "Linked.md",
    content: "See [[Target#Heading|the target]].\nAnd [again](notes/Target.md#Heading).",
  },
  {
    title: "Plain",
    path: "Plain.md",
    content: "Target is mentioned here. `Target` and [[Target]] are links, not plain mentions.",
  },
];

describe("link index", () => {
  test("resolves wiki and markdown links by title or vault path", () => {
    const index = buildLinkIndex(documents);
    expect(index.backlinks.get("Target")).toEqual(new Set(["Linked", "Plain"]));
    expect(linkedMentionsFor(documents, "Target")).toHaveLength(3);
  });

  test("finds unlinked title mentions but ignores links and inline code", () => {
    expect(unlinkedMentionsFor(documents, "Target")).toEqual([
      expect.objectContaining({ source: "Plain", line: 1 }),
    ]);
  });
});
