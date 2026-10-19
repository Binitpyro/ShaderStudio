import { describe, it, expect, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { CommentNode } from "@/components/nodes/CommentNode"
import { FrameNode } from "@/components/nodes/FrameNode"
import { compileGraph, type GraphNodeData } from "@/core/graphCompiler"
import { Node, Edge, ReactFlowProvider } from "@xyflow/react"

describe("R1e: Comment & Frame Annotation Nodes", () => {
  describe("CommentNode UI Component", () => {
    it("renders title, multiline textarea, and theme styles", () => {
      const html = renderToStaticMarkup(
        <CommentNode
          id="comment-1"
          data={{
            type: "comment",
            title: "Post-Processing Notes",
            text: "Ensure bloom threshold is tuned for HDR output.",
            color: "emerald",
          }}
          selected={false}
          zIndex={1}
          isConnectable={false}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          dragging={false}
          type="comment"
        />
      )

      expect(html).toContain("Post-Processing Notes")
      expect(html).toContain("Ensure bloom threshold is tuned for HDR output.")
      expect(html).toContain("bg-emerald-950/20")
      expect(html).toContain("border-emerald-500/40")
    })

    it("renders with default yellow note theme when no color specified", () => {
      const html = renderToStaticMarkup(
        <CommentNode
          id="comment-2"
          data={{
            type: "comment",
            text: "Default note text",
          }}
          selected={true}
          zIndex={1}
          isConnectable={false}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          dragging={false}
          type="comment"
        />
      )

      expect(html).toContain("Note")
      expect(html).toContain("Default note text")
      expect(html).toContain("bg-amber-950/20")
    })
  })

  describe("FrameNode UI Component", () => {
    it("renders label, resizer wrapper, and frame container", () => {
      const html = renderToStaticMarkup(
        <ReactFlowProvider>
          <FrameNode
            id="frame-1"
            data={{
              type: "frame",
              label: "Lighting Pipeline Group",
              color: "cyan",
            }}
            selected={true}
            zIndex={0}
            isConnectable={false}
            positionAbsoluteX={0}
            positionAbsoluteY={0}
            dragging={false}
            type="frame"
          />
        </ReactFlowProvider>
      )

      expect(html).toContain("Lighting Pipeline Group")
      expect(html).toContain("border-cyan-500/50")
      expect(html).toContain("bg-cyan-950/10")
      expect(html).toContain("react-flow__resize-control")
    })

    it("renders default frame theme when no color specified", () => {
      const html = renderToStaticMarkup(
        <ReactFlowProvider>
          <FrameNode
            id="frame-2"
            data={{
              type: "frame",
              label: "Default Frame",
            }}
            selected={false}
            zIndex={0}
            isConnectable={false}
            positionAbsoluteX={0}
            positionAbsoluteY={0}
            dragging={false}
            type="frame"
          />
        </ReactFlowProvider>
      )

      expect(html).toContain("Default Frame")
      expect(html).toContain("bg-muted/10")
    })
  })

  describe("Compiler Neutrality Invariant", () => {
    it("emits 0 steps in RenderQueue for comment and frame nodes", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "sphere" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "test.wgsl" } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
        {
          id: "ann-comment",
          position: { x: 50, y: 150 },
          data: { type: "comment", title: "Note", text: "A comment here" },
        },
        {
          id: "ann-frame",
          position: { x: -20, y: -20 },
          data: { type: "frame", label: "My Group" },
        },
      ]

      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "out-1" },
      ]

      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()

      // Exactly 2 steps: mesh and material
      expect(result.queue.length).toBe(2)
      expect(result.queue.some((s) => (s as any).type === "comment")).toBe(false)
      expect(result.queue.some((s) => (s as any).type === "frame")).toBe(false)
    })

    it("is completely ignored during topology validation even if disconnected", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "plane" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "base.frag" } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
        { id: "lonely-comment", position: { x: 1000, y: 1000 }, data: { type: "comment", text: "Orphan note" } },
        { id: "lonely-frame", position: { x: 2000, y: 2000 }, data: { type: "frame", label: "Orphan frame" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "out-1" },
      ]

      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      expect(result.queue.length).toBe(2)
    })
  })
})
