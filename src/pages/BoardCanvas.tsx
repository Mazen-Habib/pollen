import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import { ArrowLeft, Bot, Link2, Radar as RadarIcon, StickyNote, Upload, UserRound } from "lucide-react";
import { api, jobEvents, type Board, type BoardEdge, type BoardNode, type NodeType, type Reel } from "../api.ts";
import { BoardContext, nodeTypes, type BoardActions } from "../components/nodes.tsx";
import { ChatPanel } from "../components/ChatPanel.tsx";
import { ErrorBox, Modal, Spinner } from "../components/ui.tsx";
import { ManualReelForm, ReelDetail } from "../components/reels.tsx";

type BoardPayload = { board: Board; nodes: BoardNode[]; edges: BoardEdge[] };

const toFlowEdge = (e: BoardEdge): Edge => ({ id: e.id, source: e.source, target: e.target, animated: true });

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
  const wrapper = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const toFlowNode = (n: BoardNode): Node => ({
    id: n.id,
    type: n.type,
    position: { x: n.x, y: n.y },
    data: { node: n },
  });

  const load = useCallback(async () => {
    try {
      const data = await api<BoardPayload>(`/boards/${boardId}`);
      setBoard(data.board);
      setNodes(data.nodes.map(toFlowNode));
      setEdges(data.edges.map(toFlowEdge));
    } catch (e) {
      setError(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  useEffect(() => {
    load();
  }, [load]);

  // Background analysis finished (possibly after the dialog was closed): refresh node states.
  useEffect(() => {
    jobEvents.addEventListener("finished", load);
    return () => jobEvents.removeEventListener("finished", load);
  }, [load]);

  // Chat nodes show how many sources feed them.
  const counts = useMemo(() => connectionCounts(edges), [edges]);
  const displayNodes = useMemo(
    () => nodes.map((n) => (n.type === "chat" ? { ...n, data: { ...n.data, connections: counts.get(n.id) ?? 0 } } : n)),
    [nodes, counts],
  );

  const center = () => {
    const rect = wrapper.current?.getBoundingClientRect();
    const pos = screenToFlowPosition({
      x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 - 140,
      y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 - 80,
    });
    return { x: pos.x + Math.random() * 40, y: pos.y + Math.random() * 40 };
  };

  const addNode = async (type: NodeType, data: Record<string, unknown> = {}) => {
    setError(null);
    try {
      const node = await api<BoardNode>(`/boards/${boardId}/nodes`, { body: { type, ...center(), data } });
      setNodes((ns) => [...ns, toFlowNode(node)]);
      if (type === "chat") setChatId(node.id);
      return node;
    } catch (e) {
      setError(e);
    }
  };

  const actions: BoardActions = {
    update: async (id, data) => {
      const node = await api<BoardNode>(`/nodes/${id}`, { method: "PATCH", body: { data } });
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { node } } : n)));
      setContextKey((k) => k + 1);
    },
    remove: async (id) => {
      await api(`/nodes/${id}`, { method: "DELETE" });
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      if (chatId === id) setChatId(null);
      setContextKey((k) => k + 1);
    },
    openChat: setChatId,
    openReel: setReelId,
    reload: load,
  };

  const onConnect = async (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const edge = await api<BoardEdge>(`/boards/${boardId}/edges`, { body: { source: c.source, target: c.target } });
    setEdges((es) => (es.some((e) => e.id === edge.id) ? es : [...es, toFlowEdge(edge)]));
    setContextKey((k) => k + 1);
  };

  const uploadFile = async (file: File) => {
    setBusy(file.type.startsWith("audio") || file.type.startsWith("video") ? "Transcribing…" : "Reading file…");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { x, y } = center();
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

  const tools: { icon: typeof Bot; label: string; run: () => void }[] = [
    { icon: Bot, label: "AI chat", run: () => addNode("chat", { title: "AI chat" }) },
    { icon: Link2, label: "Reel / link", run: () => setLinkOpen(true) },
    { icon: UserRound, label: "Creator", run: () => setCreatorOpen(true) },
    { icon: RadarIcon, label: "Radar", run: () => addNode("radar", { days: 14, limit: 8 }) },
    { icon: StickyNote, label: "Note", run: () => addNode("note", { title: "", text: "" }) },
    { icon: Upload, label: "File", run: () => fileInput.current?.click() },
  ];

  return (
    <BoardContext.Provider value={actions}>
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
            }}
          />
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={(_, node) => {
              api(`/nodes/${node.id}`, { method: "PATCH", body: { x: node.position.x, y: node.position.y } });
            }}
            onNodesDelete={(deleted) => deleted.forEach((n) => actions.remove(n.id))}
            onEdgesDelete={(deleted) => {
              deleted.forEach((e) => api(`/edges/${e.id}`, { method: "DELETE" }));
              setContextKey((k) => k + 1);
            }}
            onNodeDoubleClick={(_, n) => n.type === "chat" && setChatId(n.id)}
            colorMode="dark"
            fitView
            fitViewOptions={{ maxZoom: 1 }}
            minZoom={0.2}
            deleteKeyCode={["Delete", "Backspace"]}
          >
            <Background gap={24} />
            <Controls />
            <MiniMap pannable zoomable className="!bg-zinc-900" />
            <Panel position="top-left">
              <div className="flex items-center gap-2">
                <a href="#/boards" className="btn-ghost">
                  <ArrowLeft className="h-4 w-4" />
                </a>
                <input
                  className="rounded-lg bg-zinc-900/90 px-3 py-1.5 text-sm font-semibold text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  value={board?.name ?? ""}
                  onChange={(e) => setBoard((b) => (b ? { ...b, name: e.target.value } : b))}
                  onBlur={(e) => api(`/boards/${boardId}`, { method: "PATCH", body: { name: e.target.value } })}
                />
              </div>
            </Panel>
            <Panel position="top-center">
              <div className="flex gap-1 rounded-xl border border-zinc-800 bg-zinc-900/95 p-1 shadow-xl">
                {tools.map(({ icon: Icon, label, run }) => (
                  <button
                    key={label}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white"
                    onClick={run}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
            </Panel>
            {(busy || error) ? (
              <Panel position="bottom-center">
                <div className="max-w-xl">
                  {busy && (
                    <div className="card flex items-center gap-2 px-4 py-2 text-sm">
                      <Spinner /> {busy}
                    </div>
                  )}
                  {error ? (
                    <div className="max-h-[50vh] overflow-y-auto rounded-xl bg-zinc-900">
                      <ErrorBox error={error} onDismiss={() => setError(null)} onManual={() => setManualUrl("")} />
                    </div>
                  ) : null}
                </div>
              </Panel>
            ) : null}
          </ReactFlow>
        </div>

        {chatId && (
          <div className="w-[440px] shrink-0 border-l border-zinc-800">
            <ChatPanel
              key={chatId}
              chatId={chatId}
              scope="board"
              contextKey={contextKey}
              title={(nodes.find((n) => n.id === chatId)?.data as { node: BoardNode } | undefined)?.node.data.title || "AI chat"}
              onClose={() => setChatId(null)}
              onReplied={load}
            />
          </div>
        )}
      </div>

      {reelId && <ReelDetail reelId={reelId} onClose={() => setReelId(null)} onChanged={load} />}
      {linkOpen && (
        <AddLinkModal
          boardId={boardId}
          position={center}
          onClose={() => setLinkOpen(false)}
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
        <Modal title="Add a creator" onClose={() => setCreatorOpen(false)}>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const username = new FormData(e.currentTarget).get("username");
              setCreatorOpen(false);
              await addNode("creator", { username });
            }}
          >
            <p className="text-sm text-zinc-400">
              Shows their latest Reels and outliers, and adds them to your Trend Radar watchlist.
            </p>
            <input name="username" className="input" placeholder="@username" autoFocus />
            <div className="flex justify-end">
              <button className="btn-primary">Add</button>
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
  position: () => { x: number; y: number };
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
        <p className="text-sm text-zinc-400">
          An Instagram Reel (pulls live stats), an Instagram profile (adds the creator), or any web page (article, landing
          page, blog post).
        </p>
        <input
          className="input"
          autoFocus
          placeholder="https://www.instagram.com/reel/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {isReel && (
          <div>
            <label className="label">Creator @ (optional; needed if you only use Meta)</label>
            <input className="input" placeholder="@creator" value={owner} onChange={(e) => setOwner(e.target.value)} />
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
