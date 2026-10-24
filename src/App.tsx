import { useCallback, useEffect, useState } from "react";
import { Radar as RadarIcon, Lightbulb, LayoutGrid, Fingerprint, Settings as SettingsIcon } from "lucide-react";
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

function Dot({ on, label }: { on: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${on ? "bg-emerald-400" : "bg-zinc-600"}`} />
      <span className={on ? "text-zinc-300" : "text-zinc-500"}>{label}</span>
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
        <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 p-3">
          <a href="#/radar" className="mb-6 flex items-center gap-2 px-2 pt-1 text-lg font-bold tracking-tight">
            <span className="text-2xl">🌼</span> Pollen
          </a>
          <nav className="space-y-1">
            {NAV.map(({ id, label, icon: Icon }) => (
              <a
                key={id}
                href={`#/${id}`}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${
                  active === id ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
              </a>
            ))}
          </nav>
          <div className="mt-auto space-y-1.5 rounded-lg border border-zinc-800 p-3 text-xs">
            <div className="mb-1 font-medium text-zinc-400">Live data</div>
            <Dot on={!!status?.llm} label="AI (Groq)" />
            <Dot on={!!status?.meta} label="Meta Business Discovery" />
            <Dot on={!!status?.apify} label="Apify scraper" />
            {status && !status.meta && !status.apify && (
              <a href="#/settings/instagram" className="block pt-1 text-amber-300 hover:underline">
                Connect Instagram data →
              </a>
            )}
          </div>
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
