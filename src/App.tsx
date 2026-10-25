import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Radar as RadarIcon,
  Lightbulb,
  LayoutGrid,
  Fingerprint,
  Settings as SettingsIcon,
} from "lucide-react";
import { api, type SourcesStatus } from "./api.ts";
import { StatusContext } from "./status.ts";
import { RadarPage } from "./pages/Radar.tsx";
import { IdeasPage } from "./pages/Ideas.tsx";
import { BoardsPage } from "./pages/Boards.tsx";
import { BoardCanvas } from "./pages/BoardCanvas.tsx";
import { BrandPage } from "./pages/Brand.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { JobsTray } from "./components/JobsTray.tsx";

function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const onChange = () => setParts(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parts;
}

const NAV = [
  { id: "radar", label: "Trend Radar", icon: RadarIcon },
  { id: "ideas", label: "Ideas", icon: Lightbulb },
  { id: "boards", label: "Boards", icon: LayoutGrid },
  { id: "brand", label: "Brand Memory", icon: Fingerprint },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

/** A source's state in words and shape, not just color. */
function SourceRow({ on, label }: { on: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-fg-2">{label}</span>
      <span className={`flex shrink-0 items-center gap-1 font-medium ${on ? "text-success" : "text-fg-3"}`}>
        {on ? <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> : <Circle aria-hidden className="h-3.5 w-3.5" />}
        {on ? "On" : "Off"}
      </span>
    </div>
  );
}

export default function App() {
  const [page = "radar", param] = useHashRoute();
  const [status, setStatus] = useState<SourcesStatus | null>(null);
  const refreshStatus = useCallback(() => {
    api<SourcesStatus>("/sources/status").then(setStatus).catch(() => {});
  }, []);
  useEffect(refreshStatus, [refreshStatus]);

  const active = page === "board" ? "boards" : page;
  const fullBleed = page === "board";

  return (
    <StatusContext.Provider value={{ status, refreshStatus }}>
      <div className="flex h-screen overflow-hidden">
        <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface p-3">
          <a href="#/radar" className="mb-6 flex items-center gap-2 px-2 pt-1 text-lg font-bold tracking-tight">
            <span aria-hidden className="text-2xl">
              🌼
            </span>
            Pollen
          </a>
          <nav aria-label="Main" className="space-y-0.5">
            {NAV.map(({ id, label, icon: Icon }) => (
              <a
                key={id}
                href={`#/${id}`}
                aria-current={active === id ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                  active === id ? "bg-surface-3 text-fg" : "text-fg-2 hover:bg-surface-2 hover:text-fg"
                }`}
              >
                <Icon aria-hidden className="h-4 w-4" /> {label}
              </a>
            ))}
          </nav>
          <a
            href="#/settings"
            className="mt-auto block space-y-1.5 rounded-lg border border-line p-3 text-xs transition-colors hover:bg-surface-2"
          >
            <div className="mb-1 font-medium text-fg">Live data</div>
            <SourceRow on={!!status?.llm} label="AI (Groq)" />
            <SourceRow on={!!status?.meta} label="Meta" />
            <SourceRow on={!!status?.apify} label="Apify" />
          </a>
        </aside>
        <main className={`min-w-0 flex-1 ${fullBleed ? "" : "overflow-y-auto"}`}>
          {page === "radar" && <RadarPage />}
          {page === "ideas" && <IdeasPage param={param} />}
          {page === "boards" && <BoardsPage />}
          {page === "board" && param && <BoardCanvas boardId={param} />}
          {page === "brand" && <BrandPage />}
          {page === "settings" && <SettingsPage section={param} />}
        </main>
      </div>
      <JobsTray />
    </StatusContext.Provider>
  );
}
