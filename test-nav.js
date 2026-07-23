import { describe, test, expect } from "bun:test";

describe("history navigation", () => {
  test("mock logic", () => {
    let tab = {
      history: ["A"],
      historyIndex: 0
    };
    
    const updateTab = (fn) => { tab = fn(tab); };
    
    // 1. Link click to B
    const inPlace = true;
    const historyNavigation = false;
    let newHistory = tab.history.slice(0, tab.historyIndex + 1);
    newHistory.push("B");
    tab = { ...tab, history: newHistory, historyIndex: newHistory.length - 1 };
    
    expect(tab.history).toEqual(["A", "B"]);
    expect(tab.historyIndex).toBe(1);
    
    // 2. Click Back
    const newIndex = tab.historyIndex - 1;
    updateTab((t) => ({ ...t, historyIndex: newIndex }));
    
    // openDocument(tab.history[newIndex], true, true);
    tab = { ...tab, history: tab.history, historyIndex: tab.historyIndex };
    
    expect(tab.history).toEqual(["A", "B"]);
    expect(tab.historyIndex).toBe(0);
    
    // 3. Click Forward
    const newIndex2 = tab.historyIndex + 1;
    updateTab((t) => ({ ...t, historyIndex: newIndex2 }));
    
    tab = { ...tab, history: tab.history, historyIndex: tab.historyIndex };
    
    expect(tab.history).toEqual(["A", "B"]);
    expect(tab.historyIndex).toBe(1);
  });
});
