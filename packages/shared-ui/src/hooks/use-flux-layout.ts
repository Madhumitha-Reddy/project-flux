import { useCallback, useEffect, useMemo, useState } from "react";

export type FluxSidebarSide = "left" | "right";

export interface FluxSidebarOptions {
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  collapsePressure?: number;
  defaultCollapsed?: boolean;
}

export interface FluxSidebarState {
  width: number;
  collapsed: boolean;
}

export interface FluxLayoutState {
  left: FluxSidebarState;
  right: FluxSidebarState;
}

interface ResolvedSidebarOptions {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  collapsePressure: number;
  defaultCollapsed: boolean;
}

interface UseFluxLayoutOptions {
  left?: FluxSidebarOptions;
  right?: FluxSidebarOptions;
  storageKey?: string | false;
  onStateChange?: (state: FluxLayoutState) => void;
}

const DEFAULT_SIDEBAR: ResolvedSidebarOptions = {
  defaultWidth: 280,
  minWidth: 220,
  maxWidth: 480,
  collapsePressure: 112,
  defaultCollapsed: false,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function resolveOptions(options?: FluxSidebarOptions): ResolvedSidebarOptions {
  const minWidth = Math.max(120, options?.minWidth ?? DEFAULT_SIDEBAR.minWidth);
  const maxWidth = Math.max(minWidth, options?.maxWidth ?? DEFAULT_SIDEBAR.maxWidth);

  return {
    minWidth,
    maxWidth,
    collapsePressure: Math.max(0, options?.collapsePressure ?? DEFAULT_SIDEBAR.collapsePressure),
    defaultWidth: clamp(options?.defaultWidth ?? DEFAULT_SIDEBAR.defaultWidth, minWidth, maxWidth),
    defaultCollapsed: options?.defaultCollapsed ?? DEFAULT_SIDEBAR.defaultCollapsed,
  };
}

function isSidebarState(value: unknown): value is FluxSidebarState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FluxSidebarState>;
  return typeof candidate.width === "number" && typeof candidate.collapsed === "boolean";
}

function createInitialState(
  left: ResolvedSidebarOptions,
  right: ResolvedSidebarOptions,
  storageKey: string | false
): FluxLayoutState {
  const fallback: FluxLayoutState = {
    left: { width: left.defaultWidth, collapsed: left.defaultCollapsed },
    right: { width: right.defaultWidth, collapsed: right.defaultCollapsed },
  };

  if (!storageKey || typeof window === "undefined") return fallback;

  try {
    const saved = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "null"
    ) as Partial<FluxLayoutState> | null;
    if (!saved || !isSidebarState(saved.left) || !isSidebarState(saved.right)) return fallback;

    return {
      left: {
        width: clamp(saved.left.width, left.minWidth, left.maxWidth),
        collapsed: saved.left.collapsed,
      },
      right: {
        width: clamp(saved.right.width, right.minWidth, right.maxWidth),
        collapsed: saved.right.collapsed,
      },
    };
  } catch {
    return fallback;
  }
}

export function useFluxLayout({
  left: leftOptions,
  right: rightOptions,
  storageKey = "flux-layout",
  onStateChange,
}: UseFluxLayoutOptions = {}) {
  const left = useMemo(() => resolveOptions(leftOptions), [leftOptions]);
  const right = useMemo(() => resolveOptions(rightOptions), [rightOptions]);
  const [state, setState] = useState<FluxLayoutState>(() =>
    createInitialState(left, right, storageKey)
  );

  useEffect(() => {
    if (storageKey) window.localStorage.setItem(storageKey, JSON.stringify(state));
    onStateChange?.(state);
  }, [onStateChange, state, storageKey]);

  const toggle = useCallback((side: FluxSidebarSide) => {
    setState((current) => ({
      ...current,
      [side]: { ...current[side], collapsed: !current[side].collapsed },
    }));
  }, []);

  const resize = useCallback(
    (side: FluxSidebarSide, requestedWidth: number) => {
      const constraints = side === "left" ? left : right;
      setState((current) => {
        if (requestedWidth <= constraints.minWidth - constraints.collapsePressure) {
          return {
            ...current,
            [side]: { ...current[side], collapsed: true },
          };
        }

        return {
          ...current,
          [side]: {
            width: clamp(requestedWidth, constraints.minWidth, constraints.maxWidth),
            collapsed: false,
          },
        };
      });
    },
    [left, right]
  );

  return {
    state,
    constraints: { left, right },
    resize,
    toggle,
  };
}
