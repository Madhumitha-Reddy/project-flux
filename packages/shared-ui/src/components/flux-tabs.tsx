import type {
  ButtonHTMLAttributes,
  DragEventHandler,
  HTMLAttributes,
  MouseEventHandler,
  ReactNode,
} from "react";
import { Check, ChevronDown, FileText, Layers3, Pin, Plus, X } from "lucide-react";
import type { HTMLMotionProps } from "motion/react";
import * as m from "motion/react-m";
import { DropdownMenu } from "radix-ui";

import { cn } from "../lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export interface FluxTabProps extends Omit<HTMLMotionProps<"div">, "title"> {
  active?: boolean;
  closeable?: boolean;
  pinned?: boolean;
  tooltip?: ReactNode;
  onClose?: MouseEventHandler<HTMLButtonElement>;
  onNativeDragStart?: DragEventHandler<HTMLDivElement>;
  onNativeDragEnd?: DragEventHandler<HTMLDivElement>;
  children: ReactNode;
}

export type FluxTabAddButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export interface FluxTabBarProps extends HTMLAttributes<HTMLDivElement> {
  inlineAction?: ReactNode;
  actions?: ReactNode;
}

export interface FluxTabMenuEntry {
  id: string | number;
  label: string;
  active?: boolean;
}

export interface FluxTabMenuProps {
  tabs: FluxTabMenuEntry[];
  stacked: boolean;
  onStackedChange: (stacked: boolean) => void;
  onCloseAll: () => void;
  onSelect: (id: string | number) => void;
}

export type FluxStackedTabProps = FluxTabProps;

const TAB_LAYOUT_SPRING = {
  type: "spring" as const,
  visualDuration: 0.2,
  bounce: 0.06,
};

export function FluxTab({
  active = false,
  closeable = false,
  pinned = false,
  tooltip,
  onClose,
  onNativeDragStart,
  onNativeDragEnd,
  children,
  className,
  ...props
}: FluxTabProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <m.div
          role="tab"
          tabIndex={active ? 0 : -1}
          aria-selected={active}
          data-active={active}
          data-pinned={pinned}
          className={cn(
            "flux-tab flux-window-no-drag group/tab relative flex h-9 w-52 min-w-2 shrink items-center px-1 text-xs outline-none",
            active
              ? "z-10 min-w-12 max-w-52 rounded-t-[5px] border border-transparent border-b-0 bg-background text-foreground group-data-[window-active=false]/layout:border-[var(--layout-separator)] group-data-[window-active=false]/layout:shadow-[0_1px_0_var(--background)]"
              : "max-w-52 text-muted-foreground hover:text-foreground",
            "[&:has(+_.flux-tab[data-active=true])_.flux-tab-separator]:invisible",
            className
          )}
          {...props}
          onDragStartCapture={onNativeDragStart}
          onDragEndCapture={onNativeDragEnd}
          layout="position"
          initial={{
            opacity: 0,
            scale: 0.985,
            width: 0,
            minWidth: 0,
            maxWidth: 0,
            flexBasis: 0,
          }}
          animate={{
            opacity: 1,
            scale: 1,
            width: "13rem",
            minWidth: active ? "3rem" : "0.5rem",
            maxWidth: "13rem",
            flexBasis: "13rem",
          }}
          exit={{
            opacity: 0,
            scale: 0.985,
            width: 0,
            minWidth: 0,
            maxWidth: 0,
            flexBasis: 0,
            paddingLeft: 0,
            paddingRight: 0,
          }}
          transition={{
            duration: 0.18,
            ease: [0.4, 0, 0.2, 1],
            layout: TAB_LAYOUT_SPRING,
            scale: TAB_LAYOUT_SPRING,
            opacity: { duration: 0.11 },
          }}
        >
          <div
            className={cn(
              "flux-tab-content flex h-8 min-w-0 flex-1 items-center rounded-md px-1",
              !active && "group-hover/tab:bg-[var(--tab-hover)]",
              (active || pinned) && "gap-1"
            )}
          >
            <span className="min-w-0 flex-1 truncate rounded-sm text-left leading-5 group-focus-visible/tab:ring-1 group-focus-visible/tab:ring-ring/50">
              {children}
            </span>
            {pinned ? (
              <span
                className="grid size-5 shrink-0 place-items-center text-muted-foreground"
                aria-label="Pinned tab"
              >
                <Pin className="size-3 fill-current opacity-75" />
              </span>
            ) : closeable ? (
              <button
                type="button"
                aria-label={`Close ${typeof children === "string" ? children : "tab"}`}
                className={cn(
                  "grid shrink-0 place-items-center overflow-hidden rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                  active ? "size-5 opacity-100" : "size-0 opacity-0"
                )}
                onClick={onClose}
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>
          {!active ? (
            <span
              aria-hidden="true"
              className="flux-tab-separator pointer-events-none absolute top-1/2 -right-0.5 h-4 w-px -translate-y-1/2 bg-[var(--layout-separator)]"
            />
          ) : null}
        </m.div>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8} className="max-w-72">
        {tooltip ?? children}
      </TooltipContent>
    </Tooltip>
  );
}

export function FluxStackedTab({
  active = false,
  closeable = false,
  pinned = false,
  onClose,
  onNativeDragStart,
  onNativeDragEnd,
  children,
  className,
  ...props
}: FluxStackedTabProps) {
  return (
    <m.div
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      data-pinned={pinned}
      className={cn(
        "flux-window-no-drag group/stacked-tab relative flex h-full w-8 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-1 text-xs text-muted-foreground outline-none [border-color:var(--layout-separator)] focus-visible:bg-accent/50",
        active && "bg-background text-foreground",
        className
      )}
      {...props}
      onDragStartCapture={onNativeDragStart}
      onDragEndCapture={onNativeDragEnd}
      layout="position"
      initial={{ opacity: 0, width: 0 }}
      animate={{ opacity: 1, width: 32 }}
      exit={{ opacity: 0, width: 0 }}
      transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1], layout: TAB_LAYOUT_SPRING }}
    >
      {closeable ? (
        <button
          type="button"
          aria-label={`Close ${typeof children === "string" ? children : "tab"}`}
          className="grid size-5 shrink-0 place-items-center rounded-sm opacity-60 hover:bg-accent hover:opacity-100"
          onClick={onClose}
        >
          <X className="size-3" />
        </button>
      ) : null}
      {pinned ? <Pin className="size-3 shrink-0 fill-current opacity-75" /> : null}
      <FileText className="size-3 shrink-0 opacity-60" />
      <span className="min-h-0 flex-1 truncate py-1 [writing-mode:vertical-rl]">{children}</span>
    </m.div>
  );
}

export function FluxTabBar({
  children,
  inlineAction,
  actions,
  className,
  ...props
}: FluxTabBarProps) {
  return (
    <div
      role="tablist"
      className={cn(
        "flux-window-drag flex h-full min-w-0 items-center overflow-hidden px-3 [&:has(.flux-tab-strip:empty)>.flux-tab-inline-action]:ml-0",
        className
      )}
      {...props}
    >
      <div className="flux-tab-strip flex h-full w-max min-w-0 max-w-full shrink items-end overflow-visible">
        {children}
      </div>
      {inlineAction ? (
        <div className="flux-tab-inline-action ml-2 flex shrink-0 translate-y-1 items-end">
          {inlineAction}
        </div>
      ) : null}
      <div className="min-w-0 flex-1" />
      {actions ? (
        <div className="ml-1 flex shrink-0 translate-y-1 items-center">{actions}</div>
      ) : null}
    </div>
  );
}

export function FluxTabAddButton({
  className,
  "aria-label": ariaLabel = "New tab",
  ...props
}: FluxTabAddButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(
        "flux-window-no-drag grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50",
        className
      )}
      {...props}
    >
      <Plus className="size-4" />
    </button>
  );
}

export function FluxTabMenu({
  tabs,
  stacked,
  onStackedChange,
  onCloseAll,
  onSelect,
}: FluxTabMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Tab options"
          title="Tab options"
          className="flux-window-no-drag grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 data-[state=open]:bg-accent/60 data-[state=open]:text-foreground"
        >
          <ChevronDown className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[100] max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] min-w-56 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg [border-color:var(--layout-separator)]"
        >
          <DropdownMenu.CheckboxItem
            checked={stacked}
            onCheckedChange={(checked) => onStackedChange(checked === true)}
            className="relative flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 pr-8 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <Layers3 className="size-4 text-muted-foreground" />
            Stack tabs
            <DropdownMenu.ItemIndicator className="absolute right-2">
              <Check className="size-4" />
            </DropdownMenu.ItemIndicator>
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.Separator className="my-1 h-px bg-[var(--layout-separator)]" />
          <DropdownMenu.Item
            disabled={tabs.length === 0}
            onSelect={onCloseAll}
            className="flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-sm text-destructive outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-destructive/10"
          >
            <X className="size-4" />
            Close all
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-[var(--layout-separator)]" />
          {tabs.map((tab) => (
            <DropdownMenu.Item
              key={tab.id}
              onSelect={() => onSelect(tab.id)}
              className="relative flex h-8 max-w-72 cursor-default select-none items-center rounded-md px-2 pr-8 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <span className="truncate">{tab.label}</span>
              {tab.active ? <Check className="absolute right-2 size-4" /> : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
