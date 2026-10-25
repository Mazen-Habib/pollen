import { createContext, useContext, useState, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Bot,
  FileAudio,
  FileText,
  FileVideo,
  Film,
  Globe,
  Radar as RadarIcon,
  RefreshCw,
  StickyNote,
  Trash2,
  UserRound,
  File as FileIcon,
} from "lucide-react";
import { api, fmtNum, timeAgo, type BoardNode, type NodeType, type RadarStatus, type Reel } from "../api.ts";
import { ScoreBadge, Thumb } from "./reels.tsx";
import { IconButton, Spinner } from "./ui.tsx";

export type BoardActions = {
  update: (id: string, data: Record<string, unknown>) => Promise<void>;
  /** Asks first when deleting would lose something (e.g. a chat's conversation). */
  remove: (id: string) => void;
  openChat: (id: string) => void;
  openReel: (reelId: string) => void;
  reload: () => void;
};

export const BoardContext = createContext<BoardActions>({
  update: async () => {},
  remove: () => {},
  openChat: () => {},
  openReel: () => {},
  reload: () => {},
});

/**
 * Each card type has a name, an icon shape and a tint. The tint only helps scanning;
 * the icon and the title carry the meaning, so nothing depends on color alone.
 */
export const KINDS: Record<NodeType, { label: string; Icon: typeof Bot; tint: string }> = {
  chat: { label: "AI chat", Icon: Bot, tint: "text-indigo-600 dark:text-indigo-300" },
  reel: { label: "Reel", Icon: Film, tint: "text-pink-600 dark:text-pink-300" },
  creator: { label: "Creator", Icon: UserRound, tint: "text-violet-600 dark:text-violet-300" },
  radar: { label: "Trend Radar", Icon: RadarIcon, tint: "text-emerald-600 dark:text-emerald-300" },
  url: { label: "Web page", Icon: Globe, tint: "text-sky-600 dark:text-sky-300" },
  file: { label: "File", Icon: FileIcon, tint: "text-orange-600 dark:text-orange-300" },
  note: { label: "Note", Icon: StickyNote, tint: "text-yellow-700 dark:text-yellow-300" },
};

/** A short human name for a card, used in menus ("Disconnect Note from AI chat"). */
export function nodeTitle(node: BoardNode): string {
  const d = node.data;
  switch (node.type) {
    case "chat":
      return d.title || "AI chat";
    case "note":
      return d.title ? `Note “${d.title}”` : "Note";
    case "reel":
      return node.live?.owner ? `Reel by @${node.live.owner}` : "Reel";
    case "creator":
      return `@${d.username}`;
    case "radar":
      return "Trend Radar";
    case "url":
      return d.title || d.site || "Web page";
    case "file":
      return d.filename || "File";
  }
}

type FlowData = { node: BoardNode; connections?: number };

const HANDLE_HINT = "Drag onto any card to connect";

function Shell({
  id,
  node,
  title,
  icon,
  children,
  width = 272,
  actions,
  target,
}: {
  id: string;
  node: BoardNode;
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  width?: number;
  actions?: ReactNode;
  target?: boolean;
}) {
  const { remove } = useContext(BoardContext);
  const kind = KINDS[node.type];
  return (
    <div className="rounded-xl border border-line bg-surface shadow-float" style={{ width }}>
      {target && <Handle type="target" position={Position.Left} title={HANDLE_HINT} />}
      <div className="flex items-center gap-2 border-b border-line py-1 pr-1 pl-3">
        <span className={`shrink-0 ${kind.tint}`} aria-hidden>
          {icon ?? <kind.Icon className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1 truncate text-xs font-semibold text-fg">{title}</div>
        {actions}
        <IconButton label={`Delete ${kind.label.toLowerCase()}`} tone="danger" className="nodrag" onClick={() => remove(id)}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="p-3">{children}</div>
      <Handle type="source" position={Position.Right} title={HANDLE_HINT} />
    </div>
  );
}

export function NoteNode({ id, data }: NodeProps) {
  const { node } = data as FlowData;
  const { update } = useContext(BoardContext);
  const [title, setTitle] = useState(node.data.title ?? "");
  const [text, setText] = useState(node.data.text ?? "");
  const field = "nodrag w-full rounded-md bg-transparent px-1.5 -mx-1.5 focus:ring-2 focus:ring-focus focus:outline-none";
  return (
    <Shell id={id} node={node} title="Note" width={280}>
      <input
        aria-label="Note title"
        className={`${field} mb-1 py-0.5 text-sm font-semibold text-fg placeholder:text-fg-3`}
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title !== node.data.title && update(id, { title })}
      />
      <textarea
        aria-label="Note text"
        className={`${field} nowheel h-32 resize-y py-1 text-sm text-fg-2 placeholder:text-fg-3`}
        placeholder="Ideas, research, your offer, a competitor's script… anything the AI should know."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== node.data.text && update(id, { text })}
      />
    </Shell>
  );
}

export function ChatNode({ id, data }: NodeProps) {
  const { node, connections = 0 } = data as FlowData;
  const { openChat } = useContext(BoardContext);
  return (
    <Shell id={id} node={node} title={node.data.title || "AI chat"} width={300} target>
      <div className="mb-2 text-xs text-fg-2">
        {connections
          ? `Reading ${connections} connected card${connections > 1 ? "s" : ""}`
          : "Nothing connected yet. Drag a card's dot onto this chat."}
      </div>
      {node.live?.lastReply && (
        <p className="mb-3 line-clamp-4 rounded-lg bg-canvas p-2 text-xs text-fg-2">{node.live.lastReply}</p>
      )}
      <button className="nodrag btn-primary w-full" onClick={() => openChat(id)}>
        Open chat
      </button>
    </Shell>
  );
}

export function ReelNode({ id, data }: NodeProps) {
  const { node } = data as FlowData;
  const { openReel } = useContext(BoardContext);
  const reel = node.live as Reel | null;
  return (
    <Shell
      id={id}
      node={node}
      title={reel ? `@${reel.owner || "unknown"}` : "Reel"}
      actions={reel && <ScoreBadge reel={reel} />}
    >
      {reel ? (
        <div className="flex gap-3">
          <Thumb reel={reel} className="aspect-[9/14] w-16 shrink-0 rounded-md" />
          <div className="min-w-0 space-y-1 text-xs">
            <div className="font-semibold text-fg tabular-nums">
              {fmtNum(reel.views)} views · {fmtNum(reel.likes)} likes
            </div>
            <div className="text-fg-3">{timeAgo(reel.posted_at)}</div>
            <p className="line-clamp-3 text-fg-2">{reel.caption}</p>
            {reel.job?.status === "running" ? (
              <button className="nodrag flex items-center gap-1.5 text-fg-2" onClick={() => openReel(reel.id)}>
                <Spinner className="h-3 w-3" /> {reel.job.kind === "analyze" ? "Analyzing…" : "Transcribing…"}
              </button>
            ) : (
              <button
                className={`nodrag font-medium ${reel.job?.status === "error" && !reel.analysis ? "text-danger underline underline-offset-2" : "link"}`}
                onClick={() => openReel(reel.id)}
              >
                {reel.analysis ? "View breakdown" : reel.job?.status === "error" ? "Analysis failed: see why" : "Analyze"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-fg-3">This Reel's data was removed.</p>
      )}
    </Shell>
  );
}

export function CreatorNode({ id, data }: NodeProps) {
  const { node } = data as FlowData;
  const { openReel, reload } = useContext(BoardContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const creator = node.live?.creator;
  const top = (node.live?.top ?? []) as Reel[];

  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/radar/refresh", { body: { usernames: [node.data.username], tags: [], report: false } });
      let status: RadarStatus;
      do {
        await new Promise((r) => setTimeout(r, 2000));
        status = await api<RadarStatus>("/radar/status");
      } while (status.running);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      id={id}
      node={node}
      title={`@${node.data.username}`}
      actions={
        <IconButton label="Refresh live data" className="nodrag" onClick={refresh} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
        </IconButton>
      }
    >
      <div className="mb-2 text-xs text-fg-2">
        {creator?.followers ? `${fmtNum(creator.followers)} followers · ` : ""}
        {creator?.last_fetched_at ? `Updated ${timeAgo(creator.last_fetched_at)}` : "Not fetched yet. Press Refresh."}
      </div>
      {(error || creator?.last_error) && <p className="mb-2 text-xs text-danger">{error || creator.last_error}</p>}
      <ReelRows reels={top} onOpen={openReel} show="caption" />
    </Shell>
  );
}

function ReelRows({ reels, onOpen, show }: { reels: Reel[]; onOpen: (id: string) => void; show: "caption" | "owner" }) {
  return (
    <div className="-mx-1 space-y-0.5">
      {reels.map((r) => (
        <button
          key={r.id}
          className="nodrag flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs hover:bg-surface-2"
          onClick={() => onOpen(r.id)}
        >
          <ScoreBadge reel={r} />
          {show === "owner" && <span className="shrink-0 font-medium text-fg">@{r.owner}</span>}
          <span className="shrink-0 text-fg-2 tabular-nums">{fmtNum(r.views ?? r.likes)}</span>
          {show === "caption" && <span className="truncate text-fg-3">{r.caption}</span>}
        </button>
      ))}
    </div>
  );
}

export function RadarNode({ id, data }: NodeProps) {
  const { node } = data as FlowData;
  const { update, openReel } = useContext(BoardContext);
  const top = (node.live?.top ?? []) as Reel[];
  return (
    <Shell
      id={id}
      node={node}
      title="Trend Radar"
      width={290}
      actions={
        <select
          aria-label="Time window"
          className="nodrag rounded-md border border-line bg-canvas px-1.5 py-1 text-xs text-fg"
          value={node.data.days ?? 14}
          onChange={(e) => update(id, { days: Number(e.target.value) })}
        >
          {[7, 14, 30, 90].map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      }
    >
      {top.length ? (
        <ReelRows reels={top} onOpen={openReel} show="owner" />
      ) : (
        <p className="text-xs text-fg-2">No Reels yet. Add creators on the Trend Radar page and refresh.</p>
      )}
      <p className="mt-2 text-xs text-fg-3">Feeds the top outliers into any connected chat.</p>
    </Shell>
  );
}

export function UrlNode({ id, data }: NodeProps) {
  const { node } = data as FlowData;
  return (
    <Shell id={id} node={node} title={node.data.site || "Web page"}>
      <a className="nodrag line-clamp-2 text-sm font-medium text-fg hover:underline" href={node.data.url} target="_blank" rel="noreferrer">
        {node.data.title}
      </a>
      <p className="mt-1 line-clamp-4 text-xs text-fg-2">{node.data.preview}</p>
      <p className="mt-1.5 text-xs text-fg-3 tabular-nums">~{fmtNum(Math.round((node.data.chars ?? 0) / 4))} tokens</p>
    </Shell>
  );
}

const FILE_ICONS: Record<string, ReactNode> = {
  pdf: <FileText className="h-4 w-4" />,
  audio: <FileAudio className="h-4 w-4" />,
  video: <FileVideo className="h-4 w-4" />,
};

export function FileNode({ id, data }: NodeProps) {
  const { node } = data as FlowData;
  return (
    <Shell id={id} node={node} title={node.data.filename} icon={FILE_ICONS[node.data.kind]}>
      {node.data.error ? (
        <p className="text-xs text-danger">{node.data.error}</p>
      ) : (
        <>
          <div className="mb-1 text-xs font-medium text-fg-3">
            {node.data.kind === "audio" || node.data.kind === "video" ? "Transcript" : String(node.data.kind).toUpperCase()}
          </div>
          <p className="line-clamp-5 text-xs text-fg-2">{node.data.preview || "No text found."}</p>
          <p className="mt-1.5 text-xs text-fg-3 tabular-nums">~{fmtNum(Math.round((node.data.chars ?? 0) / 4))} tokens</p>
        </>
      )}
    </Shell>
  );
}

export const nodeTypes = {
  note: NoteNode,
  chat: ChatNode,
  reel: ReelNode,
  creator: CreatorNode,
  radar: RadarNode,
  url: UrlNode,
  file: FileNode,
};
