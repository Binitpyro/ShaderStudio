import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from "@xyflow/react"
import { X } from "lucide-react"

/** Default graph edge: wide hit area, and a delete button at its midpoint while selected. */
export function DeletableEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, style }: EdgeProps) {
  const { deleteElements } = useReactFlow()
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={24} />
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="Delete connection"
            title="Delete connection (Del)"
            onClick={() => void deleteElements({ edges: [{ id }] })}
            className="nodrag nopan pointer-events-auto absolute flex size-5 items-center justify-center rounded-full border border-line-strong bg-overlay text-fg-muted shadow-sm hover:bg-danger-solid hover:text-white"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <X className="size-3" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
