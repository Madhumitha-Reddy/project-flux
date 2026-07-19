import { expect, test } from "bun:test";
import {
  findWorkspaceLeaf,
  moveWorkspaceTab,
  workspaceEdgeLeafIds,
  workspaceLeaves,
  type WorkspaceNode,
} from "../src/workspace-tree";

test("moving a split's last tab collapses its empty leaf", () => {
  const root: WorkspaceNode = {
    kind: "split",
    id: 3,
    direction: "horizontal",
    children: [
      { kind: "leaf", id: 1, view: "editor", tabIds: [1], activeTabId: 1 },
      { kind: "leaf", id: 2, view: "graph", tabIds: [2], activeTabId: 2 },
    ],
  };

  const moved = moveWorkspaceTab(root, 2, 2, 1);
  expect(workspaceLeaves(moved)).toHaveLength(1);
  expect(findWorkspaceLeaf(moved, 1)?.tabIds).toEqual([1, 2]);
  expect(findWorkspaceLeaf(moved, 1)?.activeTabId).toBe(2);
});

test("finds the titlebar edges across four-way splits", () => {
  const leaf = (id: number): WorkspaceNode => ({
    kind: "leaf",
    id,
    view: "editor",
    tabIds: [id],
    activeTabId: id,
  });
  const root: WorkspaceNode = {
    kind: "split",
    id: 7,
    direction: "horizontal",
    children: [
      {
        kind: "split",
        id: 5,
        direction: "vertical",
        children: [leaf(1), leaf(2)],
      },
      {
        kind: "split",
        id: 6,
        direction: "vertical",
        children: [leaf(3), leaf(4)],
      },
    ],
  };

  expect(workspaceEdgeLeafIds(root, "left")).toEqual([1, 2]);
  expect(workspaceEdgeLeafIds(root, "right")).toEqual([3, 4]);
});
