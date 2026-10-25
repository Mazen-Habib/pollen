import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type Node,
} from "@xyflow/react";
import {
  ArrowLeft,
  Bot,
  Film,
  Link2,
  MessageSquare,
  Plus,
  Radar as RadarIcon,
  Scissors,
  StickyNote,
  Trash2,
  Unlink,
  Upload,
  UserRound,
} from "lucide-react";
import { api, jobEvents, type Board, type BoardEdge, type BoardNode, type NodeType, type Reel } from "../api.ts";
import { BoardContext, KINDS, nodeTitle, nodeTypes, type BoardActions } from "../components/nodes.tsx";
import { EdgeUI, edgeTypes } from "../components/edges.tsx";
import { ChatPanel } from "../components/ChatPanel.tsx";
import { ConfirmDialog, ContextMenu, ErrorBox, Modal, Spinner, type MenuItem } from "../components/ui.tsx";
import { ManualReelForm, ReelDetail } from "../components/reels.tsx";

type BoardPayload = { board: Board; nodes: BoardNode[]; edges: BoardEdge[] };
type XY = { x: number; y: number };

const toFlowEdge = (e: BoardEdge): Edge => ({ id: e.id, source: e.source, target: e.target, type: "cut" });
const toFlowNode = (n: BoardNode): Node => ({ id: n.id, type: n.type, position: { x: n.x, y: n.y }, data: { node: n } });
const boardNode = (n: Node | undefined) => (n?.data as { node: BoardNode } | undefined)?.node;

function connectionCounts(edges: Edge[]) {
  const counts = new Map<string, number>();
  for (const e of edges) {
    counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
    counts.set(e.target, (counts.get(e.target) ?? 0) + 1);
  }
  return counts;
}

function Canvas({ boardId }: { boardId: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [reelId, setReelId] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [contextKey, setContextKey] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; resolve: (ok: boolean) => void } | null>(
    null,
  );
  const [hoveredEdge, setHoveredEdgeNow] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPos = useRef<XY | null>(null); // where a right-click "Add…" should place the new card
  const wrapper = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const contextChanged = () => setContextKey((k) => k + 1);

  const load = useCallback(async () => {
    try {
      const data = await api<BoardPayload>(`/boards/${boardId}`);
      setBoard(data.board);
      setNodes(data.nodes.map(toFlowNode));
      setEdges(data.edges.map(toFlowEdge));
    } catch (e) {
      setError(e);
    }
  }, [boardId, setNodes, setEdges]);

  useEffect(() => {
    load();
  }, [load]);

  // Background analysis finished (possibly after the dialog was closed): refresh node states.
  useEffect(() => {
    jobEvents.addEventListener("finished", load);
    return () => jobEvents.removeEventListener("finished", load);
  }, [load]);

  const counts = useMemo(() => connectionCounts(edges), [edges]);
  const displayNodes = useMemo(
    () => nodes.map((n) => (n.type === "chat" ? { ...n, data: { ...n.data, connections: counts.get(n.id) ?? 0 } } : n)),
    [nodes, counts],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, boardNode(n)!])), [nodes]);

  /** Where new cards go: the right-click spot if there is one, else the middle of the view. */
  const placement = (): XY => {
    if (pendingPos.current) {
      const pos = pendingPos.current;
      pendingPos.current = null;
      return pos;
    }
    const rect = wrapper.current?.getBoundingClientRect();
    const pos = screenToFlowPosition({
      x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 - 140,
      y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 - 80,
    });
    return { x: pos.x + Math.random() * 40, y: pos.y + Math.random() * 40 };
  };

  const askConfirm = (title: string, message: string, label: string) =>
    new Promise<boolean>((resolve) => setConfirm({ title, message, label, resolve }));

  /* ------------------------------------------------------------ connections */

  const connect = async (a: string, b: string) => {
    if (!a || !b || a === b) return;
    if (edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a))) return;
    // Keep chats on the receiving end so lines read left → right into the chat.
    const [source, target] = byId.get(a)?.type === "chat" && byId.get(b)?.type !== "chat" ? [b, a] : [a, b];
    try {
      const edge = await api<BoardEdge>(`/boards/${boardId}/edges`, { body: { source, target } });
      setEdges((es) => (es.some((e) => e.id === edge.id) ? es : [...es, toFlowEdge(edge)]));
      contextChanged();
    } catch (e) {
      setError(e);
    }
  };

  const cut = (edgeId: string) => {
    setEdges((es) => es.filter((e) => e.id !== edgeId));
    setHoveredEdgeNow(null);
    api(`/edges/${edgeId}`, { method: "DELETE" }).catch(setError);
    contextChanged();
  };

  const disconnect = (a: string, b: string) => {
    const edge = edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
    if (edge) cut(edge.id);
  };

  const disconnectAll = (id: string) => edges.filter((e) => e.source === id || e.target === id).forEach((e) => cut(e.id));

  // Leaving a line starts a short grace period so the pointer can reach its scissors button.
  const setHoveredEdge = (id: string | null) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (id) setHoveredEdgeNow(id);
    else hoverTimer.current = setTimeout(() => setHoveredEdgeNow(null), 160);
  };

  /** Dropping a connection anywhere on a card (not just its dot) connects to that card. */
  const onConnectEnd = (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid || !state.fromNode) return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    const el = document.elementFromPoint(point.clientX, point.clientY)?.closest(".react-flow__node");
    const targetId = el?.getAttribute("data-id");
    if (targetId) connect(state.fromNode.id, targetId);
  };

  /* ------------------------------------------------------------------ nodes */

  const addNode = async (type: NodeType, data: Record<string, unknown> = {}, at?: XY) => {
    setError(null);
    try {
      const node = await api<BoardNode>(`/boards/${boardId}/nodes`, { body: { type, ...(at ?? placement()), data } });
      setNodes((ns) => [...ns, toFlowNode(node)]);
      if (type === "chat") setChatId(node.id);
      return node;
    } catch (e) {
      setError(e);
    }
  };

  const deleteNow = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    if (chatId === id) setChatId(null);
    api(`/nodes/${id}`, { method: "DELETE" }).catch(setError);
    contextChanged();
  };

  /** A chat with messages is the only card whose deletion loses something you can't get back. */
  const confirmDeleting = async (ids: string[]) => {
    const chats = ids.map((id) => byId.get(id)).filter((n) => n?.type === "chat" && n.live?.lastReply);
    if (!chats.length) return true;
    return askConfirm(
      chats.length > 1 ? "Delete these chats?" : `Delete “${nodeTitle(chats[0]!)}”?`,
      "The conversation will be deleted too. This can't be undone.",
      "Delete chat",
    );
  };

  const actions: BoardActions = {
    update: async (id, data) => {
      const node = await api<BoardNode>(`/nodes/${id}`, { method: "PATCH", body: { data } });
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { node } } : n)));
      contextChanged();
    },
    remove: async (id) => {
      if (await confirmDeleting([id])) deleteNow(id);
    },
    openChat: setChatId,
    openReel: setReelId,
    reload: load,
  };

  const uploadFile = async (file: File) => {
    setBusy(file.type.startsWith("audio") || file.type.startsWith("video") ? "Transcribing…" : "Reading file…");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { x, y } = placement();
      form.append("x", String(x));
      form.append("y", String(y));
      const node = await api<BoardNode>(`/boards/${boardId}/nodes/file`, { form });
      setNodes((ns) => [...ns, toFlowNode(node)]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  };

  /* ---------------------------------------------------------- right-click */

  const kindIcon = (type: NodeType) => {
    const { Icon } = KINDS[type];
    return <Icon className="h-4 w-4" />;
  };

  const nodeMenu = (event: ReactMouseEvent, flowNode: Node) => {
    event.preventDefault();
    const n = byId.get(flowNode.id);
    if (!n) return;
    const linked = new Set(
      edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => (e.source === n.id ? e.target : e.source)),
    );
    const toggle = (otherId: string) => () => (linked.has(otherId) ? disconnect(n.id, otherId) : connect(otherId, n.id));
    const items: MenuItem[] = [{ kind: "heading", label: nodeTitle(n) }];

    if (n.type === "chat") items.push({ label: "Open chat", icon: <MessageSquare className="h-4 w-4" />, onSelect: () => setChatId(n.id) });
    if (n.type === "reel" && n.live) items.push({ label: "Open Reel details", icon: <Film className="h-4 w-4" />, onSelect: () => setReelId(n.live.id) });

    if (n.type === "chat") {
      const others = nodes.map((o) => byId.get(o.id)!).filter((o) => o.id !== n.id);
      items.push({ kind: "separator" }, { kind: "heading", label: others.length ? "Cards this chat reads" : "No other cards yet" });
      for (const o of others) items.push({ label: nodeTitle(o), icon: kindIcon(o.type), checked: linked.has(o.id), onSelect: toggle(o.id) });
    } else {
      const chats = nodes.map((o) => byId.get(o.id)!).filter((o) => o.type === "chat");
      items.push({ kind: "separator" }, { kind: "heading", label: "Send to chat" });
      for (const c of chats) items.push({ label: nodeTitle(c), icon: kindIcon("chat"), checked: linked.has(c.id), onSelect: toggle(c.id) });
      items.push({
        label: "New AI chat with this card",
        icon: <Plus className="h-4 w-4" />,
        onSelect: async () => {
          const chat = await addNode("chat", { title: "AI chat" }, { x: flowNode.position.x + 360, y: flowNode.position.y });
          if (chat) connect(n.id, chat.id);
        },
      });
    }

    if (linked.size) {
      items.push(
        { kind: "separator" },
        { label: `Disconnect all (${linked.size})`, icon: <Unlink className="h-4 w-4" />, danger: true, onSelect: () => disconnectAll(n.id) },
      );
    }
    items.push(
      { kind: "separator" },
      { label: "Delete", icon: <Trash2 className="h-4 w-4" />, danger: true, hint: "Del", onSelect: () => actions.remove(n.id) },
    );
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  const edgeMenu = (event: ReactMouseEvent, edge: Edge) => {
    event.preventDefault();
    const [a, b] = [byId.get(edge.source), byId.get(edge.target)];
    const chat = [a, b].find((n) => n?.type === "chat");
    const items: MenuItem[] = [{ kind: "heading", label: `${a ? nodeTitle(a) : "Card"} → ${b ? nodeTitle(b) : "Card"}` }];
    if (chat) items.push({ label: "Open chat", icon: <MessageSquare className="h-4 w-4" />, onSelect: () => setChatId(chat.id) });
    items.push({ label: "Disconnect", icon: <Scissors className="h-4 w-4" />, danger: true, hint: "Del", onSelect: () => cut(edge.id) });
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  const paneMenu = (event: ReactMouseEvent | MouseEvent) => {
    event.preventDefault();
    const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const later = (open: () => void) => () => {
      pendingPos.current = at;
      open();
    };
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { kind: "heading", label: "Add here" },
        { label: "AI chat", icon: kindIcon("chat"), onSelect: () => addNode("chat", { title: "AI chat" }, at) },
        { label: "Reel or link…", icon: <Link2 className="h-4 w-4" />, onSelect: later(() => setLinkOpen(true)) },
        { label: "Creator…", icon: kindIcon("creator"), onSelect: later(() => setCreatorOpen(true)) },
        { label: "Trend Radar", icon: kindIcon("radar"), onSelect: () => addNode("radar", { days: 14, limit: 8 }, at) },
        { label: "Note", icon: kindIcon("note"), onSelect: () => addNode("note", { title: "", text: "" }, at) },
        { label: "File…", icon: <Upload className="h-4 w-4" />, onSelect: later(() => fileInput.current?.click()) },
      ],
    });
  };

  const tools: { icon: typeof Bot; label: string; run: () => void }[] = [
    { icon: Bot, label: "AI chat", run: () => addNode("chat", { title: "AI chat" }) },
    { icon: Link2, label: "Reel or link", run: () => setLinkOpen(true) },
    { icon: UserRound, label: "Creator", run: () => setCreatorOpen(true) },
    { icon: RadarIcon, label: "Radar", run: () => addNode("radar", { days: 14, limit: 8 }) },
    { icon: StickyNote, label: "Note", run: () => addNode("note", { title: "", text: "" }) },
    { icon: Upload, label: "File", run: () => fileInput.current?.click() },
  ];

  const chatNode = chatId ? byId.get(chatId) : undefined;

  return (
    <BoardContext.Provider value={actions}>
      <EdgeUI.Provider value={{ hovered: hoveredEdge, setHovered: setHoveredEdge, cut }}>
        <div className="flex h-full">
          <div ref={wrapper} className="relative min-w-0 flex-1">
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".pdf,.txt,.md,.csv,.json,.srt,.vtt,audio/*,video/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) uploadFile(f);
                else pendingPos.current = null;
              }}
            />
            <ReactFlow
              nodes={displayNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              defaultEdgeOptions={{ type: "cut" }}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={(c: Connection) => connect(c.source, c.target)}
              onConnectEnd={onConnectEnd}
              connectionRadius={36}
              onNodeDragStop={(_, node) => {
                api(`/nodes/${node.id}`, { method: "PATCH", body: { x: node.position.x, y: node.position.y } });
              }}
              onBeforeDelete={async ({ nodes: doomed, edges: doomedEdges }) =>
                (await confirmDeleting(doomed.map((n) => n.id))) && { nodes: doomed, edges: doomedEdges }
              }
              onNodesDelete={(deleted) => deleted.forEach((n) => deleteNow(n.id))}
              onEdgesDelete={(deleted) => deleted.forEach((e) => cut(e.id))}
              onEdgeMouseEnter={(_, e) => setHoveredEdge(e.id)}
              onEdgeMouseLeave={() => setHoveredEdge(null)}
              onNodeContextMenu={nodeMenu}
              onEdgeContextMenu={edgeMenu}
              onPaneContextMenu={paneMenu}
              onNodeDoubleClick={(_, n) => n.type === "chat" && setChatId(n.id)}
              colorMode="system"
              fitView
              fitViewOptions={{ maxZoom: 1 }}
              minZoom={0.2}
              deleteKeyCode={["Delete", "Backspace"]}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1.25} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
              <Panel position="top-left">
                <div className="flex items-center gap-2">
                  <a href="#/boards" className="icon-btn border border-line bg-surface shadow-float" aria-label="All boards" title="All boards">
                    <ArrowLeft className="h-4 w-4" />
                  </a>
                  <input
                    aria-label="Board name"
                    className="w-56 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-fg shadow-float focus:ring-2 focus:ring-focus focus:outline-none"
                    value={board?.name ?? ""}
                    onChange={(e) => setBoard((b) => (b ? { ...b, name: e.target.value } : b))}
                    onBlur={(e) => api(`/boards/${boardId}`, { method: "PATCH", body: { name: e.target.value } })}
                  />
                </div>
              </Panel>
              <Panel position="top-center">
                <div role="toolbar" aria-label="Add to board" className="flex gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-float">
                  {tools.map(({ icon: Icon, label, run }) => (
                    <button
                      key={label}
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-fg-2 hover:bg-surface-2 hover:text-fg"
                      onClick={run}
                    >
                      <Icon aria-hidden className="h-4 w-4" /> {label}
                    </button>
                  ))}
                </div>
              </Panel>
              <Panel position="bottom-center">
                {busy || error ? (
                  <div className="max-w-xl space-y-2">
                    {busy && (
                      <div className="card flex items-center gap-2 px-4 py-2 text-sm shadow-float">
                        <Spinner /> {busy}
                      </div>
                    )}
                    {error ? (
                      <div className="max-h-[50vh] overflow-y-auto rounded-xl bg-surface shadow-float">
                        <ErrorBox error={error} onDismiss={() => setError(null)} onManual={() => setManualUrl("")} />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-fg-2 shadow-float">
                    Drag a card's dot onto any card to connect · Right-click a card or line for options
                  </p>
                )}
              </Panel>
            </ReactFlow>
          </div>

          {chatId && (
            <div className="w-[440px] shrink-0 border-l border-line">
              <ChatPanel
                key={chatId}
                chatId={chatId}
                scope="board"
                contextKey={contextKey}
                title={chatNode ? nodeTitle(chatNode) : "AI chat"}
                onClose={() => setChatId(null)}
                onReplied={load}
              />
            </div>
          )}
        </div>

        {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
        {confirm && (
          <ConfirmDialog
            title={confirm.title}
            message={confirm.message}
            confirmLabel={confirm.label}
            onCancel={() => {
              confirm.resolve(false);
              setConfirm(null);
            }}
            onConfirm={() => {
              confirm.resolve(true);
              setConfirm(null);
            }}
          />
        )}
        {reelId && <ReelDetail reelId={reelId} onClose={() => setReelId(null)} onChanged={load} />}
        {linkOpen && (
          <AddLinkModal
            boardId={boardId}
            position={placement}
            onClose={() => {
              pendingPos.current = null;
              setLinkOpen(false);
            }}
            onAdded={(node) => {
              setLinkOpen(false);
              setNodes((ns) => [...ns, toFlowNode(node)]);
            }}
            onManual={(url) => {
              setLinkOpen(false);
              setManualUrl(url);
            }}
          />
        )}
        {creatorOpen && (
          <Modal
            title="Add a creator"
            onClose={() => {
              pendingPos.current = null;
              setCreatorOpen(false);
            }}
          >
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const username = new FormData(e.currentTarget).get("username");
                setCreatorOpen(false);
                await addNode("creator", { username });
              }}
            >
              <p className="text-sm text-fg-2">Shows their latest Reels and outliers, and adds them to your Trend Radar watchlist.</p>
              <input name="username" aria-label="Instagram username" className="input" placeholder="@username" autoFocus />
              <div className="flex justify-end">
                <button className="btn-primary">Add creator</button>
              </div>
            </form>
          </Modal>
        )}
        {manualUrl !== null && (
          <ManualReelForm
            initialUrl={manualUrl}
            onClose={() => setManualUrl(null)}
            onCreated={async (reel: Reel) => {
              setManualUrl(null);
              setError(null);
              await addNode("reel", { reelId: reel.id });
            }}
          />
        )}
      </EdgeUI.Provider>
    </BoardContext.Provider>
  );
}

function AddLinkModal({
  boardId,
  position,
  onClose,
  onAdded,
  onManual,
}: {
  boardId: string;
  position: () => XY;
  onClose: () => void;
  onAdded: (node: BoardNode) => void;
  onManual: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const isReel = /instagram\.com\/(?:[^/]+\/)?(reels?|p|tv)\//i.test(url);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onAdded(await api<BoardNode>(`/boards/${boardId}/nodes/link`, { body: { url: url.trim(), owner, ...position() } }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add by link" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-fg-2">
          An Instagram Reel (pulls live stats), an Instagram profile (adds the creator), or any web page (article, landing
          page, blog post).
        </p>
        <input
          className="input"
          autoFocus
          aria-label="Link"
          placeholder="https://www.instagram.com/reel/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {isReel && (
          <div>
            <label className="label" htmlFor="reel-owner">
              Creator @ (optional; needed if you only use Meta)
            </label>
            <input id="reel-owner" className="input" placeholder="@creator" value={owner} onChange={(e) => setOwner(e.target.value)} />
          </div>
        )}
        <ErrorBox error={error} onManual={() => onManual(url)} />
        <div className="flex justify-end gap-2">
          {isReel && (
            <button className="btn-ghost" onClick={() => onManual(url)}>
              Enter manually instead
            </button>
          )}
          <button className="btn-primary" disabled={busy || !url.trim()} onClick={submit}>
            {busy && <Spinner />} {busy ? (isReel ? "Fetching live data…" : "Reading page…") : "Add"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function BoardCanvas({ boardId }: { boardId: string }) {
  return (
    <ReactFlowProvider>
      <Canvas key={boardId} boardId={boardId} />
    </ReactFlowProvider>
  );
}
