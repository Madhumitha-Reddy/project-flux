import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  select,
  zoom,
  zoomIdentity,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  type ZoomTransform,
} from "d3";
import {
  Bookmark,
  Camera,
  ChevronDown,
  Maximize2,
  PanelBottomOpen,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Search,
  Settings,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { FluxEditorPane } from "@flux/shared-ui/components/workspace-tab";
import type { DemoDocument } from "./markdown-editor";
import { buildLinkIndex, linkedTitles } from "./link-index";
import type { FileEntry } from "@flux/bridge-contract";

interface GraphViewProps {
  documents: DemoDocument[];
  attachments?: FileEntry[];
  activeTitle?: string;
  bookmarked: boolean;
  onBookmarkChange: (value: boolean) => void;
  onOpenDocument: (title: string) => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
}

const graphMenuItem =
  "flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

function GraphViewMenu({
  bookmarked,
  onBookmarkChange,
  onCopyScreenshot,
  onSplitRight,
  onSplitDown,
}: {
  bookmarked: boolean;
  onBookmarkChange: (value: boolean) => void;
  onCopyScreenshot: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
}) {
  return (
    <>
      <DropdownMenu.Item className={graphMenuItem} onSelect={onSplitRight}>
        <PanelRightOpen className="size-4 text-muted-foreground" /> Split right
      </DropdownMenu.Item>
      <DropdownMenu.Item className={graphMenuItem} onSelect={onSplitDown}>
        <PanelBottomOpen className="size-4 text-muted-foreground" /> Split down
      </DropdownMenu.Item>
      <DropdownMenu.Item className={graphMenuItem} onSelect={onCopyScreenshot}>
        <Camera className="size-4 text-muted-foreground" /> Copy screenshot
      </DropdownMenu.Item>
      <DropdownMenu.Item className={graphMenuItem} onSelect={() => onBookmarkChange(!bookmarked)}>
        <Bookmark className="size-4 text-muted-foreground" /> Bookmark…
      </DropdownMenu.Item>
    </>
  );
}

interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  kind: "file" | "tag" | "attachment" | "missing";
  connected: boolean;
  path?: string;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

interface GraphDrag {
  node: GraphNode;
  pointerId: number;
  x: number;
  y: number;
  at: number;
  vx: number;
  vy: number;
}

const WIDTH = 960;
const HEIGHT = 640;
const TAGS_PATTERN = /(?:^|\n)tags:\s*\[([^\]]+)\]/i;

function tagsFor(content: string) {
  const inlineTags = [...content.matchAll(/(^|\s)#([\w/-]+)/g)].map((match) => match[2]);
  const frontmatterTags =
    content
      .match(TAGS_PATTERN)?.[1]
      ?.split(",")
      .map((tag) => tag.trim()) ?? [];
  return [...new Set([...inlineTags, ...frontmatterTags].filter(Boolean))];
}

function buildGraph(
  documents: DemoDocument[],
  activeTitle: string | undefined,
  showTags: boolean,
  attachments: FileEntry[],
  showAttachments: boolean,
  existingFilesOnly: boolean
) {
  const edges = new Map<string, GraphLink>();
  const connected = new Set<string>(activeTitle ? [activeTitle] : []);
  const nodes = new Map<string, GraphNode>(
    documents.map((document) => [
      document.title,
      { id: document.title, title: document.title, kind: "file", connected: false },
    ])
  );
  const linkIndex = buildLinkIndex(documents);
  const knownTitles = new Set(documents.map((document) => document.title));

  for (const edge of linkIndex.edges) {
    const id = `${edge.source}\n${edge.target}`;
    edges.set(id, { source: edge.source, target: edge.target });
    if (edge.source === activeTitle || edge.target === activeTitle) {
      connected.add(edge.source);
      connected.add(edge.target);
    }
  }

  for (const document of documents) {
    if (showTags) {
      for (const tag of tagsFor(document.content)) {
        const id = `#${tag}`;
        if (!nodes.has(id)) nodes.set(id, { id, title: id, kind: "tag", connected: false });
        edges.set(`${document.title}\n${id}`, { source: document.title, target: id });
      }
    }
    if (!existingFilesOnly) {
      for (const target of linkedTitles(document.content)) {
        const missingTitle = target.slice(target.lastIndexOf("/") + 1);
        if (!missingTitle || knownTitles.has(missingTitle) || nodes.has(missingTitle)) continue;
        nodes.set(missingTitle, {
          id: missingTitle,
          title: missingTitle,
          kind: "missing",
          connected: false,
        });
        edges.set(`${document.title}\n${missingTitle}`, {
          source: document.title,
          target: missingTitle,
        });
      }
    }
  }

  if (showAttachments) {
    for (const entry of attachments) {
      if (entry.kind === "directory" || entry.kind === "markdown") continue;
      const id = `attachment:${entry.path}`;
      nodes.set(id, {
        id,
        title: entry.name,
        kind: "attachment",
        connected: false,
        path: entry.path,
      });
    }
  }

  for (const node of nodes.values()) {
    node.connected = activeTitle ? connected.has(node.id) || node.id === activeTitle : true;
  }

  return { nodes: [...nodes.values()], links: [...edges.values()] };
}

function ForceSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="border-t [border-color:var(--layout-separator)]">
      <summary className="flex h-9 cursor-pointer list-none items-center gap-1 px-2 text-xs font-medium marker:hidden">
        <ChevronDown className="size-3.5 [[open]_&]:rotate-180" />
        {title}
      </summary>
      <div className="space-y-2 px-2 pb-3">{children}</div>
    </details>
  );
}

export function GraphView({
  documents,
  attachments = [],
  activeTitle,
  bookmarked,
  onBookmarkChange,
  onOpenDocument,
  onSplitRight,
  onSplitDown,
}: GraphViewProps) {
  const [query, setQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [existingFilesOnly, setExistingFilesOnly] = useState(true);
  const [showOrphans, setShowOrphans] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showArrows, setShowArrows] = useState(false);
  const [textFadeThreshold, setTextFadeThreshold] = useState(0);
  const [nodeSize, setNodeSize] = useState(1);
  const [linkThickness, setLinkThickness] = useState(1);
  const [groups, setGroups] = useState<Array<{ id: number; query: string; color: string }>>([]);
  const [centerForce, setCenterForce] = useState(0.519);
  const [repelForce, setRepelForce] = useState(10);
  const [linkForce, setLinkForce] = useState(1);
  const [linkDistance, setLinkDistance] = useState(100);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [layoutNodes, setLayoutNodes] = useState<GraphNode[]>([]);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(null);
  const zoomRef = useRef<ReturnType<typeof zoom<SVGSVGElement, unknown>> | null>(null);
  const dragRef = useRef<GraphDrag | null>(null);
  const layoutNodesRef = useRef<GraphNode[]>([]);
  const frameRef = useRef<number | undefined>(undefined);
  const graph = useMemo(
    () =>
      buildGraph(documents, activeTitle, showTags, attachments, showAttachments, existingFilesOnly),
    [activeTitle, attachments, documents, existingFilesOnly, showAttachments, showTags]
  );

  useEffect(() => {
    const previous = new Map(layoutNodesRef.current.map((node) => [node.id, node]));
    const nodes = graph.nodes.map((node) => {
      const old = previous.get(node.id);
      return old ? { ...node, x: old.x, y: old.y, vx: old.vx, vy: old.vy } : { ...node };
    });
    const links = graph.links.map((link) => ({ ...link }));
    const simulation = forceSimulation(nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(links)
          .id((node) => node.id)
          .distance(linkDistance)
          .strength(linkForce * 0.18)
      )
      .force("charge", forceManyBody().strength(-repelForce * 20))
      .force("x", forceX(WIDTH / 2).strength(centerForce * 0.1))
      .force("y", forceY(HEIGHT / 2).strength(centerForce * 0.1))
      .force(
        "collision",
        forceCollide<GraphNode>().radius((node) => (node.kind === "tag" ? 13 : 18))
      )
      .velocityDecay(0.2)
      .alphaDecay(0.025)
      .on("tick", () => {
        if (frameRef.current !== undefined) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = undefined;
          layoutNodesRef.current = nodes;
          setLayoutNodes([...nodes]);
        });
      });

    simulationRef.current = simulation;
    return () => {
      simulation.stop();
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    };
  }, [centerForce, graph, linkDistance, linkForce, repelForce]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.35, 2.8])
      .filter((event) => !dragRef.current && (!event.button || event.type === "wheel"))
      .on("zoom", (event) => setTransform(event.transform));
    zoomRef.current = behavior;
    select(svg).call(behavior);
    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);

  const linkNodeId = (value: string | GraphNode) => (typeof value === "string" ? value : value.id);
  const linkedIds = new Set(
    graph.links.flatMap((link) => [linkNodeId(link.source), linkNodeId(link.target)])
  );
  const visibleNodes = layoutNodes.filter((node) => {
    if (!showOrphans && node.kind === "file" && !linkedIds.has(node.id)) {
      return false;
    }
    return !query || node.title.toLowerCase().includes(query.toLowerCase());
  });
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const nodeById = new Map(layoutNodes.map((node) => [node.id, node]));
  const linkCounts = new Map<string, number>();
  graph.links.forEach((link) => {
    const source = linkNodeId(link.source);
    const target = linkNodeId(link.target);
    linkCounts.set(source, (linkCounts.get(source) ?? 0) + 1);
    linkCounts.set(target, (linkCounts.get(target) ?? 0) + 1);
  });
  const hoveredNeighbors = new Set<string>(hoveredId ? [hoveredId] : []);
  if (hoveredId) {
    graph.links.forEach((link) => {
      const source = typeof link.source === "string" ? link.source : link.source.id;
      const target = typeof link.target === "string" ? link.target : link.target.id;
      if (source === hoveredId) hoveredNeighbors.add(target);
      if (target === hoveredId) hoveredNeighbors.add(source);
    });
  }
  const fitGraph = () => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (!svg || !behavior || !visibleNodes.length) return;
    const xs = visibleNodes.map((node) => node.x ?? WIDTH / 2);
    const ys = visibleNodes.map((node) => node.y ?? HEIGHT / 2);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(120, maxX - minX + 120);
    const height = Math.max(120, maxY - minY + 120);
    const scale = Math.min(2.2, 0.9 / Math.max(width / WIDTH, height / HEIGHT));
    const next = zoomIdentity
      .translate(WIDTH / 2, HEIGHT / 2)
      .scale(scale)
      .translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
    select(svg).transition().duration(280).call(behavior.transform, next);
  };
  const reset = () => {
    setQuery("");
    setShowTags(false);
    setShowAttachments(false);
    setExistingFilesOnly(true);
    setShowOrphans(true);
    setShowLabels(true);
    setShowArrows(false);
    setTextFadeThreshold(0);
    setNodeSize(1);
    setLinkThickness(1);
    setCenterForce(0.519);
    setRepelForce(10);
    setLinkForce(1);
    setLinkDistance(100);
    setGroups([]);
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (svg && behavior) select(svg).call(behavior.transform, zoomIdentity);
    simulationRef.current?.alpha(0.8).restart();
  };
  const changeZoom = (factor: number) => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (svg && behavior) select(svg).transition().duration(160).call(behavior.scaleBy, factor);
  };
  const copyScreenshot = () => {
    const svg = svgRef.current;
    if (!svg || !navigator.clipboard || typeof ClipboardItem === "undefined") return;
    const image = new Image();
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" })
    );
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(url);
        return;
      }
      context.fillStyle = getComputedStyle(svg).backgroundColor || "#111";
      context.fillRect(0, 0, WIDTH, HEIGHT);
      context.drawImage(image, 0, 0, WIDTH, HEIGHT);
      canvas.toBlob((blob) => {
        if (blob) void navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        URL.revokeObjectURL(url);
      }, "image/png");
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  };
  const graphCoordinates = (event: React.PointerEvent<SVGGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const coordinates = point.matrixTransform(matrix.inverse());
    return {
      x: (coordinates.x - transform.x) / transform.k,
      y: (coordinates.y - transform.y) / transform.k,
    };
  };
  const moveNode = (event: React.PointerEvent<SVGGElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const coordinates = graphCoordinates(event);
    if (!coordinates) return;
    const now = event.timeStamp;
    const elapsed = Math.max(8, now - session.at);
    session.vx = ((coordinates.x - session.x) * 16) / elapsed;
    session.vy = ((coordinates.y - session.y) * 16) / elapsed;
    session.x = coordinates.x;
    session.y = coordinates.y;
    session.at = now;
    session.node.fx = coordinates.x;
    session.node.fy = coordinates.y;
    session.node.x = coordinates.x;
    session.node.y = coordinates.y;
    layoutNodesRef.current = [...layoutNodesRef.current];
    setLayoutNodes([...layoutNodesRef.current]);
    simulationRef.current?.alpha(0.45).restart();
  };
  const finishNodeDrag = (event: React.PointerEvent<SVGGElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const node = session.node;
    node.fx = null;
    node.fy = null;
    node.vx = session.vx * 0.85;
    node.vy = session.vy * 0.85;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    simulationRef.current?.alphaTarget(0).alpha(0.75).restart();
  };

  return (
    <FluxEditorPane
      title="Graph view"
      menuLabel="More options"
      menuContent={
        <GraphViewMenu
          bookmarked={bookmarked}
          onBookmarkChange={onBookmarkChange}
          onCopyScreenshot={copyScreenshot}
          onSplitRight={onSplitRight}
          onSplitDown={onSplitDown}
        />
      }
    >
      <section
        className="relative flex h-full min-h-0 flex-col bg-background"
        aria-label="Graph view"
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="min-h-0 flex-1 touch-none"
          role="img"
          aria-label="Knowledge graph"
        >
          <defs>
            <marker
              id="flux-graph-arrow"
              viewBox="0 0 10 10"
              refX="12"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
            </marker>
          </defs>
          <g transform={transform.toString()}>
            {graph.links.map((link, index) => {
              const source =
                typeof link.source === "string" ? nodeById.get(link.source) : link.source;
              const target =
                typeof link.target === "string" ? nodeById.get(link.target) : link.target;
              if (!source || !target || !visibleIds.has(source.id) || !visibleIds.has(target.id))
                return null;
              const highlighted = hoveredId === source.id || hoveredId === target.id;
              return (
                <line
                  key={index}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={highlighted ? "oklch(0.69 0.18 292)" : "var(--layout-separator)"}
                  strokeWidth={(highlighted ? 1.8 : 1.1) * linkThickness}
                  opacity={hoveredId && !highlighted ? 0.18 : 1}
                  markerEnd={showArrows && transform.k > 0.8 ? "url(#flux-graph-arrow)" : undefined}
                />
              );
            })}
            {visibleNodes.map((node) => {
              const active = node.id === activeTitle;
              const hovered = node.id === hoveredId;
              const linkCount = linkCounts.get(node.id) ?? 0;
              const degreeGrowth = Math.min(8, Math.sqrt(linkCount) * 2.25);
              const baseRadius = (node.kind === "tag" ? 5 : 4.5) + degreeGrowth;
              const radius = baseRadius * nodeSize;
              const groupColor = groups.find(
                (group) =>
                  group.query.trim() &&
                  node.title.toLocaleLowerCase().includes(group.query.trim().toLocaleLowerCase())
              )?.color;
              const labelsVisible = showLabels && transform.k >= 0.35 + textFadeThreshold * 1.4;
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}
                  className="cursor-grab active:cursor-grabbing"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const coordinates = graphCoordinates(event);
                    if (!coordinates) return;
                    dragRef.current = {
                      node,
                      pointerId: event.pointerId,
                      x: coordinates.x,
                      y: coordinates.y,
                      at: event.timeStamp,
                      vx: 0,
                      vy: 0,
                    };
                    node.fx = node.x;
                    node.fy = node.y;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    simulationRef.current?.alphaTarget(0.32).restart();
                  }}
                  onPointerMove={moveNode}
                  onPointerUp={finishNodeDrag}
                  onPointerCancel={finishNodeDrag}
                  onPointerEnter={() => setHoveredId(node.id)}
                  onPointerLeave={() => setHoveredId(null)}
                  onDoubleClick={() => {
                    if (node.kind === "file") onOpenDocument(node.id);
                    if (node.kind === "attachment" && node.path) onOpenDocument(node.path);
                  }}
                >
                  <circle r={radius + 8} fill="transparent" />
                  <circle
                    r={radius}
                    fill={
                      active || hovered
                        ? "oklch(0.69 0.18 292)"
                        : groupColor
                          ? groupColor
                          : node.kind === "tag"
                            ? "var(--muted-foreground)"
                            : node.kind === "missing"
                              ? "transparent"
                              : "var(--accent-foreground)"
                    }
                    stroke={node.kind === "missing" ? "var(--muted-foreground)" : "none"}
                    strokeDasharray={node.kind === "missing" ? "2 2" : undefined}
                    opacity={
                      hoveredId && !hoveredNeighbors.has(node.id)
                        ? 0.18
                        : node.connected || active
                          ? 1
                          : 0.55
                    }
                  />
                  {labelsVisible ? (
                    <text
                      x={radius + 7}
                      y="4"
                      className="fill-foreground text-[12px]"
                      opacity={
                        hoveredId && !hoveredNeighbors.has(node.id)
                          ? 0.12
                          : hoveredId === node.id
                            ? 1
                            : node.connected || active
                              ? 0.82
                              : 0.55
                      }
                    >
                      {node.title}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
        <div
          className={`absolute top-2 z-20 flex flex-col gap-0.5 text-muted-foreground ${showSettings ? "right-[15.5rem]" : "right-2"}`}
        >
          <button
            type="button"
            aria-label="Open graph settings"
            title="Open graph settings"
            className="grid size-7 place-items-center rounded-md hover:bg-accent hover:text-foreground"
            onClick={() => setShowSettings((open) => !open)}
          >
            <Settings className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Start time-lapse animation"
            title="Start time-lapse animation"
            className="grid size-7 place-items-center rounded-md hover:bg-accent hover:text-foreground"
            onClick={() => simulationRef.current?.alpha(1).restart()}
          >
            <WandSparkles className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Zoom graph in"
            title="Zoom in"
            className="grid size-7 place-items-center rounded-md hover:bg-accent hover:text-foreground"
            onClick={() => changeZoom(1.25)}
          >
            <ZoomIn className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Zoom graph out"
            title="Zoom out"
            className="grid size-7 place-items-center rounded-md hover:bg-accent hover:text-foreground"
            onClick={() => changeZoom(0.8)}
          >
            <ZoomOut className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Fit graph to view"
            title="Fit to view"
            className="grid size-7 place-items-center rounded-md hover:bg-accent hover:text-foreground"
            onClick={fitGraph}
          >
            <Maximize2 className="size-3.5" />
          </button>
        </div>
        {showSettings ? (
          <aside className="absolute bottom-2 right-2 top-2 z-30 w-60 overflow-y-auto rounded-lg border bg-popover text-popover-foreground shadow-lg [border-color:var(--layout-separator)]">
            <div className="flex h-9 items-center gap-1 border-b px-2 text-xs font-medium [border-color:var(--layout-separator)]">
              <span className="flex-1">Graph settings</span>
              <button type="button" aria-label="Restore default graph settings" onClick={reset}>
                <RotateCcw className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Close graph settings"
                onClick={() => setShowSettings(false)}
              >
                <X className="size-3.5" />
              </button>
            </div>
            <label className="mx-2 my-2 flex h-7 items-center gap-1 rounded-md border px-2 text-muted-foreground [border-color:var(--layout-separator)]">
              <Search className="size-3.5" />
              <input
                aria-label="Search graph"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search files"
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
              {query ? (
                <button type="button" aria-label="Clear graph search" onClick={() => setQuery("")}>
                  <X className="size-3.5" />
                </button>
              ) : null}
            </label>
            <ForceSection title="Filters" defaultOpen>
              <label className="flex items-center justify-between gap-2 text-xs">
                Tags{" "}
                <input
                  type="checkbox"
                  checked={showTags}
                  onChange={(event) => setShowTags(event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs">
                Attachments{" "}
                <input
                  type="checkbox"
                  checked={showAttachments}
                  onChange={(event) => setShowAttachments(event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs">
                Existing files only{" "}
                <input
                  type="checkbox"
                  checked={existingFilesOnly}
                  onChange={(event) => setExistingFilesOnly(event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs">
                Orphans{" "}
                <input
                  type="checkbox"
                  checked={showOrphans}
                  onChange={(event) => setShowOrphans(event.target.checked)}
                />
              </label>
            </ForceSection>
            <ForceSection title="Groups">
              {groups.map((group) => (
                <div key={group.id} className="flex items-center gap-1">
                  <input
                    type="color"
                    aria-label="Group color"
                    value={group.color}
                    onChange={(event) =>
                      setGroups((current) =>
                        current.map((candidate) =>
                          candidate.id === group.id
                            ? { ...candidate, color: event.target.value }
                            : candidate
                        )
                      )
                    }
                    className="size-6 rounded border-0 bg-transparent p-0"
                  />
                  <input
                    aria-label="Group query"
                    value={group.query}
                    onChange={(event) =>
                      setGroups((current) =>
                        current.map((candidate) =>
                          candidate.id === group.id
                            ? { ...candidate, query: event.target.value }
                            : candidate
                        )
                      )
                    }
                    placeholder="Search query"
                    className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none [border-color:var(--layout-separator)]"
                  />
                  <button
                    type="button"
                    aria-label="Remove group"
                    onClick={() =>
                      setGroups((current) =>
                        current.filter((candidate) => candidate.id !== group.id)
                      )
                    }
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="flex h-7 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setGroups((current) => [
                    ...current,
                    { id: Date.now(), query: "", color: "#8b5cf6" },
                  ])
                }
              >
                <Plus className="size-3.5" /> New group
              </button>
            </ForceSection>
            <ForceSection title="Display">
              <label className="flex items-center justify-between gap-2 text-xs">
                Show labels{" "}
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(event) => setShowLabels(event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs">
                Arrows{" "}
                <input
                  type="checkbox"
                  checked={showArrows}
                  onChange={(event) => setShowArrows(event.target.checked)}
                />
              </label>
              <label className="block text-xs">
                Text fade threshold
                <input
                  aria-label="Text fade threshold"
                  className="mt-1 w-full"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={textFadeThreshold}
                  onChange={(event) => setTextFadeThreshold(Number(event.target.value))}
                />
              </label>
              <label className="block text-xs">
                Node size
                <input
                  aria-label="Node size"
                  className="mt-1 w-full"
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.05"
                  value={nodeSize}
                  onChange={(event) => setNodeSize(Number(event.target.value))}
                />
              </label>
              <label className="block text-xs">
                Link thickness
                <input
                  aria-label="Link thickness"
                  className="mt-1 w-full"
                  type="range"
                  min="0.4"
                  max="3"
                  step="0.05"
                  value={linkThickness}
                  onChange={(event) => setLinkThickness(Number(event.target.value))}
                />
              </label>
              <button
                type="button"
                className="flex h-7 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => simulationRef.current?.alpha(1).restart()}
              >
                <WandSparkles className="size-3.5" /> Animate
              </button>
            </ForceSection>
            <ForceSection title="Forces">
              <label className="block text-xs">
                Centre force
                <input
                  aria-label="Centre force"
                  className="mt-1 w-full"
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={centerForce}
                  onChange={(event) => setCenterForce(Number(event.target.value))}
                />
              </label>
              <label className="block text-xs">
                Repel force
                <input
                  aria-label="Repel force"
                  className="mt-1 w-full"
                  type="range"
                  min="0"
                  max="20"
                  step="0.1"
                  value={repelForce}
                  onChange={(event) => setRepelForce(Number(event.target.value))}
                />
              </label>
              <label className="block text-xs">
                Link force
                <input
                  aria-label="Link force"
                  className="mt-1 w-full"
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={linkForce}
                  onChange={(event) => setLinkForce(Number(event.target.value))}
                />
              </label>
              <label className="block text-xs">
                Link distance
                <input
                  aria-label="Link distance"
                  className="mt-1 w-full"
                  type="range"
                  min="30"
                  max="500"
                  value={linkDistance}
                  onChange={(event) => setLinkDistance(Number(event.target.value))}
                />
              </label>
            </ForceSection>
          </aside>
        ) : null}
      </section>
    </FluxEditorPane>
  );
}
