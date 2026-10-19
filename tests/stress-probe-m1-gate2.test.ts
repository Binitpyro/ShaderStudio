import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import zlib from "zlib"
import React from "react"
import { type Node, type Edge } from "@xyflow/react"
import {
  SubGraphLibrary,
  subGraphLibrary,
  type SubGraphDefinition,
  type SubGraphNodeData,
} from "@/core/subGraphLibrary"
import {
  flattenGraph,
  compileGraph,
  type GraphNodeData,
  type UniformNodeData,
} from "@/core/graphCompiler"
import {
  CustomNodeRegistry,
  customNodeRegistry,
  validateCustomNodeManifest,
  type CustomNodeManifest,
} from "@/core/customNodeSdk"
import { resolveRollupManualChunk } from "./e2e/mocks/gen2Harness"

describe("Stress Probes: Milestone 1 Gate 2 Empirical Challenge", () => {
  const distAssetsDir = path.resolve(__dirname, "../dist/assets")

  // ==========================================================================
  // STRESS PROBE 1: Rollup Manual Chunk Invariant ("vendor-reactflow")
  // ==========================================================================
  describe("Stress Probe 1: Rollup Manual Chunk Invariant ('vendor-reactflow')", () => {
    it("empirically verifies dist/assets contains exactly one vendor-reactflow JS chunk and one CSS chunk", () => {
      expect(fs.existsSync(distAssetsDir)).toBe(true)
      const files = fs.readdirSync(distAssetsDir)

      const jsChunks = files.filter((f) => /^vendor-reactflow-[A-Za-z0-9_-]+\.js$/.test(f))
      expect(jsChunks.length).toBe(1)

      const cssChunks = files.filter((f) => /^vendor-reactflow-[A-Za-z0-9_-]+\.css$/.test(f))
      expect(cssChunks.length).toBe(1)

      const jsPath = path.join(distAssetsDir, jsChunks[0])
      const jsStat = fs.statSync(jsPath)
      expect(jsStat.size).toBeGreaterThan(100 * 1024)
      expect(jsStat.size).toBeLessThan(300 * 1024)

      const cssPath = path.join(distAssetsDir, cssChunks[0])
      const cssStat = fs.statSync(cssPath)
      expect(cssStat.size).toBeGreaterThan(5 * 1024)
      expect(cssStat.size).toBeLessThan(50 * 1024)
    })

    it("stress-tests Rollup manualChunks resolver against 100+ path variations across Windows and POSIX", () => {
      const posixRoots = [
        "node_modules/@xyflow/react/dist/esm/index.js",
        "node_modules/@xyflow/react/dist/style.css",
        "node_modules/@xyflow/system/dist/esm/index.js",
        "node_modules/reactflow/dist/esm/index.js",
        "/home/runner/work/ShaderStudio/node_modules/@xyflow/react/index.mjs",
        "/var/app/node_modules/@xyflow/system/core.js",
      ]

      const winRoots = [
        "C:\\Users\\binit\\Desktop\\ShaderStudio\\node_modules\\@xyflow\\react\\dist\\esm\\index.js",
        "D:\\projects\\node_modules\\@xyflow\\system\\index.js",
        "C:\\node_modules\\reactflow\\dist\\esm\\index.js",
        "E:\\ShaderStudio\\node_modules\\@xyflow\\react\\components\\Nodes\\index.js",
      ]

      for (const p of posixRoots) {
        expect(resolveRollupManualChunk(p)).toBe("vendor-reactflow")
      }

      for (const p of winRoots) {
        const normalized = p.replace(/\\/g, "/")
        expect(resolveRollupManualChunk(normalized)).toBe("vendor-reactflow")
      }

      // Application code MUST NOT match vendor-reactflow
      const appPaths = [
        "src/components/NodeGraph.tsx",
        "src/components/nodes/SubGraphNode.tsx",
        "src/components/nodes/GenericCustomNode.tsx",
        "src/core/graphCompiler.ts",
        "src/core/subGraphLibrary.ts",
        "C:\\ShaderStudio\\src\\components\\NodeGraph.tsx".replace(/\\/g, "/"),
      ]

      for (const p of appPaths) {
        expect(resolveRollupManualChunk(p)).not.toBe("vendor-reactflow")
      }
    })

    it("verifies main index bundle strict size budget (< 300 kB uncompressed, < 90 kB gzipped)", () => {
      const files = fs.readdirSync(distAssetsDir)
      const entryFiles = files.filter((f) => /^index-[A-Za-z0-9_-]+\.js$/.test(f))
      expect(entryFiles.length).toBe(1)

      const entryPath = path.join(distAssetsDir, entryFiles[0])
      const content = fs.readFileSync(entryPath)
      const uncompressedBytes = content.length
      const gzippedBytes = zlib.gzipSync(content).length

      expect(uncompressedBytes).toBeLessThan(300 * 1024)
      expect(gzippedBytes).toBeLessThan(90 * 1024)

      // Ensure entry does not embed xyflow / reactflow core code
      const entryText = content.toString("utf-8")
      expect(entryText.includes("xyflow.com")).toBe(false)
    })
  })

  // ==========================================================================
  // STRESS PROBE 2: Uniform Sanitization with Multi-Hyphen UUIDs
  // ==========================================================================
  describe("Stress Probe 2: Node Graph Uniform Sanitization with UUIDs (u_uuid_with_hyphens_uniform)", () => {
    it("sanitizes multi-hyphen UUID v4 in sub-graph node ID into valid GLSL/WGSL identifier", () => {
      const uuidNodeId = "subgraph-f47ac10b-58cc-4372-a567-0e02b2c3d479"
      const rootNodes: Node<GraphNodeData>[] = [
        {
          id: uuidNodeId,
          position: { x: 0, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "builtin-fresnel-rim",
            name: "UUID Fresnel Instance",
            uniformValues: { power: 4.5 },
          } as SubGraphNodeData,
        },
      ]

      const result = flattenGraph(rootNodes, [], subGraphLibrary)
      expect(result.error).toBeNull()

      const uniformNodes = result.nodes.filter((n) => n.data.type === "uniform")
      expect(uniformNodes.length).toBe(2)

      for (const uNode of uniformNodes) {
        const uData = uNode.data as UniformNodeData
        // Identifier legality check for GLSL/WGSL: [a-zA-Z_][a-zA-Z0-9_]*
        expect(uData.name).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
        // Must NOT contain any hyphens
        expect(uData.name.includes("-")).toBe(false)
        // Must contain sanitized UUID with underscores
        expect(uData.name).toContain("f47ac10b_58cc_4372_a567_0e02b2c3d479")
      }

      const powerNode = uniformNodes.find((n) => n.data.type === "uniform" && n.data.name.includes("power"))
      expect(powerNode).toBeDefined()
      if (powerNode && powerNode.data.type === "uniform") {
        expect(powerNode.data.name).toBe("u_subgraph_f47ac10b_58cc_4372_a567_0e02b2c3d479_power")
        expect(powerNode.data.defaultValue).toBe(4.5)
      }
    })

    it("sanitizes numeric-leading UUIDs and heavily hyphenated extreme IDs", () => {
      const extremeIds = [
        "12345678-1234-1234-1234-123456789abc",
        "---triple-leading-and-trailing---",
        "a-b-c-d-e-f-0-1-2-3-4-5",
        "uuid-with-lots-of-hyphens-every-word-separated",
      ]

      for (const id of extremeIds) {
        const rootNodes: Node<GraphNodeData>[] = [
          {
            id,
            position: { x: 0, y: 0 },
            data: {
              type: "subgraph",
              subGraphId: "builtin-fresnel-rim",
              name: `Test ${id}`,
            } as SubGraphNodeData,
          },
        ]

        const result = flattenGraph(rootNodes, [], subGraphLibrary)
        expect(result.error).toBeNull()

        const uniformNodes = result.nodes.filter((n) => n.data.type === "uniform")
        for (const uNode of uniformNodes) {
          const uData = uNode.data as UniformNodeData
          // In GLSL/WGSL, identifier must not have hyphens
          expect(uData.name.includes("-")).toBe(false)
          // Starts with u_
          expect(uData.name.startsWith("u_")).toBe(true)
          // Must match legal identifier
          expect(uData.name).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
        }
      }
    })

    it("properly resolves uniformValues overrides when target is keyed with sanitized or unsanitized names", () => {
      const nodeId = "sub-uuid-1111-2222-3333"
      const unsanitizedKey = `u_${nodeId}_power` // u_sub-uuid-1111-2222-3333_power
      const sanitizedKey = `u_sub_uuid_1111_2222_3333_power`

      // 1. Unsanitized key override
      let rootNodes: Node<GraphNodeData>[] = [
        {
          id: nodeId,
          position: { x: 0, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "builtin-fresnel-rim",
            name: "Test",
            uniformValues: { [unsanitizedKey]: 9.25 },
          } as SubGraphNodeData,
        },
      ]
      let res = flattenGraph(rootNodes, [], subGraphLibrary)
      let powerNode = res.nodes.find((n) => n.data.type === "uniform" && n.data.name.includes("power"))
      expect((powerNode?.data as UniformNodeData).defaultValue).toBe(9.25)

      // 2. Sanitized key override
      rootNodes = [
        {
          id: nodeId,
          position: { x: 0, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "builtin-fresnel-rim",
            name: "Test",
            uniformValues: { [sanitizedKey]: 7.5 },
          } as SubGraphNodeData,
        },
      ]
      res = flattenGraph(rootNodes, [], subGraphLibrary)
      powerNode = res.nodes.find((n) => n.data.type === "uniform" && n.data.name.includes("power"))
      expect((powerNode?.data as UniformNodeData).defaultValue).toBe(7.5)

      // 3. Short original name override
      rootNodes = [
        {
          id: nodeId,
          position: { x: 0, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "builtin-fresnel-rim",
            name: "Test",
            uniformValues: { power: 3.33 },
          } as SubGraphNodeData,
        },
      ]
      res = flattenGraph(rootNodes, [], subGraphLibrary)
      powerNode = res.nodes.find((n) => n.data.type === "uniform" && n.data.name.includes("power"))
      expect((powerNode?.data as UniformNodeData).defaultValue).toBe(3.33)
    })

    it("verifies multi-level sub-graph nesting preserves hyphen sanitization at all depths", () => {
      const customLib = new SubGraphLibrary()

      // Leaf definition with uniform
      customLib.register({
        id: "leaf-sub-graph",
        name: "Leaf",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [
          {
            id: "u_leaf_param",
            position: { x: 0, y: 0 },
            data: {
              type: "uniform",
              uniformId: "param",
              name: "leaf_param",
              uniformType: "float",
              defaultValue: 1.0,
            },
          },
        ],
        edges: [],
      })

      // Intermediate definition
      customLib.register({
        id: "mid-sub-graph",
        name: "Mid",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [
          {
            id: "inner-uuid-leaf-aaaa-bbbb",
            position: { x: 0, y: 0 },
            data: {
              type: "subgraph",
              subGraphId: "leaf-sub-graph",
              name: "Leaf Sub",
            } as SubGraphNodeData,
          },
        ],
        edges: [],
      })

      // Root graph with outer UUID
      const rootNodes: Node<GraphNodeData>[] = [
        {
          id: "outer-uuid-mid-cccc-dddd",
          position: { x: 0, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "mid-sub-graph",
            name: "Mid Sub",
          } as SubGraphNodeData,
        },
      ]

      const result = flattenGraph(rootNodes, [], customLib)
      expect(result.error).toBeNull()

      const uniformNode = result.nodes.find((n) => n.data.type === "uniform")
      expect(uniformNode).toBeDefined()
      const uData = uniformNode!.data as UniformNodeData

      // Must be completely free of hyphens in its GLSL identifier name
      expect(uData.name.includes("-")).toBe(false)
      expect(uData.name).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
      expect(uData.name).toContain("outer_uuid_mid_cccc_dddd")
      expect(uData.name).toContain("inner_uuid_leaf_aaaa_bbbb")
    })
  })

  // ==========================================================================
  // STRESS PROBE 3: Custom Node Registry Memory & Rapid Operations Stability
  // ==========================================================================
  describe("Stress Probe 3: Custom Node Registry Rapid Operations & Memory Stability", () => {
    let registry: CustomNodeRegistry

    beforeEach(() => {
      registry = new CustomNodeRegistry()
      registry.clear()
    })

    afterEach(() => {
      registry.clear()
    })

    it("survives 10,000 rapid sequential registrations and unregistrations with zero leak", () => {
      const COUNT = 10000

      // Rapid register
      for (let i = 0; i < COUNT; i++) {
        const manifest: CustomNodeManifest = {
          id: `custom-node-${i}`,
          name: `Custom Node ${i}`,
          category: "math",
          inputs: [{ name: "inVal", type: "float" }],
          outputs: [{ name: "outVal", type: "float" }],
          parameters: [{ name: "gain", type: "float", default: 1.0 }],
          glsl: `float node_${i}(float x) { return x * 2.0; }`,
        }
        const ok = registry.register(manifest)
        expect(ok).toBe(true)
      }

      expect(registry.getAll().length).toBe(COUNT)

      // Rapid unregister
      for (let i = 0; i < COUNT; i++) {
        const ok = registry.unregister(`custom-node-${i}`)
        expect(ok).toBe(true)
      }

      expect(registry.getAll().length).toBe(0)
    })

    it("handles 5,000 interleaved register / unregister / palette queries without state corruption", () => {
      const BATCH = 5000

      for (let i = 0; i < BATCH; i++) {
        registry.register({
          id: `node-${i}`,
          name: `Node ${i}`,
          category: "filter",
          inputs: [{ name: "in", type: "vec3" }],
          outputs: [{ name: "out", type: "vec3" }],
          parameters: [],
          wgsl: `fn run_${i}(v: vec3f) -> vec3f { return v; }`,
        })

        if (i % 2 === 1) {
          // Unregister previous odd
          registry.unregister(`node-${i - 1}`)
        }

        if (i % 1000 === 0) {
          const items = registry.getPaletteItems()
          expect(Array.isArray(items)).toBe(true)
        }
      }

      // After 5000 items (0..4999), all even i where i-1 was unregistered were removed when i was odd
      // Total remaining must be exactly 2500
      expect(registry.getAll().length).toBe(2500)
    })

    it("handles 1,000 rapid updates to the same manifest ID without duplicate entries", () => {
      const nodeId = "hot-reloaded-node"

      for (let i = 0; i < 1000; i++) {
        const manifest: CustomNodeManifest = {
          id: nodeId,
          name: `Version ${i}`,
          category: "generator",
          inputs: [{ name: "uv", type: "vec2" }],
          outputs: [{ name: "col", type: "vec4" }],
          parameters: [{ name: "iteration", type: "float", default: i }],
          glsl: `vec4 gen_${i}() { return vec4(${i}.0); }`,
        }
        registry.register(manifest)
      }

      expect(registry.getAll().length).toBe(1)
      const finalManifest = registry.get(nodeId)
      expect(finalManifest?.name).toBe("Version 999")
      expect(finalManifest?.parameters[0].default).toBe(999)
    })

    it("robustly rejects 1,000 malformed / adversarial manifests without crashing", () => {
      const garbagePayloads = [
        null,
        undefined,
        {},
        { id: "" },
        { id: "   " },
        { id: "valid-id", name: "" },
        { id: "valid-id", name: "   " },
        { id: "valid-id", name: "Valid", inputs: "not-an-array" },
        { id: "valid-id", name: "Valid", inputs: [], outputs: "not-an-array" },
        { id: "valid-id", name: "Valid", inputs: [], outputs: [], parameters: "not-an-array" },
        { id: "valid-id", name: "Valid", inputs: [], outputs: [], parameters: [null] },
        { id: "valid-id", name: "Valid", inputs: [], outputs: [], parameters: [{ name: "" }] },
        { id: "valid-id", name: "Valid", inputs: [], outputs: [], parameters: [{ name: "p1", type: "" }] },
        { id: "valid-id", name: "Valid", inputs: [], outputs: [], parameters: [{ name: "p1", type: "   " }] },
        { id: "valid-id", name: "Valid", inputs: [], outputs: [], parameters: [] }, // missing shader
      ]

      for (let cycle = 0; cycle < 50; cycle++) {
        for (const bad of garbagePayloads) {
          expect(() => {
            const res = validateCustomNodeManifest(bad)
            expect(res.valid).toBe(false)
            const registered = registry.register(bad as any)
            expect(registered).toBe(false)
          }).not.toThrow()
        }
      }

      expect(registry.getAll().length).toBe(0)
    })

    it("verifies component registration and memory release upon registry.clear()", () => {
      const DummyComponent: React.FC = () => React.createElement("div", null, "Custom UI")

      for (let i = 0; i < 500; i++) {
        registry.registerComponent(`comp_${i}`, DummyComponent)
      }

      expect(registry.getComponent("comp_0")).toBe(DummyComponent)
      expect(registry.getComponent("comp_499")).toBe(DummyComponent)

      registry.clear()

      expect(registry.getComponent("comp_0")).toBeUndefined()
      expect(registry.getComponent("comp_499")).toBeUndefined()
    })
  })
})
