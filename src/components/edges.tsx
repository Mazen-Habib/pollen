import { createContext, useContext, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { Scissors } from "lucide-react";

/** Shared between the canvas and its edges: which line is hovered, and how to cut one. */
export const EdgeUI = createContext<{
  hovered: string | null;
  setHovered: (id: string | null) => void;
  cut: (id: string) => void;
}>({ hovered: null, setHovered: () => {}, cut: () => {} });

/**
 * A connection line you can cut: hover shows a scissors button at the midpoint,
 * and hovering the scissors previews the cut (red, dashed) before you click.
 */
export function CutEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected }: EdgeProps) {
  const { hovered, setHovered, cut } = useContext(EdgeUI);
  const [armed, setArmed] = useState(false);
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const active = hovered === id || selected;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={24}
        style={{
          stroke: armed ? "var(--c-danger)" : active ? "var(--c-fg)" : undefined,
          strokeWidth: active ? 2.25 : undefined,
          strokeDasharray: armed ? "6 5" : undefined,
          transition: "stroke 120ms",
        }}
      />
      {active && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="Disconnect"
            title="Disconnect"
            className="nodrag nopan absolute flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-surface text-fg-2 shadow-float transition-colors hover:border-danger hover:bg-danger hover:text-surface"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}
            onMouseEnter={() => {
              setHovered(id);
              setArmed(true);
            }}
            onMouseLeave={() => {
              setArmed(false);
              setHovered(null);
            }}
            onClick={() => cut(id)}
          >
            <Scissors className="h-3.5 w-3.5" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { cut: CutEdge };
