import { describe, it, expect, beforeEach } from "vitest"
import React from "react"
import {
  validateCustomNodeManifest,
  CustomNodeRegistry,
  customNodeRegistry,
  type CustomNodeManifest,
} from "@/core/customNodeSdk"
import { compileGraph, type GraphNodeData } from "@/core/graphCompiler"
import type { Node, Edge } from "@xyflow/react"

describe("R1b: Custom Node SDK & Hybrid Registry", () => {
  let registry: CustomNodeRegistry

  beforeEach(() => {
    registry = new CustomNodeRegistry()
    registry.clear()
  })

  describe("Manifest Validation (validateCustomNodeManifest)", () => {
    it("accepts a fully compliant JSON manifest", () => {
      const manifest: CustomNodeManifest = {
        id: "color-inverter",
        name: "Color Inverter",
        version: "1.0.0",
        author: "Dev",
        category: "filter",
        description: "Inverts RGB channels of texture",
        inputs: [{ id: "tex_in", name: "Texture", type: "sampler2D" }],
        outputs: [{ id: "tex_out", name: "Output", type: "sampler2D" }],
        parameters: [
          {
            id: "factor",
            name: "factor",
            type: "float",
            default: 1.0,
            ui: "slider",
            min: 0.0,
            max: 1.0,
            step: 0.01,
          },
        ],
        glsl: "vec4 colorInverter(vec4 col, float factor) { return mix(col, vec4(1.0) - col, factor); }",
        wgsl: "fn colorInverter(col: vec4<f32>, factor: f32) -> vec4<f32> { return mix(col, vec4<f32>(1.0) - col, factor); }",
      }

      const result = validateCustomNodeManifest(manifest)
      expect(result.valid).toBe(true)
      expect(result.errors.length).toBe(0)
      expect(result.manifest?.id).toBe("color-inverter")
      expect(result.manifest?.name).toBe("Color Inverter")
      expect(result.manifest?.parameters[0].default).toBe(1.0)
    })

    it("rejects non-object or null data", () => {
      expect(validateCustomNodeManifest(null).valid).toBe(false)
      expect(validateCustomNodeManifest(undefined).valid).toBe(false)
      expect(validateCustomNodeManifest("string").valid).toBe(false)
    })

    it("rejects manifest missing id and name", () => {
      const result = validateCustomNodeManifest({
        inputs: [],
        outputs: [],
        parameters: [],
        glsl: "void main() {}",
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("id"))).toBe(true)
      expect(result.errors.some((e) => e.includes("name"))).toBe(true)
    })

    it("rejects manifest missing inputs, outputs, or parameters arrays", () => {
      const result = validateCustomNodeManifest({
        id: "test",
        name: "Test",
        glsl: "void main() {}",
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("inputs"))).toBe(true)
      expect(result.errors.some((e) => e.includes("outputs"))).toBe(true)
      expect(result.errors.some((e) => e.includes("parameters"))).toBe(true)
    })

    it("rejects invalid input/output port definitions without name or type", () => {
      const result = validateCustomNodeManifest({
        id: "test",
        name: "Test",
        inputs: [{ name: "bad_port" }], // missing type
        outputs: [{ type: "vec3" }], // missing name
        parameters: [],
        glsl: "void main() {}",
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("Input port at index 0"))).toBe(true)
      expect(result.errors.some((e) => e.includes("Output port at index 0"))).toBe(true)
    })

    it("rejects manifest with no shaders and no custom component", () => {
      const result = validateCustomNodeManifest({
        id: "test",
        name: "Test",
        inputs: [],
        outputs: [],
        parameters: [],
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("requires at least one shader snippet"))).toBe(true)
    })

    it("accepts manifest that defines customComponent instead of GLSL/WGSL", () => {
      const result = validateCustomNodeManifest({
        id: "custom-ui-node",
        name: "Custom UI Node",
        inputs: [],
        outputs: [],
        parameters: [],
        customComponent: "MySuperCustomComponent",
      })
      expect(result.valid).toBe(true)
      expect(result.manifest?.customComponent).toBe("MySuperCustomComponent")
    })

    it("rejects whitespace-only IDs and names", () => {
      const res1 = validateCustomNodeManifest({
        id: "   \t  ",
        name: "Valid Name",
        inputs: [],
        outputs: [],
        parameters: [],
        glsl: "void main() {}",
      })
      expect(res1.valid).toBe(false)
      expect(res1.errors.some((e) => e.includes("id"))).toBe(true)

      const res2 = validateCustomNodeManifest({
        id: "valid-id",
        name: "   ",
        inputs: [],
        outputs: [],
        parameters: [],
        glsl: "void main() {}",
      })
      expect(res2.valid).toBe(false)
      expect(res2.errors.some((e) => e.includes("name"))).toBe(true)
    })

    it("rejects invalid or malformed parameter definitions without throwing", () => {
      const resNull = validateCustomNodeManifest({
        id: "param-test",
        name: "Param Test",
        inputs: [],
        outputs: [],
        parameters: [null, 42, { type: "float" }, { name: "   ", type: "float" }, { name: "param1" }],
        glsl: "void main() {}",
      })
      expect(resNull.valid).toBe(false)
      expect(resNull.errors.length).toBeGreaterThanOrEqual(5)
      expect(resNull.errors.some((e) => e.includes("Parameter at index 0 must be a non-null object"))).toBe(true)
      expect(resNull.errors.some((e) => e.includes("Parameter at index 1 must be a non-null object"))).toBe(true)
      expect(resNull.errors.some((e) => e.includes("Parameter at index 2 must have a non-empty string 'name'"))).toBe(true)
      expect(resNull.errors.some((e) => e.includes("Parameter at index 3 must have a non-empty string 'name'"))).toBe(true)
      expect(resNull.errors.some((e) => e.includes("Parameter at index 4 must have a valid 'type'"))).toBe(true)
    })
  })

  describe("CustomNodeRegistry Management & Palette Generation", () => {
    const validManifest: CustomNodeManifest = {
      id: "blur-node",
      name: "Gaussian Blur",
      category: "Post-Processing",
      description: "Applies 9-tap gaussian blur",
      inputs: [{ name: "inputTex", type: "sampler2D" }],
      outputs: [{ name: "outputTex", type: "sampler2D" }],
      parameters: [
        { name: "radius", type: "float", default: 4.0, ui: "slider", min: 1, max: 16 },
      ],
      glsl: "vec4 blur() { return vec4(1.0); }",
    }

    it("registers and retrieves valid custom node manifests", () => {
      const registered = registry.register(validManifest)
      expect(registered).toBe(true)
      expect(registry.has("blur-node")).toBe(true)
      expect(registry.get("blur-node")?.name).toBe("Gaussian Blur")
      expect(registry.getAll().length).toBe(1)
    })

    it("unregisters manifests by ID", () => {
      registry.register(validManifest)
      expect(registry.unregister("blur-node")).toBe(true)
      expect(registry.has("blur-node")).toBe(false)
      expect(registry.get("blur-node")).toBeUndefined()
    })

    it("converts registered manifests into Palette items", () => {
      registry.register(validManifest)
      const items = registry.getPaletteItems()
      expect(items.length).toBe(1)
      expect(items[0].id).toBe("custom-blur-node")
      expect(items[0].label).toBe("Gaussian Blur")
      expect(items[0].type).toBe("custom")
      expect(items[0].category).toBe("Post-Processing")
      expect(items[0].description).toBe("Applies 9-tap gaussian blur")
      expect(items[0].defaultData.manifestId).toBe("blur-node")
      expect(items[0].defaultData.parameters.radius).toBe(4.0)
    })

    it("registers and retrieves custom React components for power users", () => {
      const MockComponent: React.FC = () => React.createElement("div", null, "Mock Custom UI")
      registry.registerComponent("CustomInspector", MockComponent)

      const retrieved = registry.getComponent("CustomInspector")
      expect(retrieved).toBe(MockComponent)
      expect(registry.getComponent("NonExistent")).toBeUndefined()
    })
  })

  describe("Discovery Scanner (discoverBuiltinNodes)", () => {
    it("discovers and registers custom nodes from module map", () => {
      const mockModules: Record<string, any> = {
        "/custom-nodes/bloom.json": {
          default: {
            id: "bloom-filter",
            name: "Bloom Filter",
            category: "filter",
            inputs: [{ name: "color", type: "vec4" }],
            outputs: [{ name: "out", type: "vec4" }],
            parameters: [{ name: "threshold", type: "float", default: 0.8 }],
            glsl: "vec4 bloom() { return vec4(1.0); }",
          },
        },
        "/custom-nodes/broken.json": {
          default: {
            id: "broken",
            // missing name, inputs, etc.
          },
        },
      }

      const discovered = registry.discoverBuiltinNodes(mockModules)
      expect(discovered.length).toBe(1)
      expect(discovered[0].id).toBe("bloom-filter")
      expect(registry.has("bloom-filter")).toBe(true)
      expect(registry.has("broken")).toBe(false)
    })

    it("loads sample grayscale-filter and vignette-effect manifests in global registry", () => {
      // Global customNodeRegistry runs discoverBuiltinNodes() during initialization
      expect(customNodeRegistry.has("grayscale-filter")).toBe(true)
      expect(customNodeRegistry.has("vignette-effect")).toBe(true)

      const grayscale = customNodeRegistry.get("grayscale-filter")
      expect(grayscale?.name).toBe("Grayscale Filter")
      expect(grayscale?.parameters.some((p) => p.name === "intensity")).toBe(true)

      const vignette = customNodeRegistry.get("vignette-effect")
      expect(vignette?.name).toBe("Cinematic Vignette")
      expect(vignette?.parameters.some((p) => p.name === "radius")).toBe(true)
      expect(vignette?.parameters.some((p) => p.name === "softness")).toBe(true)
    })
  })

  describe("Graph Compiler Integration with Custom Nodes", () => {
    it("compiles graph containing custom node into RenderQueue", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "plane" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "base.frag" } },
        {
          id: "custom-1",
          position: { x: 200, y: 0 },
          data: {
            type: "custom",
            manifestId: "grayscale-filter",
            parameters: { intensity: 0.75 },
          },
        },
        { id: "out-1", position: { x: 300, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "custom-1", targetHandle: "input" },
        { id: "e3", source: "custom-1", sourceHandle: "output", target: "out-1" },
      ]

      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      expect(result.queue.length).toBe(3) // mesh, material, custom
      const customStep = result.queue.find((s) => s.type === "custom")
      expect(customStep).toBeDefined()
      if (customStep && customStep.type === "custom") {
        expect(customStep.manifestId).toBe("grayscale-filter")
        expect(customStep.parameters.intensity).toBe(0.75)
        expect(customStep.snippet).toBeDefined()
      }
    })

    it("returns descriptive compilation error if custom node references unknown manifest", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "plane" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "base.frag" } },
        {
          id: "custom-bad",
          position: { x: 200, y: 0 },
          data: {
            type: "custom",
            manifestId: "non-existent-manifest-xyz",
          },
        },
        { id: "out-1", position: { x: 300, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "custom-bad" },
        { id: "e3", source: "custom-bad", target: "out-1" },
      ]

      const result = compileGraph(nodes, edges)
      expect(result.error).not.toBeNull()
      expect(result.error).toContain('Custom node "custom-bad" references unknown manifest')
    })
  })
})
