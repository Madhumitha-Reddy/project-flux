import type { ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  ExternalLink,
  Link2,
  PanelBottomOpen,
  PanelRightOpen,
  Pin,
  PinOff,
  X,
} from "lucide-react";
import { ContextMenu, DropdownMenu } from "radix-ui";

import { cn } from "../lib/utils";

export interface FluxTabCommands {
  pinned?: boolean;
  canCloseOthers?: boolean;
  canCloseAfter?: boolean;
  onClose?: () => void;
  onCloseOthers?: () => void;
  onCloseAfter?: () => void;
  onCloseAll?: () => void;
  onTogglePin?: () => void;
  onMoveToNewWindow?: () => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
}

export interface FluxTabContextMenuProps extends FluxTabCommands {
  children: ReactNode;
}

export interface FluxEditorPaneProps extends FluxTabCommands {
  title: ReactNode;
  children: ReactNode;
  headerAction?: ReactNode;
  menuContent?: ReactNode;
  menuLabel?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  className?: string;
}

const menuContentClassName =
  "z-[110] min-w-52 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg [border-color:var(--layout-separator)]";
const menuItemClassName =
  "relative flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 pr-7 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";
const separatorClassName = "my-1 h-px bg-[var(--layout-separator)]";

function ContextCommands({
  pinned,
  canCloseOthers,
  canCloseAfter,
  onClose,
  onCloseOthers,
  onCloseAfter,
  onCloseAll,
  onTogglePin,
  onMoveToNewWindow,
  onSplitRight,
  onSplitDown,
}: FluxTabCommands) {
  return (
    <>
      <ContextMenu.Item className={menuItemClassName} disabled={!onClose} onSelect={onClose}>
        <X className="size-4 text-muted-foreground" />
        Close
      </ContextMenu.Item>
      <ContextMenu.Item
        className={menuItemClassName}
        disabled={!onCloseOthers || !canCloseOthers}
        onSelect={onCloseOthers}
      >
        Close others
      </ContextMenu.Item>
      <ContextMenu.Item
        className={menuItemClassName}
        disabled={!onCloseAfter || !canCloseAfter}
        onSelect={onCloseAfter}
      >
        Close tabs after
      </ContextMenu.Item>
      <ContextMenu.Item className={menuItemClassName} disabled={!onCloseAll} onSelect={onCloseAll}>
        Close all
      </ContextMenu.Item>
      <ContextMenu.Separator className={separatorClassName} />
      <ContextMenu.Item
        className={menuItemClassName}
        disabled={!onTogglePin}
        onSelect={onTogglePin}
      >
        {pinned ? (
          <PinOff className="size-4 text-muted-foreground" />
        ) : (
          <Pin className="size-4 text-muted-foreground" />
        )}
        {pinned ? "Unpin" : "Pin"}
      </ContextMenu.Item>
      <ContextMenu.Item className={menuItemClassName} disabled>
        <Link2 className="size-4" />
        Link with tab…
      </ContextMenu.Item>
      <ContextMenu.Separator className={separatorClassName} />
      <ContextMenu.Item
        className={menuItemClassName}
        disabled={!onMoveToNewWindow}
        onSelect={onMoveToNewWindow}
      >
        <ExternalLink className="size-4" />
        Move to new window
      </ContextMenu.Item>
      <ContextMenu.Item
        className={menuItemClassName}
        disabled={!onSplitRight}
        onSelect={onSplitRight}
      >
        <PanelRightOpen className="size-4" />
        Split right
      </ContextMenu.Item>
      <ContextMenu.Item
        className={menuItemClassName}
        disabled={!onSplitDown}
        onSelect={onSplitDown}
      >
        <PanelBottomOpen className="size-4" />
        Split down
      </ContextMenu.Item>
    </>
  );
}

function DropdownCommands({
  pinned,
  canCloseOthers,
  canCloseAfter,
  onClose,
  onCloseOthers,
  onCloseAfter,
  onCloseAll,
  onTogglePin,
  onMoveToNewWindow,
  onSplitRight,
  onSplitDown,
}: FluxTabCommands) {
  return (
    <>
      <DropdownMenu.Item className={menuItemClassName} disabled={!onClose} onSelect={onClose}>
        <X className="size-4 text-muted-foreground" />
        Close
      </DropdownMenu.Item>
      <DropdownMenu.Item
        className={menuItemClassName}
        disabled={!onCloseOthers || !canCloseOthers}
        onSelect={onCloseOthers}
      >
        Close others
      </DropdownMenu.Item>
      <DropdownMenu.Item
        className={menuItemClassName}
        disabled={!onCloseAfter || !canCloseAfter}
        onSelect={onCloseAfter}
      >
        Close tabs after
      </DropdownMenu.Item>
      <DropdownMenu.Item className={menuItemClassName} disabled={!onCloseAll} onSelect={onCloseAll}>
        Close all
      </DropdownMenu.Item>
      <DropdownMenu.Separator className={separatorClassName} />
      <DropdownMenu.Item
        className={menuItemClassName}
        disabled={!onTogglePin}
        onSelect={onTogglePin}
      >
        {pinned ? (
          <PinOff className="size-4 text-muted-foreground" />
        ) : (
          <Pin className="size-4 text-muted-foreground" />
        )}
        {pinned ? "Unpin" : "Pin"}
      </DropdownMenu.Item>
      <DropdownMenu.Item
        className={menuItemClassName}
        disabled={!onMoveToNewWindow}
        onSelect={onMoveToNewWindow}
      >
        <ExternalLink className="size-4" />
        Move to new window
      </DropdownMenu.Item>
      <DropdownMenu.Item
        className={menuItemClassName}
        disabled={!onSplitRight}
        onSelect={onSplitRight}
      >
        <PanelRightOpen className="size-4" />
        Split right
      </DropdownMenu.Item>
      <DropdownMenu.Item
        className={menuItemClassName}
        disabled={!onSplitDown}
        onSelect={onSplitDown}
      >
        <PanelBottomOpen className="size-4" />
        Split down
      </DropdownMenu.Item>
    </>
  );
}

export function FluxTabContextMenu({ children, ...commands }: FluxTabContextMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div className="contents">{children}</div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContentClassName}>
          <ContextCommands {...commands} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function FluxEditorPane({
  title,
  children,
  headerAction,
  menuContent,
  menuLabel = "Editor options",
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  className,
  ...commands
}: FluxEditorPaneProps) {
  return (
    <section
      className={cn(
        "flux-editor-pane flex h-full min-h-0 min-w-0 flex-col bg-background",
        className
      )}
    >
      <header className="flux-editor-pane-header relative flex h-9 shrink-0 items-center px-2 text-muted-foreground">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Navigate back"
            disabled={!canGoBack}
            onClick={onGoBack}
            className="grid size-7 place-items-center rounded-md outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-35"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Navigate forward"
            disabled={!canGoForward}
            onClick={onGoForward}
            className="grid size-7 place-items-center rounded-md outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-35"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <h1 className="pointer-events-none absolute inset-x-20 truncate text-center text-xs font-medium text-foreground">
          {title}
        </h1>

        {headerAction ? <div className="ml-auto flex items-center">{headerAction}</div> : null}

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={menuLabel}
              className={cn(
                "grid size-7 place-items-center rounded-md outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 data-[state=open]:bg-accent data-[state=open]:text-foreground",
                !headerAction && "ml-auto"
              )}
            >
              <Ellipsis className="size-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={5} className={menuContentClassName}>
              {menuContent ?? <DropdownCommands {...commands} />}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}
