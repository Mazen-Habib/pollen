import { useState } from "react";
import { LayoutGrid, Plus, Trash2 } from "lucide-react";
import { api, navigate, timeAgo, type Board } from "../api.ts";
import { Empty, ErrorBox, Spinner, useAsync } from "../components/ui.tsx";

export function BoardsPage() {
  const boards = useAsync(() => api<Board[]>("/boards"), []);
  const [name, setName] = useState("");

  const create = async () => {
    const board = await api<Board>("/boards", { body: { name: name.trim() || "Untitled board" } });
    navigate(`#/board/${board.id}`);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Boards</h1>
        <p className="text-sm text-zinc-400">
          Visual workspaces: drop in Reels, creators, links, files and notes, wire them into an AI chat, and build content
          from them. One board per series, campaign or client works well.
        </p>
      </header>
      <div className="flex gap-2">
        <input
          className="input max-w-sm"
          placeholder="New board name, e.g. “Hooks lab” or “November series”"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <button className="btn-primary" onClick={create}>
          <Plus className="h-4 w-4" /> New board
        </button>
      </div>
      {boards.error ? <ErrorBox error={boards.error} /> : null}
      {boards.loading && !boards.data ? (
        <Spinner />
      ) : boards.data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.data.map((b) => (
            <div key={b.id} className="card group flex items-start justify-between p-4 hover:border-zinc-600">
              <a href={`#/board/${b.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-semibold">
                  <LayoutGrid className="h-4 w-4 text-amber-400" /> {b.name}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {b.node_count} items · edited {timeAgo(b.updated_at)}
                </div>
              </a>
              <button
                className="text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-rose-300"
                title="Delete board"
                onClick={async () => {
                  if (!confirm(`Delete “${b.name}” and its chats?`)) return;
                  await api(`/boards/${b.id}`, { method: "DELETE" });
                  boards.reload();
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon={<LayoutGrid className="h-8 w-8" />} title="No boards yet" />
      )}
    </div>
  );
}
