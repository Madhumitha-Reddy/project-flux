import { resolverFor, documentId } from "./packages/app-core/src/link-index";

// Mock documents
const govDoc = {
  title: "GOVERNANCE",
  path: "node_modules/@babel/traverse/GOVERNANCE.md",
  content: "See [README](./README.md) for info",
  contentHash: "1",
};

const babelReadme = {
  title: "README",
  path: "node_modules/@babel/traverse/README.md",
  content: "# Babel Traverse",
  contentHash: "2",
};

const rootReadme = {
  title: "README",
  path: "README.md",
  content: "# Root",
  contentHash: "3",
};

const resolve = resolverFor([govDoc, babelReadme, rootReadme]);

console.log("Gov link resolves to:", resolve("./README.md", govDoc));
console.log("Gov absolute link resolves to:", resolve("/README.md", govDoc));

