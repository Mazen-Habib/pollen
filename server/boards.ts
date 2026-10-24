import { all, get, run, now, newId, tx, parseJson } from "./db.ts";
import { AppError } from "./errors.ts";
import { estimateTokens } from "./llm.ts";
import { getSettings } from "./settings.ts";
import { queryReels, reelToText, scoreReels, type ReelRow } from "./reels.ts";
import { reelJob } from "./jobs.ts";

export type NodeType = "note" | "chat" | "reel" | "creator" | "radar" | "url" | "file";

export type NodeRow = {
  id: string;
  board_id: string;
  type: NodeType;
  x: number;
  y: number;
  w: number | null;
  h: number | null;
  data: string;
  created_at: number;
  updated_at: number;
};

type EdgeRow = { id: string; board_id: string; source: string; target: string };

export function listBoards() {
  return all(
    `select b.*, (select count(*) from nodes n where n.board_id = b.id) node_count
     from boards b order by updated_at desc`,
  );
}

export function createBoard(name: string, seed = true) {
  const id = newId();
  const t = now();
  tx(() => {
    run("insert into boards (id, name, created_at, updated_at) values (?, ?, ?, ?)", id, name, t, t);
    if (seed) {
      const chat = addNode(id, "chat", 520, 80, { title: "AI chat" }, 420, 260);
      const radar = addNode(id, "radar", 40, 60, { days: 14, limit: 8 });
      addNode(id, "note", 40, 380, {
        title: "How boards work",
        text: "Drop in sources (Reels, creators, links, files, notes), then drag from a source's right handle onto the AI chat. The chat reads everything connected to it.",
      });
      addEdge(id, radar.id, chat.id);
    }
  });
  return get("select * from boards where id = ?", id);
}

export function touchBoard(boardId: string) {
  run("update boards set updated_at = ? where id = ?", now(), boardId);
}

export function addNode(
  boardId: string,
  type: NodeType,
  x: number,
  y: number,
  data: Record<string, unknown>,
  w: number | null = null,
  h: number | null = null,
) {
  const id = newId();
  const t = now();
  run(
    "insert into nodes (id, board_id, type, x, y, w, h, data, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    boardId,
    type,
    x,
    y,
    w,
    h,
    JSON.stringify(data),
    t,
    t,
  );
  touchBoard(boardId);
  return hydrateNode(get<NodeRow>("select * from nodes where id = ?", id)!);
}

export function updateNode(id: string, patch: { x?: number; y?: number; w?: number; h?: number; data?: Record<string, unknown> }) {
  const node = get<NodeRow>("select * from nodes where id = ?", id);
  if (!node) throw new AppError("Node not found.", { status: 404 });
  const data = patch.data ? { ...parseJson<Record<string, unknown>>(node.data, {}), ...patch.data } : undefined;
  run(
    "update nodes set x = ?, y = ?, w = ?, h = ?, data = ?, updated_at = ? where id = ?",
    patch.x ?? node.x,
    patch.y ?? node.y,
    patch.w ?? node.w,
    patch.h ?? node.h,
    data ? JSON.stringify(data) : node.data,
    now(),
    id,
  );
  touchBoard(node.board_id);
  return hydrateNode(get<NodeRow>("select * from nodes where id = ?", id)!);
}

export function deleteNode(id: string) {
  tx(() => {
    run("delete from edges where source = ? or target = ?", id, id);
    run("delete from messages where chat_id = ?", id);
    run("delete from nodes where id = ?", id);
  });
}

export function addEdge(boardId: string, source: string, target: string) {
  const existing = get<EdgeRow>(
    "select * from edges where board_id = ? and ((source = ? and target = ?) or (source = ? and target = ?))",
    boardId,
    source,
    target,
    target,
    source,
  );
  if (existing) return existing;
  const id = newId();
  run("insert into edges (id, board_id, source, target) values (?, ?, ?, ?)", id, boardId, source, target);
  return { id, board_id: boardId, source, target };
}

/** Attach live data (Reel stats, creator profile, radar list) to a node for the canvas. */
export function hydrateNode(node: NodeRow) {
  const data = parseJson<Record<string, any>>(node.data, {});
  let live: unknown = null;
  if (node.type === "reel" && data.reelId) {
    const reel = get<ReelRow>("select * from reels where id = ?", data.reelId);
    live = reel ? { ...scoreReels([reel])[0], job: reelJob(reel.id) } : null;
  } else if (node.type === "creator" && data.username) {
    const creator = get("select * from creators where username = ?", data.username);
    live = { creator, top: queryReels({ owner: data.username, days: 90, limit: 3 }) };
  } else if (node.type === "radar") {
    live = { top: queryReels({ days: data.days ?? 14, limit: data.limit ?? 8 }) };
  } else if (node.type === "chat") {
    const last = get<{ content: string }>(
      "select content from messages where chat_id = ? and role = 'assistant' order by id desc limit 1",
      node.id,
    );
    live = { lastReply: last?.content?.slice(0, 280) ?? null };
  }
  if (node.type === "url" || node.type === "file") {
    // Don't ship full extracted text to the canvas; the chat reads it server-side.
    const text = String(data.text ?? "");
    data.preview = text.slice(0, 400);
    data.chars = text.length;
    delete data.text;
  }
  return { ...node, data, live };
}

export function getBoard(id: string) {
  const board = get("select * from boards where id = ?", id);
  if (!board) throw new AppError("Board not found.", { status: 404 });
  const nodes = all<NodeRow>("select * from nodes where board_id = ? order by created_at", id).map(hydrateNode);
  const edges = all<EdgeRow>("select * from edges where board_id = ?", id);
  return { board, nodes, edges };
}

/* ---------------------------------------------------------- Chat context */

type ContextItem = { label: string; text: string };

function nodeToContext(node: NodeRow): ContextItem | null {
  const data = parseJson<Record<string, any>>(node.data, {});
  switch (node.type) {
    case "note":
      return { label: `Note: ${data.title || "untitled"}`, text: String(data.text ?? "") };
    case "url":
      return data.text
        ? { label: `Web page: ${data.title || data.url}`, text: `URL: ${data.url}\n${data.text}` }
        : null;
    case "file":
      return data.text ? { label: `File: ${data.filename}`, text: String(data.text) } : null;
    case "reel": {
      const reel = get<ReelRow>("select * from reels where id = ?", data.reelId);
      if (!reel) return null;
      const scored = scoreReels([reel])[0];
      const analysis = reel.analysis ? `\nEarlier analysis:\n${reel.analysis}` : "";
      return { label: `Reel by @${reel.owner}`, text: reelToText(scored, 4000) + analysis };
    }
    case "creator": {
      const creator = get<Record<string, any>>("select * from creators where username = ?", data.username);
      const reels = queryReels({ owner: data.username, days: 90, limit: 10 });
      if (!creator && !reels.length) return null;
      const header = `@${data.username}${creator?.followers ? ` · ${creator.followers.toLocaleString()} followers` : ""}${
        creator?.last_fetched_at ? ` · data from ${new Date(creator.last_fetched_at).toLocaleString()}` : " · never refreshed"
      }`;
      return {
        label: `Creator @${data.username} (latest Reels, best first)`,
        text: `${header}\n\n${reels.map((r) => reelToText(r, 500)).join("\n\n") || "(no Reels stored yet: refresh the radar)"}`,
      };
    }
    case "radar": {
      const days = data.days ?? 14;
      const reels = queryReels({ days, limit: data.limit ?? 8 });
      return {
        label: `Trend Radar: top outlier Reels from the last ${days} days`,
        text: reels.map((r) => reelToText(r, 600)).join("\n\n") || "(radar is empty: add creators and refresh)",
      };
    }
    case "chat": {
      const msgs = all<{ role: string; content: string }>(
        "select role, content from messages where chat_id = ? order by id desc limit 4",
        node.id,
      ).reverse();
      return msgs.length
        ? { label: `Another chat: ${data.title || "chat"}`, text: msgs.map((m) => `${m.role}: ${m.content}`).join("\n\n") }
        : null;
    }
  }
  return null;
}

/**
 * Collect everything connected to a chat node and fit it into the token budget.
 * Short sources are kept whole; long ones share what's left equally ("water-filling").
 */
export function buildBoardContext(chatNodeId: string) {
  const budgetChars = getSettings().contextBudget * 4;
  const edges = all<EdgeRow>("select * from edges where source = ? or target = ?", chatNodeId, chatNodeId);
  const ids = edges.map((e) => (e.source === chatNodeId ? e.target : e.source));
  const items = ids
    .map((id) => get<NodeRow>("select * from nodes where id = ?", id))
    .filter((n): n is NodeRow => Boolean(n))
    .map(nodeToContext)
    .filter((i): i is ContextItem => Boolean(i && i.text.trim()));

  const order = items.map((item, index) => ({ item, index })).sort((a, b) => a.item.text.length - b.item.text.length);
  let remaining = budgetChars;
  const fitted: (ContextItem & { truncated: boolean })[] = new Array(items.length);
  order.forEach(({ item, index }, i) => {
    const share = Math.floor(remaining / (order.length - i));
    const text = item.text.length > share ? `${item.text.slice(0, share)}\n[…truncated to fit the AI's limit]` : item.text;
    remaining -= Math.min(item.text.length, share);
    fitted[index] = { ...item, text, truncated: item.text.length > share };
  });

  return {
    sources: fitted.map((f) => ({ label: f.label, truncated: f.truncated, tokens: estimateTokens(f.text) })),
    text: fitted.length
      ? fitted.map((f, i) => `## [${i + 1}] ${f.label}\n${f.text}`).join("\n\n")
      : "(Nothing is connected to this chat yet. Tell the user they can drag connections from sources to the chat.)",
  };
}

export function buildRadarContext(days = 14) {
  const budgetChars = getSettings().contextBudget * 4;
  const reels = queryReels({ days, limit: 15 });
  const per = reels.length ? Math.max(300, Math.floor(budgetChars / reels.length)) : 0;
  return {
    sources: [{ label: `Trend Radar (${reels.length} top Reels, last ${days} days)`, truncated: false, tokens: 0 }],
    text: reels.length
      ? reels.map((r) => reelToText(r, per)).join("\n\n").slice(0, budgetChars)
      : "(Radar is empty: no Reels stored yet.)",
  };
}
