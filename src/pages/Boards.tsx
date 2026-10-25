import { useState } from "react";
import { LayoutGrid, Plus, Trash2 } from "lucide-react";
import { api, navigate, timeAgo, type Board } from "../api.ts";
import { ConfirmDialog, Empty, ErrorBox, IconButton, Spinner, useAsync } from "../components/ui.tsx";

export function BoardsPage() {
  const boards = useAsync(() => api<Board[]>("/boards"), []);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<Board | null>(null);

  const create = async () => {
    const board = await api<Board>("/boards", { body: { name: name.trim() || "Untitled board" } });
    navigate(`#/board/${board.id}`);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Boards</h1>
        <p className="text-sm text-fg-2">
          Visual workspaces: drop in Reels, creators, links, files and notes, wire them into an AI chat, and build content
          from them. One board per series, campaign or client works well.
        </p>
      </header>
      <div className="flex gap-2">
        <input
          className="input max-w-sm"
          aria-label="New board name"
          placeholder="New board name, e.g. “Hooks lab” or “November series”"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <button className="btn-primary" onClick={create}>
          <Plus aria-hidden className="h-4 w-4" /> New board
        </button>
      </div>
      {boards.error ? <ErrorBox error={boards.error} /> : null}
      {boards.loading && !boards.data ? (
        <Spinner />
      ) : boards.data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.data.map((b) => (
            <div key={b.id} className="card group flex items-start justify-between gap-2 p-4 transition-colors hover:border-line-strong">
              <a href={`#/board/${b.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-semibold">
                  <LayoutGrid aria-hidden className="h-4 w-4 shrink-0 text-fg-3" />
                  <span className="truncate">{b.name}</span>
                </div>
                <div className="mt-1 text-xs text-fg-3">
                  {b.node_count} cards · edited {timeAgo(b.updated_at)}
                </div>
              </a>
              <IconButton
                label={`Delete ${b.name}`}
                tone="danger"
                className="-m-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => setDeleting(b)}
              >
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon={<LayoutGrid className="h-8 w-8" />} title="No boards yet">
          Name a board above and press New board.
        </Empty>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          message="Its cards and chat conversations will be deleted. Reels stay on your Trend Radar. This can't be undone."
          confirmLabel="Delete board"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const id = deleting.id;
            setDeleting(null);
            await api(`/boards/${id}`, { method: "DELETE" });
            boards.reload();
          }}
        />
      )}
    </div>
  );
}
