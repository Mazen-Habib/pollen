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
import { api, fmtNum, timeAgo, type BoardNode, type RadarStatus, type Reel } from "../api.ts";
import { ScoreBadge, Thumb } from "./reels.tsx";
import { Spinner } from "./ui.tsx";

export type BoardActions = {
  update: (id: string, data: Record<string, unknown>) => Promise<void>;
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

type FlowData = { node: BoardNode; connections?: number };

function Shell({
  id,
  icon,
  title,
  accent,
  children,
  width = 270,
  actions,
  target,
}: {
  id: string;
  icon: ReactNode;
  title: ReactNode;
  accent: string;
  children: ReactNode;
  width?: number;
  actions?: ReactNode;
  target?: boolean;
}) {
  const { remove } = useContext(BoardContext);
  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/30" style={{ width }}>
      {target && <Handle type="target" position={Position.Left} />}
      <div className={`flex items-center gap-2 rounded-t-xl border-b border-zinc-800 px-3 py-2 text-xs font-semibold ${accent}`}>
        {icon}
        <div className="min-w-0 flex-1 truncate">{title}</div>
        {actions}
        <button className="nodrag text-zinc-500 hover:text-rose-300" title="Delete" onClick={() => remove(id)}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="p-3">{children}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function NoteNode({ id, data }: NodeProps) {
  const { node } = data as FlowData;
  const { update } = useContext(BoardContext);
  const [title, setTitle] = useState(node.data.title ?? "");
  const [text, setText] = useState(node.data.text ?? "");
  return (
    <Shell id={id} icon={<StickyNote className="h-3.5 w-3.5" />} title="Note" accent="text-yellow-200" width={280}>
      <input
        className="nodrag mb-2 w-full bg-transparent text-sm font-semibold text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title !== node.data.title && update(id, { title })}
      />
      <textarea
        className="nodrag nowheel h-32 w-full resize-y bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
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
    <Shell
      id={id}
      icon={<Bot className="h-3.5 w-3.5" />}
      title={node.data.title || "AI chat"}
      accent="text-amber-300"
      width={300}
      target
    >
      <div className="mb-2 text-xs text-zinc-400">
        {connections ? `${connections} source${connections > 1 ? "s" : ""} connected` : "Drag sources onto me ←"}
      </div>
      {node.live?.lastReply && (
        <p className="mb-3 line-clamp-4 rounded-lg bg-zinc-950/60 p-2 text-xs text-zinc-400">{node.live.lastReply}</p>
      )}
      <button className="nodrag btn-primary w-full justify-center" onClick={() => openChat(id)}>
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
      icon={<Film className="h-3.5 w-3.5" />}
      title={reel ? `Reel · @${reel.owner || "unknown"}` : "Reel"}
      accent="text-pink-300"
      actions={reel && <ScoreBadge reel={reel} />}
    >
      {reel ? (
        <div className="flex gap-3">
          <Thumb reel={reel} className="aspect-[9/14] w-16 shrink-0 rounded-md" />
          <div className="min-w-0 space-y-1 text-xs">
            <div className="font-medium text-zinc-200">
              {fmtNum(reel.views)} views · {fmtNum(reel.likes)} likes
            </div>
            <div className="text-zinc-500">{timeAgo(reel.posted_at)}</div>
            <p className="line-clamp-3 text-zinc-400">{reel.caption}</p>
            {reel.job?.status === "running" ? (
              <button className="nodrag flex items-center gap-1.5 text-zinc-400" onClick={() => openReel(reel.id)}>
                <Spinner className="h-3 w-3" /> {reel.job.kind === "analyze" ? "Analyzing…" : "Transcribing…"}
              </button>
            ) : (
              <button className="nodrag text-amber-300 hover:underline" onClick={() => openReel(reel.id)}>
                {reel.analysis ? "View breakdown" : reel.job?.status === "error" ? "Analysis failed: see why" : "Analyze →"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">This Reel's data was removed.</p>
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
      icon={<UserRound className="h-3.5 w-3.5" />}
      title={`@${node.data.username}`}
      accent="text-violet-300"
      actions={
        <button className="nodrag text-zinc-400 hover:text-zinc-100" title="Refresh live data" onClick={refresh} disabled={busy}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      }
    >
      <div className="mb-2 text-xs text-zinc-400">
        {creator?.followers ? `${fmtNum(creator.followers)} followers · ` : ""}
        {creator?.last_fetched_at ? `updated ${timeAgo(creator.last_fetched_at)}` : "not fetched yet: press ↻"}
      </div>
      {(error || creator?.last_error) && <p className="mb-2 text-xs text-rose-300">{error || creator.last_error}</p>}
      <div className="space-y-1">
        {top.map((r) => (
          <button
            key={r.id}
            className="nodrag flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-zinc-800"
            onClick={() => openReel(r.id)}
          >
            <ScoreBadge reel={r} />
            <span className="text-zinc-300">{fmtNum(r.views ?? r.likes)}</span>
            <span className="truncate text-zinc-500">{r.caption}</span>
          </button>
        ))}
      </div>
    </Shell>
  );
}

export function RadarNode({ id, data }: NodeProps) {
  const { node } = data as FlowData;
  const { update, openReel } = useContext(BoardContext);
  const top = (node.live?.top ?? []) as Reel[];
  return (
    <Shell
      id={id}
      icon={<RadarIcon className="h-3.5 w-3.5" />}
      title="Trend Radar (live)"
      accent="text-emerald-300"
      width={290}
      actions={
        <select
          className="nodrag rounded bg-zinc-800 px-1 py-0.5 text-[11px] text-zinc-300"
          value={node.data.days ?? 14}
          onChange={(e) => update(id, { days: Number(e.target.value) })}
        >
          {[7, 14, 30, 90].map((d) => (
            <option key={d} value={d}>
              {d}d
            </option>
          ))}
        </select>
      }
    >
      {top.length ? (
        <div className="space-y-1">
          {top.map((r) => (
            <button
              key={r.id}
              className="nodrag flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-zinc-800"
              onClick={() => openReel(r.id)}
            >
              <ScoreBadge reel={r} />
              <span className="shrink-0 text-zinc-300">@{r.owner}</span>
              <span className="truncate text-zinc-500">{fmtNum(r.views ?? r.likes)}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">No Reels yet. Add creators on the Trend Radar page and refresh.</p>
      )}
      <p className="mt-2 text-[11px] text-zinc-600">Feeds the top outliers into any connected chat, always up to date.</p>
    </Shell>
  );
}

export function UrlNode({ id, data }: NodeProps) {
  const { node } = data as FlowData;
  return (
    <Shell id={id} icon={<Globe className="h-3.5 w-3.5" />} title={node.data.site || "Web page"} accent="text-sky-300">
      <a
        className="nodrag line-clamp-2 text-sm font-medium text-zinc-100 hover:underline"
        href={node.data.url}
        target="_blank"
        rel="noreferrer"
      >
        {node.data.title}
      </a>
      <p className="mt-1 line-clamp-4 text-xs text-zinc-400">{node.data.preview}</p>
      <p className="mt-1 text-[11px] text-zinc-600">~{fmtNum(Math.round((node.data.chars ?? 0) / 4))} tokens</p>
    </Shell>
  );
}

const FILE_ICONS: Record<string, ReactNode> = {
  pdf: <FileText className="h-3.5 w-3.5" />,
  audio: <FileAudio className="h-3.5 w-3.5" />,
  video: <FileVideo className="h-3.5 w-3.5" />,
};

export function FileNode({ id, data }: NodeProps) {
  const { node } = data as FlowData;
  return (
    <Shell
      id={id}
      icon={FILE_ICONS[node.data.kind] ?? <FileIcon className="h-3.5 w-3.5" />}
      title={node.data.filename}
      accent="text-orange-300"
    >
      {node.data.error ? (
        <p className="text-xs text-rose-300">{node.data.error}</p>
      ) : (
        <>
          <div className="mb-1 text-[11px] text-zinc-500 uppercase">
            {node.data.kind === "audio" || node.data.kind === "video" ? "Transcript" : node.data.kind}
          </div>
          <p className="line-clamp-5 text-xs text-zinc-400">{node.data.preview || "(no text found)"}</p>
          <p className="mt-1 text-[11px] text-zinc-600">~{fmtNum(Math.round((node.data.chars ?? 0) / 4))} tokens</p>
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
