import { globalBacklinkStore } from "./packages/app-core/src/link-index";

// Mocking some documents
const doc1 = { title: "readme.v3", path: "readme.v3", content: "If you are looking for zod v4 support, please click [here](/README.md)." };
const doc2 = { title: "README", path: "README.md", content: "# README" };

globalBacklinkStore.updateDocument(doc1);
globalBacklinkStore.updateDocument(doc2);

const linked = globalBacklinkStore.getLinkedMentions("README.md");
console.log("Linked to README.md:", linked);
const linked2 = globalBacklinkStore.getLinkedMentions("README");
console.log("Linked to README:", linked2);

