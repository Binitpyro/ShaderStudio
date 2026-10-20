/**
 * Node components + per-node live preview: NodePreviewViewport, annotation nodes (Frame/Comment), preview isolation from the project store.
 * Consolidated by fleet w1-b-ui.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Node, Edge, ReactFlowProvider } from "@xyflow/react"
import { SubGraphLibrary, subGraphLibrary, type SubGraphDefinition, type SubGraphNodeData } from "@/core/subGraphLibrary"
import { flattenGraph, compileGraph, MAX_SUBGRAPH_DEPTH, type GraphNodeData, type CustomNodeData } from "@/core/graphCompiler"
import { validateMathExpression, compileMathExpressionToGlsl, compileMathExpressionToWgsl } from "@/core/mathExpressionValidator"
import { validateCustomNodeManifest, type CustomNodeManifest } from "@/core/customNodeSdk"
import { NodePreviewViewport } from "@/components/inspector/NodePreviewViewport"
import { useProjectStore } from "@/stores/projectStore"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { FrameNode } from "@/components/nodes/FrameNode"
import { CommentNode } from "@/components/nodes/CommentNode"
import { WorkspaceLayout } from "@/components/layout/WorkspaceLayout"
import { useLayoutStore, type ActivityTab } from "@/stores/layoutStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"

describe("live preview isolation (m1 challenger2)", () => {
describe("Milestone 1 Challenger Instance 2: Empirical Challenge Suite (R1)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    subGraphLibrary.reset()
    useProjectStore.setState({
      activeBackend: "webgpu",
      shaderSource: "",
      activeShaderPath: null,
      parsedUniforms: [
        { name: "u_time", type: "float", defaultValue: 0.0 },
        { name: "u_resolution", type: "vec2", defaultValue: [1920, 1080] },
      ],
      uniformValues: { u_time: 1.5, u_resolution: [1920, 1080] },
      lastCompileError: null,
      deviceLost: false,
      autoCompile: true,
      recompileTrigger: 0,
      graphUniforms: [
        {
          uniformId: "u_color",
          name: "u_color",
          uniformType: "vec4",
          defaultValue: [0.2, 0.4, 0.8, 1.0],
        },
      ],
      textureResources: [],
      renderQueue: [{ type: "mesh", geometry: "torus_knot" }],
      _graphNodes: [],
      _graphEdges: [],
      currentProjectName: "AdversarialChallengeProject",
      hasUnsavedChanges: false,
    })
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Section 3: Per-Node Live Preview Isolation & Memory Safety
  // ==========================================================================
  describe("3. Per-Node Live Preview Isolation, Store Immunity & Memory Boundedness", () => {
    it("guarantees rendering live preview leaves main project store uniforms and render queue 100% unmutated", () => {
      const initialParsedUniforms = JSON.stringify(useProjectStore.getState().parsedUniforms)
      const initialGraphUniforms = JSON.stringify(useProjectStore.getState().graphUniforms)
      const initialUniformValues = JSON.stringify(useProjectStore.getState().uniformValues)
      const initialRenderQueue = JSON.stringify(useProjectStore.getState().renderQueue)

      const testNodes: Node<GraphNodeData>[] = [
        {
          id: "preview-math",
          position: { x: 0, y: 0 },
          data: { type: "math_expression", expression: "sin(uv.x * 10.0)", outputType: "float" },
        },
        {
          id: "preview-mat",
          position: { x: 0, y: 0 },
          data: { type: "material", shaderPath: "preview.wgsl" },
        },
        {
          id: "preview-mesh",
          position: { x: 0, y: 0 },
          data: { type: "mesh", geometry: "cube" },
        },
        {
          id: "preview-audio",
          position: { x: 0, y: 0 },
          data: { type: "audio", sourceType: "mic" },
        },
      ]

      for (const node of testNodes) {
        const html = renderToStaticMarkup(<NodePreviewViewport node={node} />)
        expect(html).toContain(node.id)
      }

      expect(JSON.stringify(useProjectStore.getState().parsedUniforms)).toBe(initialParsedUniforms)
      expect(JSON.stringify(useProjectStore.getState().graphUniforms)).toBe(initialGraphUniforms)
      expect(JSON.stringify(useProjectStore.getState().uniformValues)).toBe(initialUniformValues)
      expect(JSON.stringify(useProjectStore.getState().renderQueue)).toBe(initialRenderQueue)
    })

    it("verifies live preview uses pure 2D canvas without touching WebGL or WebGPU contexts", () => {
      const getContextCalls: string[] = []
      const canvasMock = env.createCanvas()
      const origGetContext = canvasMock.getContext.bind(canvasMock)

      canvasMock.getContext = (type: string, options?: any) => {
        getContextCalls.push(type)
        return origGetContext(type, options)
      }

      const node: Node<GraphNodeData> = {
        id: "test-preview",
        position: { x: 0, y: 0 },
        data: { type: "math_expression", expression: "cos(uv.y * 5.0)" },
      }

      renderToStaticMarkup(<NodePreviewViewport node={node} />)

      expect(getContextCalls).not.toContain("webgl")
      expect(getContextCalls).not.toContain("webgl2")
      expect(getContextCalls).not.toContain("webgpu")
    })

    it("canvas dimensions are strictly bounded to 240x180 avoiding unbounded memory allocations", () => {
      const node: Node<GraphNodeData> = {
        id: "bounded-preview",
        position: { x: 0, y: 0 },
        data: { type: "math_expression", expression: "sin(uv.x * 20.0)" },
      }

      const html = renderToStaticMarkup(<NodePreviewViewport node={node} />)
      expect(html).toContain('width="240"')
      expect(html).toContain('height="180"')
      expect(html).toContain("240×180")

      const bufferSizeBytes = 240 * 180 * 4
      expect(bufferSizeBytes).toBe(172800)
    })

    it("survives pathological mathematical expressions without exceptions", () => {
      const pathologicalFormulas = [
        "1.0 / 0.0",
        "0.0 / 0.0",
        "1e30",
        "-1e30",
        "sqrt(-1.0)",
      ]

      for (const formula of pathologicalFormulas) {
        const node: Node<GraphNodeData> = {
          id: `pathological-${Date.now()}`,
          position: { x: 0, y: 0 },
          data: { type: "math_expression", expression: formula },
        }

        expect(() => {
          renderToStaticMarkup(<NodePreviewViewport node={node} />)
        }).not.toThrow()
      }
    })

    it("renders annotation nodes with neutral non-rendering placeholder", () => {
      const commentNode: Node<GraphNodeData> = {
        id: "comment-1",
        position: { x: 0, y: 0 },
        data: { type: "comment", text: "This is a comment" },
      }
      const frameNode: Node<GraphNodeData> = {
        id: "frame-1",
        position: { x: 0, y: 0 },
        data: { type: "frame", label: "My Frame" },
      }

      const commentHtml = renderToStaticMarkup(<NodePreviewViewport node={commentNode} />)
      expect(commentHtml).toContain("Annotation node — no isolated shader output.")
      expect(commentHtml).not.toContain("<canvas")

      const frameHtml = renderToStaticMarkup(<NodePreviewViewport node={frameNode} />)
      expect(frameHtml).toContain("Annotation node — no isolated shader output.")
      expect(frameHtml).not.toContain("<canvas")
    })
  })
})
})

describe("annotation nodes (m1 nodegraph challenger)", () => {
describe("Adversarial Challenger: Milestone 1 (R1 Node Graph Power-ups)", () => {
  let customLib: SubGraphLibrary

  beforeEach(() => {
    customLib = new SubGraphLibrary()
  })

  // =========================================================================
  // SECTION 4: Frame and Comment Node Stress & Boundary Dimensions
  // =========================================================================
  describe("Frame & Comment Node Boundary Stress", () => {
    it("renders FrameNode with extreme dimensions and special characters without throwing", () => {
      expect(() => {
        renderToStaticMarkup(
          <ReactFlowProvider>
            <FrameNode
              id="frame-stress"
              data={{
                type: "frame",
                label: "<script>alert('xss')</script> — 🚀 Special # & < > Unicode 123",
                color: "rose",
                width: 999999,
                height: 999999,
              }}
              selected={true}
              zIndex={0}
              isConnectable={false}
              positionAbsoluteX={-10000}
              positionAbsoluteY={-10000}
              dragging={false}
              type="frame"
            />
          </ReactFlowProvider>
        )
      }).not.toThrow()
    })

    it("renders CommentNode with multiline strings, emojis, and unknown color gracefully", () => {
      const html = renderToStaticMarkup(
        <CommentNode
          id="comment-stress"
          data={{
            type: "comment",
            title: "🔥 Heavy Shader Pass\nMulti-line",
            text: "Line 1\nLine 2\nLine 3\n\0 Null byte & <tag>",
            color: "non-existent-color-theme" as any,
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

      expect(html).toContain("Heavy Shader Pass")
      expect(html).toContain("bg-amber-950/20")
    })
  })
})
})

describe("live preview viewport", () => {
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
})

describe("annotation node catalog", () => {
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
      expect(html).toContain("bg-raised")
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
})


// Real (unmocked) children: WorkspaceLayout mounts NodeGraph, Viewport, ShaderEditor, ParameterPanel,
// ProjectPanel, FileImporter, PostProcessDrawer, etc. Guards that the whole shell renders headlessly.
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn(), resolvedTheme: "dark" }),
}))
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../e2e/mocks/mockThreeJS")
  return { ...actual, WebGLRenderer: MockThreeRenderer }
})

describe("WorkspaceLayout with real child components", () => {
  beforeEach(() => {
    setupE2ETestEnvironment()
    useProjectStore.getState().resetProject()
    useFileSystemStore.setState({ bridgeConnected: false })
    useLayoutStore.setState({
      isLeftSidebarOpen: true,
      isRightInspectorOpen: true,
      isConsoleOpen: false,
      splitOrientation: "vertical",
      maximizedPanel: "none",
      jumpTarget: null,
    })
  })
  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  for (const tab of ["graph", "project", "templates", "copilot"] as ActivityTab[]) {
    it(`renders the full shell with the '${tab}' sidebar tab open`, () => {
      useLayoutStore.setState({ activeActivityTab: tab })
      const html = renderToStaticMarkup(<WorkspaceLayout />)
      for (const id of ["workspace-layout", "activity-bar", "status-bar", "center-stage", "right-inspector"]) {
        expect(html).toContain(`data-testid="${id}"`)
      }
    })
  }

  it("renders with the console open and a compile error present", () => {
    useLayoutStore.setState({ activeActivityTab: "graph", isConsoleOpen: true })
    useProjectStore.getState().setLastCompileError(":5:2 error: boom")
    const html = renderToStaticMarkup(<WorkspaceLayout />)
    expect(html).toContain("[Line 5:2]")
  })
})

// ============================================================================
// w2-c coverage: UniformNode persistence + MaterialNode "Open in Editor" (real components, effects/handlers captured)
// ============================================================================
import { UniformNode } from "@/components/nodes/UniformNode"
import { Input, Select, Button } from "@/components/ui"
import { MaterialNode } from "@/components/nodes/MaterialNode"

const reactFlowSpy = vi.hoisted(() => ({ updateNodeData: null as null | ((id: string, d: unknown) => void) }))
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    useReactFlow: (...args: unknown[]) =>
      reactFlowSpy.updateNodeData
        ? ({ updateNodeData: reactFlowSpy.updateNodeData } as unknown as ReturnType<typeof actual.useReactFlow>)
        : (actual.useReactFlow as (...a: unknown[]) => ReturnType<typeof actual.useReactFlow>)(...args),
  }
})

/** Renders a (memo-wrapped) node component's function once, capturing its effects, and returns its element tree. */
function mountNode(component: unknown, props: Record<string, unknown>) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
  const effects: Array<() => void | (() => void)> = []
  let tree: any = null
  const fn = (component as { type: (p: unknown) => unknown }).type
  function Interceptor() {
    const original = internals.H
    internals.H = { ...original, useEffect: (e: () => void | (() => void)) => void effects.push(e) }
    try { tree = fn(props) } finally { internals.H = original }
    return null
  }
  renderToStaticMarkup(React.createElement(Interceptor))
  const cleanups = () => effects.map((e) => e())
  return { tree, runEffects: cleanups }
}

function findElement(node: any, pred: (el: any) => boolean): any {
  if (!node || typeof node !== "object") return null
  if (Array.isArray(node)) { for (const c of node) { const r = findElement(c, pred); if (r) return r } return null }
  if (node.props && pred(node)) return node
  return node.props ? findElement(node.props.children, pred) : null
}

describe("w2-c: UniformNode persists name/type via node data and keeps the graph uniform until node deletion", () => {
  const update = vi.fn()
  beforeEach(() => {
    useProjectStore.getState().resetProject()
    update.mockClear()
    reactFlowSpy.updateNodeData = update
  })
  afterEach(() => { reactFlowSpy.updateNodeData = null })

  const props = (data: Record<string, unknown>) => ({ id: "n1", selected: false, data: { type: "uniform", ...data } })

  it("mount registers a graph uniform (id derived from the node id) with the node's name and type", () => {
    mountNode(UniformNode, props({ name: "speed", uniformType: "vec2" })).runEffects()
    expect(useProjectStore.getState().graphUniforms).toEqual([
      { id: "uniform_n1", name: "speed", type: "vec2", defaultValue: [0, 0] },
    ])
  })

  it.each([
    ["bool", false],
    ["float", 0.5],
    ["vec2", [0, 0]],
    ["vec4", [0.5, 0.5, 0.5, 1]],
    ["vec3", [0.5, 0.5, 0.5]],
    ["color", [0.5, 0.5, 0.5]],
  ])("a %s uniform without a stored default gets the type's default", (uniformType, expected) => {
    mountNode(UniformNode, props({ uniformType })).runEffects()
    expect(useProjectStore.getState().graphUniforms[0].defaultValue).toEqual(expected)
  })

  it("an explicit stored default value and uniformId are respected, and an unnamed node is called 'param'", () => {
    mountNode(UniformNode, props({ uniformId: "u_custom", defaultValue: 3 })).runEffects()
    expect(useProjectStore.getState().graphUniforms).toEqual([{ id: "u_custom", name: "param", type: "float", defaultValue: 3 }])
  })

  it("remount with changed name/type updates the existing uniform instead of duplicating it", () => {
    mountNode(UniformNode, props({ name: "a", uniformType: "float" })).runEffects()
    mountNode(UniformNode, props({ name: "b", uniformType: "vec3" })).runEffects()
    const us = useProjectStore.getState().graphUniforms
    expect(us).toHaveLength(1)
    expect(us[0]).toMatchObject({ id: "uniform_n1", name: "b", type: "vec3" })
  })

  it("unmounting (effect cleanup) does not remove the uniform", () => {
    const { runEffects } = mountNode(UniformNode, props({ name: "keep" }))
    const cleanups = runEffects()
    cleanups.forEach((c) => typeof c === "function" && c())
    expect(useProjectStore.getState().graphUniforms.map((u) => u.name)).toEqual(["keep"])
  })

  it("editing the name writes it to node data (so it survives save/load)", () => {
    const { tree } = mountNode(UniformNode, props({ name: "a" }))
    const input = findElement(tree, (el) => el.type === "input" || el.type === Input)
    input.props.onChange({ target: { value: "renamed" } })
    expect(update).toHaveBeenCalledWith("n1", { name: "renamed" })
  })

  it("changing the type writes type + default to node data and to the graph uniform", () => {
    const m = mountNode(UniformNode, props({ name: "a", uniformType: "float" }))
    m.runEffects()
    const select = findElement(m.tree, (el) => el.type === "select" || el.type === Select)
    select.props.onChange({ target: { value: "vec4" } })
    expect(update).toHaveBeenCalledWith("n1", { uniformType: "vec4", defaultValue: [0.5, 0.5, 0.5, 1] })
    expect(useProjectStore.getState().graphUniforms[0]).toMatchObject({ type: "vec4", defaultValue: [0.5, 0.5, 0.5, 1] })
  })
})

describe("w2-c: MaterialNode 'Open in Editor'", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject()
    useLayoutStore.setState({ jumpTarget: null, maximizedPanel: "none" })
  })
  const open = () => {
    const { tree } = mountNode(MaterialNode, { id: "m", selected: true, data: { type: "material", shaderPath: "a/b.wgsl" } })
    const btn = findElement(tree, (el) => el.type === "button" || el.type === Button)
    expect(btn).toBeTruthy()
    btn.props.onClick()
  }

  it("on WebGPU switches to the render tab and jumps to line 1", () => {
    useProjectStore.setState({ activeBackend: "webgpu", activeEditorTab: "compute" })
    open()
    expect(useProjectStore.getState().activeEditorTab).toBe("render")
    expect(useLayoutStore.getState().jumpTarget?.line).toBe(1)
  })

  it("on WebGL2 switches to the fragment tab and jumps to line 1", () => {
    useProjectStore.setState({ activeBackend: "webgl2", activeEditorTab: "vertex" })
    open()
    expect(useProjectStore.getState().activeEditorTab).toBe("fragment")
    expect(useLayoutStore.getState().jumpTarget?.line).toBe(1)
  })
})
