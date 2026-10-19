import { describe, it, expect } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ReactFlowProvider } from "@xyflow/react"

// 12 Core Nodes
import { MeshNode } from "@/components/nodes/MeshNode"
import { ComputeNode } from "@/components/nodes/ComputeNode"
import { AudioNode } from "@/components/nodes/AudioNode"
import { MaterialNode } from "@/components/nodes/MaterialNode"
import { TextureNode } from "@/components/nodes/TextureNode"
import { UniformNode } from "@/components/nodes/UniformNode"
import { TimeNode } from "@/components/nodes/TimeNode"
import { PostProcessNode } from "@/components/nodes/PostProcessNode"
import { OutputNode } from "@/components/nodes/OutputNode"
import { SdfPrimitiveNode } from "@/components/nodes/SdfPrimitiveNode"
import { SdfOperatorNode } from "@/components/nodes/SdfOperatorNode"
import { RaymarchNode } from "@/components/nodes/RaymarchNode"

// 5 Milestone 1 Power-up Nodes
import { SubGraphNode } from "@/components/nodes/SubGraphNode"
import { GenericCustomNode } from "@/components/nodes/GenericCustomNode"
import { MathExpressionNode } from "@/components/nodes/MathExpressionNode"
import { CommentNode } from "@/components/nodes/CommentNode"
import { FrameNode } from "@/components/nodes/FrameNode"

describe("React Flow v12 Migration: Complete Node Catalog Instantiation", () => {
  const commonProps = {
    selected: false,
    zIndex: 1,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
  }

  const renderWithProvider = (el: React.ReactElement) => {
    return renderToStaticMarkup(<ReactFlowProvider>{el}</ReactFlowProvider>)
  }

  describe("12 Core Nodes render correctly under @xyflow/react v12", () => {
    it("renders MeshNode", () => {
      const html = renderWithProvider(
        <MeshNode
          id="mesh-1"
          data={{ type: "mesh", geometry: "sphere" }}
          type="mesh"
          {...commonProps}
        />
      )
      expect(html).toContain("Mesh")
      expect(html).toContain("sphere")
    })

    it("renders ComputeNode", () => {
      const html = renderWithProvider(
        <ComputeNode
          id="compute-1"
          data={{ type: "compute", preset: "curl_noise", particleCount: 50000 }}
          type="compute"
          {...commonProps}
        />
      )
      expect(html).toContain("Compute")
      expect(html).toContain("curl_noise")
    })

    it("renders AudioNode", () => {
      const html = renderWithProvider(
        <AudioNode
          id="audio-1"
          data={{ type: "audio", sourceType: "builtin", volume: 0.8 }}
          type="audio"
          {...commonProps}
        />
      )
      expect(html).toContain("Audio")
      expect(html).toContain("builtin")
    })

    it("renders MaterialNode", () => {
      const html = renderWithProvider(
        <MaterialNode
          id="mat-1"
          data={{ type: "material", shaderPath: "test.frag" }}
          type="material"
          {...commonProps}
        />
      )
      expect(html).toContain("Material")
      expect(html).toContain("test.frag")
    })

    it("renders TextureNode", () => {
      const html = renderWithProvider(
        <TextureNode
          id="tex-1"
          data={{ type: "texture", textureId: "tex-123", name: "u_albedo" }}
          type="texture"
          {...commonProps}
        />
      )
      expect(html).toContain("Texture")
      expect(html).toContain("u_albedo")
    })

    it("renders UniformNode", () => {
      const html = renderWithProvider(
        <UniformNode
          id="u-1"
          data={{
            type: "uniform",
            uniformId: "u_scale",
            name: "scale",
            uniformType: "float",
            defaultValue: 1.5,
          }}
          type="uniform"
          {...commonProps}
        />
      )
      expect(html).toContain("Uniform")
      expect(html).toContain("scale")
    })

    it("renders TimeNode", () => {
      const html = renderWithProvider(
        <TimeNode
          id="time-1"
          data={{ type: "time" }}
          type="time"
          {...commonProps}
        />
      )
      expect(html).toContain("Time")
    })

    it("renders PostProcessNode", () => {
      const html = renderWithProvider(
        <PostProcessNode
          id="post-1"
          data={{ type: "postprocess", passType: "bloom" }}
          type="postprocess"
          {...commonProps}
        />
      )
      expect(html).toContain("Post Process")
      expect(html).toContain("bloom")
    })

    it("renders OutputNode", () => {
      const html = renderWithProvider(
        <OutputNode
          id="out-1"
          data={{ type: "output" }}
          type="output"
          {...commonProps}
        />
      )
      expect(html).toContain("Output")
    })

    it("renders SdfPrimitiveNode", () => {
      const html = renderWithProvider(
        <SdfPrimitiveNode
          id="sdf-prim-1"
          data={{
            type: "sdf_primitive",
            primitiveType: "sphere",
            params: { type: "sphere", radius: 1.0 },
          }}
          type="sdf_primitive"
          {...commonProps}
        />
      )
      expect(html).toContain("SDF Primitive")
      expect(html).toContain("sphere")
    })

    it("renders SdfOperatorNode", () => {
      const html = renderWithProvider(
        <SdfOperatorNode
          id="sdf-op-1"
          data={{
            type: "sdf_operator",
            operatorType: "smooth_union",
            params: { type: "smooth_union", smoothness: 0.2 },
          }}
          type="sdf_operator"
          {...commonProps}
        />
      )
      expect(html).toContain("SDF Operator")
      expect(html).toContain("Smooth Union")
    })

    it("renders RaymarchNode", () => {
      const html = renderWithProvider(
        <RaymarchNode
          id="ray-1"
          data={{ type: "raymarch", maxSteps: 128 }}
          type="raymarch"
          {...commonProps}
        />
      )
      expect(html).toContain("Raymarch Engine")
      expect(html).toContain("128")
    })
  })

  describe("5 Power-Up Milestone 1 Nodes render correctly under @xyflow/react v12", () => {
    it("renders SubGraphNode with inputs, outputs, and badges", () => {
      const html = renderWithProvider(
        <SubGraphNode
          id="sub-1"
          data={{
            type: "subgraph",
            subGraphId: "builtin-fresnel-rim",
            name: "Custom Fresnel",
            isCollapsed: false,
          }}
          type="subgraph"
          {...commonProps}
        />
      )
      expect(html).toContain("Custom Fresnel")
      expect(html).toContain("Lighting")
      expect(html).toContain("react-flow__handle")
    })

    it("renders GenericCustomNode from manifest parameters", () => {
      const html = renderWithProvider(
        <GenericCustomNode
          id="cust-1"
          data={{
            type: "custom",
            manifestId: "grayscale-filter",
            parameters: { intensity: 0.8 },
          }}
          type="custom"
          {...commonProps}
        />
      )
      expect(html).toContain("Grayscale Filter")
      expect(html).toContain("Shading")
    })

    it("renders MathExpressionNode with formula, status, and ports", () => {
      const html = renderWithProvider(
        <MathExpressionNode
          id="math-1"
          data={{
            type: "math_expression",
            expression: "sin(uv.x * 10.0) * 0.5 + 0.5",
            inputNames: ["uv"],
            outputType: "float",
          }}
          type="math_expression"
          {...commonProps}
        />
      )
      expect(html).toContain("Math Expression")
      expect(html).toContain("sin(uv.x * 10.0) * 0.5 + 0.5")
      expect(html).toContain("VALID")
    })

    it("renders CommentNode", () => {
      const html = renderWithProvider(
        <CommentNode
          id="comm-1"
          data={{
            type: "comment",
            title: "Pipeline Note",
            text: "This is a comment annotation",
            color: "blue",
          }}
          type="comment"
          {...commonProps}
        />
      )
      expect(html).toContain("Pipeline Note")
      expect(html).toContain("This is a comment annotation")
      expect(html).toContain("bg-sky-950/20")
    })

    it("renders FrameNode with resizer controls", () => {
      const html = renderWithProvider(
        <FrameNode
          id="frame-1"
          data={{
            type: "frame",
            label: "Frame Annotation",
            color: "purple",
          }}
          type="frame"
          {...commonProps}
          selected={true}
        />
      )
      expect(html).toContain("Frame Annotation")
      expect(html).toContain("border-purple-500/50")
      expect(html).toContain("react-flow__resize-control")
    })
  })

  describe("NodeGraph Canvas nodeTypes Map Registration", () => {
    it("registers all 17 node components in NodeGraph.tsx nodeTypes dictionary", async () => {
      const { nodeTypes } = await import("@/components/NodeGraph")
      const registeredKeys = Object.keys(nodeTypes)
      expect(registeredKeys.length).toBe(17)

      const expectedTypes = [
        "mesh",
        "compute",
        "audio",
        "material",
        "texture",
        "uniform",
        "time",
        "postprocess",
        "output",
        "sdf_primitive",
        "sdf_operator",
        "raymarch",
        "subgraph",
        "custom",
        "math_expression",
        "comment",
        "frame",
      ]

      for (const t of expectedTypes) {
        expect(nodeTypes[t]).toBeDefined()
      }
    })
  })
})
