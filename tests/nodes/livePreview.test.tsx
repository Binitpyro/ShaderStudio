import { describe, it, expect, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { NodePreviewViewport } from "@/components/inspector/NodePreviewViewport"
import type { Node } from "@xyflow/react"
import type { GraphNodeData } from "@/core/graphCompiler"

describe("R1d: Per-Node Live Preview Viewport", () => {
  it("renders 240x180 mini-viewport canvas for procedural shader node", () => {
    const node: Node<GraphNodeData> = {
      id: "math-expr-1",
      position: { x: 0, y: 0 },
      data: {
        type: "math_expression",
        expression: "sin(uv.x * 10.0) * 0.5 + 0.5",
        outputType: "float",
      },
    }

    const html = renderToStaticMarkup(
      <NodePreviewViewport node={node} />
    )

    expect(html).toContain("MATH_EXPRESSION")
    expect(html).toContain("math-expr-1")
    expect(html).toContain("<canvas")
    expect(html).toContain('width="240"')
    expect(html).toContain('height="180"')
    expect(html).toContain("240×180")
  })

  it("renders channel selector pills across RGBA, RGB, R, G, B, A", () => {
    const node: Node<GraphNodeData> = {
      id: "mat-1",
      position: { x: 0, y: 0 },
      data: {
        type: "material",
        shaderPath: "test.wgsl",
      },
    }

    const html = renderToStaticMarkup(
      <NodePreviewViewport node={node} />
    )

    expect(html).toContain("rgba")
    expect(html).toContain("rgb")
    expect(html).toContain(">r<")
    expect(html).toContain(">g<")
    expect(html).toContain(">b<")
    expect(html).toContain(">a<")
  })

  it("renders play/pause animation toggle for interactive previews", () => {
    const node: Node<GraphNodeData> = {
      id: "time-1",
      position: { x: 0, y: 0 },
      data: {
        type: "time",
      },
    }

    const html = renderToStaticMarkup(
      <NodePreviewViewport node={node} />
    )

    expect(html).toContain('title="Pause preview"')
  })

  it("displays close button when onClose prop is supplied", () => {
    const node: Node<GraphNodeData> = {
      id: "mesh-1",
      position: { x: 0, y: 0 },
      data: {
        type: "mesh",
        geometry: "torus_knot",
      },
    }

    const html = renderToStaticMarkup(
      <NodePreviewViewport node={node} onClose={() => {}} />
    )

    expect(html).toContain('title="Close live preview"')
  })

  it("displays neutral fallback notice when selected node is an annotation node", () => {
    const commentNode: Node<GraphNodeData> = {
      id: "note-1",
      position: { x: 0, y: 0 },
      data: {
        type: "comment",
        title: "Architecture Note",
        text: "This pipeline uses deferred lighting.",
      },
    }

    const html = renderToStaticMarkup(
      <NodePreviewViewport node={commentNode} />
    )

    expect(html).toContain("Annotation node — no isolated shader output.")
    expect(html).not.toContain("<canvas")
    expect(html).not.toContain('title="Pause preview"')
  })
})
