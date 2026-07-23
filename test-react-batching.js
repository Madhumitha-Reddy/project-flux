// Mock React's state queue
let state = [{ id: 1, historyIndex: 0 }];
const queue = [];
function setTabs(updater) {
  queue.push(updater);
}

// simulate updateTab
const newIndex = 1;
setTabs((current) => current.map(t => t.id === 1 ? { ...t, historyIndex: newIndex } : t));

// simulate openDocument (historyNavigation = true)
setTabs((current) => current.map(t => {
  if (t.id === 1) {
     return { ...t, historyIndex: true ? t.historyIndex : 999 };
  }
  return t;
}));

// run queue
for (const fn of queue) {
  state = fn(state);
}

console.log("Final state:", state);
