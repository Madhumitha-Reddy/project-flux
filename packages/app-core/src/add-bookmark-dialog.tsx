import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import { X, ChevronsUpDown } from "lucide-react";
import type { BookmarkItem } from "./bookmark-store";

export interface AddBookmarkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { title: string; path?: string } | null;
  existingBookmarks: BookmarkItem[];
  existingGroups: string[];
  onSave: (bookmark: { id?: string; title: string; path: string; group?: string | null }) => void;
  onRemove?: (id: string) => void;
  onCreateGroup?: (groupName: string) => void;
}

export function AddBookmarkDialog({
  open,
  onOpenChange,
  target,
  existingBookmarks,
  existingGroups,
  onSave,
  onRemove,
  onCreateGroup,
}: AddBookmarkDialogProps) {
  const [title, setTitle] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [newGroupName, setNewGroupName] = useState("");
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  const path = target?.path || target?.title || "";

  // Check if a bookmark already exists for this note (by path or title)
  const existingBookmark = existingBookmarks.find(
    (b) =>
      b.path.toLowerCase() === path.toLowerCase() ||
      b.title.toLowerCase() === (target?.title || "").toLowerCase()
  );
  const isEditing = Boolean(existingBookmark);

  useEffect(() => {
    if (target) {
      if (existingBookmark) {
        setTitle(existingBookmark.title);
        setSelectedGroup(existingBookmark.group || "");
      } else {
        setTitle(target.title || "");
        setSelectedGroup("");
      }
      setNewGroupName("");
      setIsCreatingGroup(false);
    }
  }, [target, open, existingBookmark]);

  if (!target) return null;

  const handleGroupSelectChange = (value: string) => {
    if (value === "__new__") {
      setIsCreatingGroup(true);
      setSelectedGroup("__new__");
    } else {
      setIsCreatingGroup(false);
      setSelectedGroup(value);
    }
  };

  const handleSave = () => {
    let finalGroup: string | null = selectedGroup;
    if (isCreatingGroup && newGroupName.trim()) {
      finalGroup = newGroupName.trim();
      onCreateGroup?.(finalGroup);
    } else if (selectedGroup === "__new__" || !selectedGroup) {
      finalGroup = null;
    }

    onSave({
      id: existingBookmark?.id,
      title: title.trim() || target.title,
      path: path,
      group: finalGroup,
    });
    onOpenChange(false);
  };

  const handleRemove = () => {
    if (existingBookmark && onRemove) {
      onRemove(existingBookmark.id);
    }
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[180] bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[181] w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl [border-color:var(--layout-separator)]">
          <div className="relative flex items-center justify-between mb-4">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              {isEditing ? "Edit bookmark" : "Add bookmark"}
            </Dialog.Title>
            <Dialog.Close className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors outline-none">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            {isEditing ? "Edit bookmark details" : "Add bookmark details"}
          </Dialog.Description>

          <div className="mt-2 text-xs">
            {/* Row 1: Path */}
            <div className="grid grid-cols-[1fr_260px] items-center py-2.5 border-b [border-color:var(--layout-separator)]">
              <label htmlFor="bookmark-path" className="text-xs text-muted-foreground">
                Path
              </label>
              <input
                id="bookmark-path"
                type="text"
                readOnly
                value={path}
                className="w-[260px] rounded-md border bg-muted/10 px-2.5 py-1 text-xs text-muted-foreground/80 outline-none [border-color:var(--layout-separator)] focus-visible:ring-0"
              />
            </div>

            {/* Row 2: Title */}
            <div className="grid grid-cols-[1fr_260px] items-center py-2.5 border-b [border-color:var(--layout-separator)]">
              <label htmlFor="bookmark-title" className="text-xs text-foreground font-normal">
                Title
              </label>
              <input
                id="bookmark-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Bookmark title"
                className="w-[260px] rounded-md border bg-background px-2.5 py-1 text-xs text-foreground outline-none focus:border-foreground/30 focus:ring-1 focus:ring-ring/50 [border-color:var(--layout-separator)]"
              />
            </div>

            {/* Row 3: Bookmark Group */}
            <div className={`grid grid-cols-[1fr_260px] items-center py-2.5 ${isCreatingGroup ? "border-b [border-color:var(--layout-separator)]" : ""}`}>
              <label htmlFor="bookmark-group" className="text-xs text-foreground font-normal">
                Bookmark group
              </label>
              <div className="relative w-[260px]">
                <select
                  id="bookmark-group"
                  value={selectedGroup}
                  onChange={(e) => handleGroupSelectChange(e.target.value)}
                  className="w-full appearance-none rounded-md border bg-background pl-2.5 pr-8 py-1 text-xs text-foreground outline-none focus:border-foreground/30 focus:ring-1 focus:ring-ring/50 [border-color:var(--layout-separator)]"
                >
                  <option value="">None</option>
                  {existingGroups.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                  <option value="__new__">+ New Group...</option>
                </select>
                <ChevronsUpDown className="absolute right-2.5 top-1/2 size-3 -translate-y-1/2 pointer-events-none text-muted-foreground" strokeWidth={1.5} />
              </div>
            </div>

            {/* Row 4: New Group Name (if creating a group) */}
            {isCreatingGroup && (
              <div className="grid grid-cols-[1fr_260px] items-center py-2.5">
                <label htmlFor="new-group-name" className="text-xs text-foreground font-normal">
                  New Group Name
                </label>
                <input
                  id="new-group-name"
                  type="text"
                  autoFocus
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Enter group name"
                  className="w-[260px] rounded-md border bg-background px-2.5 py-1 text-xs text-foreground outline-none focus:border-foreground/30 focus:ring-1 focus:ring-ring/50 [border-color:var(--layout-separator)]"
                />
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between gap-2">
            {isEditing && onRemove ? (
              <button
                type="button"
                onClick={handleRemove}
                className="rounded-md bg-[#363636] hover:bg-[#444444] text-[#ff4d4f] border border-[#383838] shadow-sm px-4 py-1.5 text-xs font-medium transition-colors"
              >
                Remove
              </button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              <Dialog.Close className="rounded-md bg-[#363636] hover:bg-[#444444] text-foreground border border-[#383838] shadow-sm px-4 py-1.5 text-xs font-medium transition-colors">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                onClick={handleSave}
                disabled={!title.trim()}
                className="rounded-md bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-1.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 shadow-sm"
              >
                Save
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
