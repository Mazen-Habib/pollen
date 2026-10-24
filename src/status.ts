import { createContext, useContext } from "react";
import type { SourcesStatus } from "./api.ts";

type StatusCtx = { status: SourcesStatus | null; refreshStatus: () => void };

export const StatusContext = createContext<StatusCtx>({ status: null, refreshStatus: () => {} });
export const useStatus = () => useContext(StatusContext);
