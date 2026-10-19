/**
 * Next-Gen E2E Test Infrastructure Harness — ShaderStudio (R1–R5)
 *
 * Implements authoritative contract validators, reference state engines, and
 * simulators for requirements R1–R5 specified in ORIGINAL_REQUEST.md,
 * PROJECT.md, and TEST_INFRA.md:
 * - R1: Node Graph Power-ups (@xyflow/react v12, Sub-graphs, Custom Node SDK, Math Expression, Live Preview, Comments/Frames)
 * - R2: Rendering Fidelity Parity (Deferred GBuffer, PCF/VSM Shadows, SSR, FXAA/TAA, Atmosphere, DoF, SSAO, Parity Harness)
 * - R3: Export & Ecosystem (UE5 HLSL, glTF 2.0, Blender OSL, npm Package, Shadertoy Import, R3F + Storybook)
 * - R4: Tauri v2 Desktop App (Native FS Save/Load, In-app MCP Bridge, Window/Tray/Menu, Binary Profile < 15MB)
 * - R5: Performance & Scale (GPU Profiler, Frame Timeline, Memory Budget, Mesh LOD 3-levels, Progressive Texture Streaming)
 */

import { vi } from "vitest"
import type {
  SubGraphPort,
  SubGraphDefinition,
  CustomNodeManifest,
  MathExpressionNodeData,
  GBufferTargets,
  ShadowMapConfig,
  RenderAdapter,
  DetailedGpuMetrics,
  MemoryBudgetConfig,
} from "@/adapters/types"
import { useProjectStore, type UniformValue, type ParsedUniform } from "@/stores/projectStore"
import {
  transpileToUE5 as coreTranspileToUE5,
  exportGltf2Material as coreExportGltf2Material,
  transpileToBlenderOSL as coreTranspileToBlenderOSL,
  generateNpmPackage as coreGenerateNpmPackage,
  importShadertoy as coreImportShadertoy,
  generateR3FExport as coreGenerateR3FExport,
} from "@/core/engineTranspiler"
import { PerformanceTelemetry } from "@/core/performanceTelemetry"
import { MemoryBudgetManager } from "@/core/memoryBudget"
import { generateMeshLods as coreGenerateMeshLods, selectLodByDistance as coreSelectLodByDistance } from "@/core/meshLod"
import { createTextureStreamer as coreCreateTextureStreamer } from "@/core/textureStreamer"

// ============================================================================
// 1. R1: Node Graph Power-ups Harness & Reference Models
// ============================================================================

export interface GraphNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, any>
  width?: number
  height?: number
  parentId?: string
}

export interface GraphEdge {
  id: string
  source: string
  sourceHandle?: string
  target: string
  targetHandle?: string
}

/**
 * Sub-graph library registry and compilation flattener
 */
export class SubGraphLibraryHarness {
  private library: Map<string, SubGraphDefinition> = new Map()
  public readonly MAX_NESTING_DEPTH = 8

  constructor() {
    this.registerBuiltIns()
  }

  private registerBuiltIns(): void {
    // 1. Fresnel Rim Lighting
    this.register({
      id: "builtin-fresnel-rim",
      name: "Fresnel Rim Lighting",
      description: "Calculates view-angle grazing rim lighting with power and tint",
      inputs: [
        { id: "in_normal", name: "normal", type: "vec3", direction: "input" },
        { id: "in_viewDir", name: "viewDir", type: "vec3", direction: "input" },
        { id: "in_power", name: "power", type: "float", direction: "input" },
        { id: "in_color", name: "color", type: "vec3", direction: "input" },
      ],
      outputs: [
        { id: "out_rimColor", name: "rimColor", type: "vec3", direction: "output" },
      ],
      nodes: [
        { id: "fn_dot", type: "math", position: { x: 100, y: 100 }, data: { operation: "dot" } },
        { id: "fn_clamp", type: "math", position: { x: 250, y: 100 }, data: { operation: "clamp", min: 0, max: 1 } },
        { id: "fn_inv", type: "math", position: { x: 400, y: 100 }, data: { operation: "oneMinus" } },
        { id: "fn_pow", type: "math", position: { x: 550, y: 100 }, data: { operation: "pow" } },
        { id: "fn_mul", type: "math", position: { x: 700, y: 100 }, data: { operation: "multiply" } },
      ],
      edges: [
        { id: "e1", source: "fn_dot", target: "fn_clamp" },
        { id: "e2", source: "fn_clamp", target: "fn_inv" },
        { id: "e3", source: "fn_inv", target: "fn_pow" },
        { id: "e4", source: "fn_pow", target: "fn_mul" },
      ],
      uniforms: [
        { name: "u_rimPower", type: "float", defaultValue: 3.0 },
        { name: "u_rimColor", type: "vec3", defaultValue: [0.2, 0.6, 1.0] },
      ],
    })

    // 2. Noise Generator
    this.register({
      id: "builtin-noise-gen",
      name: "Noise Generator",
      description: "Multi-octave procedural simplex/perlin noise generator",
      inputs: [
        { id: "in_uv", name: "uv", type: "vec2", direction: "input" },
        { id: "in_scale", name: "scale", type: "float", direction: "input" },
        { id: "in_octaves", name: "octaves", type: "float", direction: "input" },
      ],
      outputs: [
        { id: "out_noise", name: "noiseValue", type: "float", direction: "output" },
      ],
      nodes: [
        { id: "n_scale", type: "math", position: { x: 100, y: 100 }, data: { operation: "multiply" } },
        { id: "n_noise", type: "noise", position: { x: 300, y: 100 }, data: { noiseType: "simplex" } },
      ],
      edges: [{ id: "ne1", source: "n_scale", target: "n_noise" }],
      uniforms: [
        { name: "u_noiseScale", type: "float", defaultValue: 5.0 },
        { name: "u_octaves", type: "float", defaultValue: 4.0 },
      ],
    })

    // 3. UV Distortion
    this.register({
      id: "builtin-uv-distortion",
      name: "UV Distortion",
      description: "Distorts base UV coordinates using a vector texture or procedural map",
      inputs: [
        { id: "in_uv", name: "uv", type: "vec2", direction: "input" },
        { id: "in_distortMap", name: "distortionMap", type: "vec2", direction: "input" },
        { id: "in_strength", name: "strength", type: "float", direction: "input" },
      ],
      outputs: [
        { id: "out_distortedUv", name: "distortedUv", type: "vec2", direction: "output" },
      ],
      nodes: [
        { id: "d_mul", type: "math", position: { x: 100, y: 100 }, data: { operation: "multiply" } },
        { id: "d_add", type: "math", position: { x: 300, y: 100 }, data: { operation: "add" } },
      ],
      edges: [{ id: "de1", source: "d_mul", target: "d_add" }],
      uniforms: [
        { name: "u_distortStrength", type: "float", defaultValue: 0.1 },
      ],
    })
  }

  register(def: SubGraphDefinition): void {
    if (!def.id || !def.name) {
      throw new Error("Sub-graph definition must have a valid id and name")
    }
    this.library.set(def.id, def)
  }

  get(id: string): SubGraphDefinition | undefined {
    return this.library.get(id)
  }

  has(id: string): boolean {
    return this.library.has(id)
  }

  remove(id: string): boolean {
    return this.library.delete(id)
  }

  list(): SubGraphDefinition[] {
    return Array.from(this.library.values())
  }

  /**
   * Detects recursive cycles in nested sub-graphs using depth-first search
   */
  detectCycle(subGraphId: string, visited: Set<string> = new Set()): boolean {
    if (visited.has(subGraphId)) {
      return true
    }
    const def = this.get(subGraphId)
    if (!def) return false

    visited.add(subGraphId)

    for (const node of def.nodes) {
      if (node.type === "subgraph") {
        const childId = node.data?.subGraphId
        if (childId) {
          if (this.detectCycle(childId, new Set(visited))) {
            return true
          }
        }
      }
    }

    return false
  }

  /**
   * Calculates the maximum nesting depth of a sub-graph
   */
  getNestingDepth(subGraphId: string, currentDepth = 1, visited: Set<string> = new Set()): number {
    if (visited.has(subGraphId)) {
      throw new Error(`Cycle detected involving sub-graph "${subGraphId}"`)
    }
    visited.add(subGraphId)

    const def = this.get(subGraphId)
    if (!def) return currentDepth

    let maxChildDepth = currentDepth
    for (const node of def.nodes) {
      if (node.type === "subgraph") {
        const childId = node.data?.subGraphId
        if (childId) {
          const depth = this.getNestingDepth(childId, currentDepth + 1, new Set(visited))
          if (depth > maxChildDepth) {
            maxChildDepth = depth
          }
        }
      }
    }
    return maxChildDepth
  }

  /**
   * Flattens a graph containing sub-graphs recursively, namespacing uniforms and mapping ports
   */
  flattenGraph(
    nodes: GraphNode[],
    edges: GraphEdge[],
    parentDepth = 0,
    prefix = ""
  ): { nodes: GraphNode[]; edges: GraphEdge[]; uniforms: Record<string, any> } {
    if (parentDepth > this.MAX_NESTING_DEPTH) {
      throw new Error(`Sub-graph nesting exceeded maximum limit of ${this.MAX_NESTING_DEPTH} levels`)
    }

    const flatNodes: GraphNode[] = []
    const flatEdges: GraphEdge[] = [...edges]
    const flatUniforms: Record<string, any> = {}

    for (const node of nodes) {
      if (node.type === "subgraph") {
        const subGraphId = node.data?.subGraphId
        const def = this.get(subGraphId)
        if (!def) {
          throw new Error(`Sub-graph "${subGraphId}" not found in library`)
        }

        if (this.detectCycle(subGraphId)) {
          throw new Error(`Cannot flatten sub-graph "${subGraphId}": infinite recursion cycle detected`)
        }

        const currentNesting = this.getNestingDepth(subGraphId, parentDepth + 1)
        if (currentNesting > this.MAX_NESTING_DEPTH) {
          throw new Error(`Sub-graph nesting depth ${currentNesting} exceeds maximum limit of ${this.MAX_NESTING_DEPTH}`)
        }

        const subPrefix = prefix ? `${prefix}_${node.id}` : node.id

        // Namespace sub-graph uniforms
        if (def.uniforms) {
          for (const u of def.uniforms) {
            const namespacedName = `sg_${subPrefix}_${u.name}`
            flatUniforms[namespacedName] = node.data?.uniformOverrides?.[u.name] ?? u.defaultValue
          }
        }

        // Recursively flatten inner nodes
        const innerFlattened = this.flattenGraph(
          def.nodes.map((n) => ({
            ...n,
            id: `${subPrefix}_${n.id}`,
          })),
          def.edges.map((e) => ({
            ...e,
            id: `${subPrefix}_${e.id}`,
            source: `${subPrefix}_${e.source}`,
            target: `${subPrefix}_${e.target}`,
          })),
          parentDepth + 1,
          subPrefix
        )

        flatNodes.push(...innerFlattened.nodes)
        flatEdges.push(...innerFlattened.edges)
        Object.assign(flatUniforms, innerFlattened.uniforms)

        // Rewire external edges connected to this sub-graph node
        for (let i = 0; i < flatEdges.length; i++) {
          const edge = flatEdges[i]
          if (edge.target === node.id && edge.targetHandle) {
            // Find inner port mapping
            const innerTarget = `${subPrefix}_${def.nodes[0]?.id || "in"}`
            flatEdges[i] = { ...edge, target: innerTarget }
          }
          if (edge.source === node.id && edge.sourceHandle) {
            const innerSource = `${subPrefix}_${def.nodes[def.nodes.length - 1]?.id || "out"}`
            flatEdges[i] = { ...edge, source: innerSource }
          }
        }
      } else {
        flatNodes.push(node)
      }
    }

    return { nodes: flatNodes, edges: flatEdges, uniforms: flatUniforms }
  }
}

/**
 * Custom Node SDK Manifest Validator and Runtime Registry
 */
export class CustomNodeSdkHarness {
  private registry: Map<string, CustomNodeManifest> = new Map()
  private customComponents: Map<string, any> = new Map()

  validateManifest(manifest: any): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    if (!manifest) {
      return { valid: false, errors: ["Manifest cannot be empty"] }
    }
    if (!manifest.type || typeof manifest.type !== "string") {
      errors.push("Missing or invalid field: type (string required)")
    }
    if (!manifest.title || typeof manifest.title !== "string") {
      errors.push("Missing or invalid field: title (string required)")
    }
    const validCategories = ["math", "filter", "generator", "utility", "custom"]
    if (!manifest.category || !validCategories.includes(manifest.category)) {
      errors.push(`Invalid category: ${manifest.category}. Must be one of ${validCategories.join(", ")}`)
    }
    if (!Array.isArray(manifest.inputs)) {
      errors.push("Missing or invalid field: inputs (array required)")
    }
    if (!Array.isArray(manifest.outputs)) {
      errors.push("Missing or invalid field: outputs (array required)")
    }
    if (manifest.parameters) {
      if (!Array.isArray(manifest.parameters)) {
        errors.push("parameters must be an array")
      } else {
        manifest.parameters.forEach((param: any, idx: number) => {
          if (!param.name) errors.push(`Parameter #${idx} missing name`)
          const validTypes = ["float", "vec2", "vec3", "vec4", "color", "boolean"]
          if (!validTypes.includes(param.type)) {
            errors.push(`Parameter ${param.name || idx} has invalid type: ${param.type}`)
          }
        })
      }
    }
    if (!manifest.glsl && !manifest.wgsl) {
      errors.push("Custom node manifest must provide either 'glsl' or 'wgsl' shader snippet")
    }

    return { valid: errors.length === 0, errors }
  }

  registerCustomNode(manifest: CustomNodeManifest, customUiComponent?: any): void {
    const check = this.validateManifest(manifest)
    if (!check.valid) {
      throw new Error(`Invalid custom node manifest: ${check.errors.join("; ")}`)
    }
    this.registry.set(manifest.type, manifest)
    if (customUiComponent) {
      this.customComponents.set(manifest.type, customUiComponent)
    }
  }

  get(type: string): CustomNodeManifest | undefined {
    return this.registry.get(type)
  }

  getComponent(type: string): any | undefined {
    return this.customComponents.get(type)
  }

  list(): CustomNodeManifest[] {
    return Array.from(this.registry.values())
  }

  discoverFromDirectory(files: Record<string, string>): { loaded: number; errors: Record<string, string[]> } {
    let loaded = 0
    const errors: Record<string, string[]> = {}

    for (const [filepath, content] of Object.entries(files)) {
      if (filepath.endsWith(".json")) {
        try {
          const parsed = JSON.parse(content)
          const validation = this.validateManifest(parsed)
          if (validation.valid) {
            this.registerCustomNode(parsed)
            loaded++
          } else {
            errors[filepath] = validation.errors
          }
        } catch (e: any) {
          errors[filepath] = [`JSON parse error: ${e.message}`]
        }
      }
    }

    return { loaded, errors }
  }
}

/**
 * Math Expression AST, Live Validator, and GLSL/WGSL Codegen
 */
export class MathExpressionHarness {
  public static readonly ALLOWED_FUNCTIONS = new Set([
    "sin", "cos", "tan", "asin", "acos", "atan",
    "pow", "exp", "log", "exp2", "log2", "sqrt", "inversesqrt",
    "abs", "sign", "floor", "ceil", "fract", "mod",
    "min", "max", "clamp", "mix", "step", "smoothstep",
    "length", "distance", "dot", "cross", "normalize",
  ])

  validate(expression: string, allowedInputs: string[] = ["uv", "time"]): { valid: boolean; error: string | null } {
    if (!expression || !expression.trim()) {
      return { valid: false, error: "Expression cannot be empty" }
    }

    // Check matching parentheses
    let balance = 0
    for (let i = 0; i < expression.length; i++) {
      if (expression[i] === "(") balance++
      else if (expression[i] === ")") {
        balance--
        if (balance < 0) return { valid: false, error: `Unmatched closing parenthesis at position ${i}` }
      }
    }
    if (balance !== 0) {
      return { valid: false, error: "Unclosed opening parenthesis in expression" }
    }

    // Tokenize identifiers and check against functions & inputs
    const identifierRegex = /\b[a-zA-Z_][a-zA-Z0-9_]*(\.[xyzw]{1,4})?\b/g
    const matches = expression.match(identifierRegex) || []

    for (const match of matches) {
      const baseName = match.split(".")[0]
      if (
        !MathExpressionHarness.ALLOWED_FUNCTIONS.has(baseName) &&
        !allowedInputs.includes(baseName) &&
        !["vec2", "vec3", "vec4", "float", "int"].includes(baseName)
      ) {
        return {
          valid: false,
          error: `Unrecognized identifier or function '${baseName}'. Allowed inputs: ${allowedInputs.join(", ")}`,
        }
      }
    }

    // Check invalid operator sequences (e.g. `++`, `**`, `//`)
    if (/[+*/-]{2,}/.test(expression)) {
      return { valid: false, error: "Invalid operator sequence in expression" }
    }

    return { valid: true, error: null }
  }

  generateGLSL(
    expression: string,
    outputType: "float" | "vec2" | "vec3" | "vec4" = "float",
    allowedInputs: string[] = ["uv", "time", "u_time", "u_resolution"]
  ): string {
    const validation = this.validate(expression, allowedInputs)
    if (!validation.valid) {
      throw new Error(`Cannot generate GLSL: ${validation.error}`)
    }
    return `${outputType} result = ${expression};`
  }

  generateWGSL(
    expression: string,
    outputType: "float" | "vec2" | "vec3" | "vec4" = "float",
    allowedInputs: string[] = ["uv", "time", "u_time", "u_resolution"]
  ): string {
    const validation = this.validate(expression, allowedInputs)
    if (!validation.valid) {
      throw new Error(`Cannot generate WGSL: ${validation.error}`)
    }
    const wgslType = outputType === "float" ? "f32" : `${outputType}f`
    return `let result: ${wgslType} = ${expression};`
  }
}

/**
 * Per-Node Live Preview Isolator
 */
export class PerNodePreviewHarness {
  private selectedNodeId: string | null = null
  private renderCache: Map<string, string> = new Map()

  selectNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId
  }

  getSelectedNode(): string | null {
    return this.selectedNodeId
  }

  generateIsolatedShader(nodeId: string, node: GraphNode): string {
    if (!node) {
      throw new Error(`Node ${nodeId} does not exist`)
    }
    // Generates an isolated shader pipeline isolating this node's output to gl_FragColor / @location(0)
    const isolated = `
// Isolated Mini-Viewport Pipeline for Node: ${nodeId} (${node.type})
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  // Evaluates node: ${node.type}
  vec4 nodeOutput = vec4(v_uv, 0.5, 1.0);
  fragColor = nodeOutput;
}
`
    this.renderCache.set(nodeId, isolated)
    return isolated
  }

  getCachedRender(nodeId: string): string | undefined {
    return this.renderCache.get(nodeId)
  }
}

/**
 * Annotation Nodes (Comments & Frames) Handler
 */
export class AnnotationNodesHarness {
  isAnnotationNode(node: GraphNode): boolean {
    return node.type === "comment" || node.type === "frame"
  }

  filterForCompilation(nodes: GraphNode[]): GraphNode[] {
    // Annotation nodes do NOT affect shader compilation and are excluded
    return nodes.filter((n) => !this.isAnnotationNode(n))
  }

  isContainedInFrame(node: GraphNode, frame: GraphNode): boolean {
    if (frame.type !== "frame" || !frame.width || !frame.height) return false
    const nX = node.position.x
    const nY = node.position.y
    const fX = frame.position.x
    const fY = frame.position.y
    const fW = frame.width
    const fH = frame.height

    return nX >= fX && nX <= fX + fW && nY >= fY && nY <= fY + fH
  }
}

// ============================================================================
// 2. R2: Rendering Fidelity Multi-Backend Parity Harness & Models
// ============================================================================

export interface MultiBackendParityState {
  pipelineMode: "forward" | "deferred"
  gBufferTargets: GBufferTargets | null
  shadowConfig: ShadowMapConfig
  pointShadowCubeEnabled: boolean
  postProcessState: {
    fxaa: { enabled: boolean }
    taa: { enabled: boolean; jitterSample: [number, number]; motionVectorClamp: boolean }
    dof: { enabled: boolean; focalDistance: number; aperture: number; bokehShape: "circle" | "hexagon" }
    ssao: { enabled: boolean; radius: number; intensity: number; sampleCount: number }
    ssr: { enabled: boolean; maxSteps: number; thickness: number; falloff: number; iblBlend: number }
  }
  atmosphereParams: {
    timeOfDay: number // 0 - 24 hours
    sunIntensity: number
    turbidity: number
    solarElevationDeg: number
  }
}

export class RenderingPipelineHarness implements RenderAdapter {
  readonly backendType: "webgpu" | "webgl2" | "threejs"
  public state: MultiBackendParityState

  constructor(backend: "webgpu" | "webgl2" | "threejs" = "webgpu") {
    this.backendType = backend
    this.state = {
      pipelineMode: "forward",
      gBufferTargets: null,
      shadowConfig: {
        resolution: 2048,
        filtering: "pcf",
        bias: 0.005,
        normalBias: 0.01,
      },
      pointShadowCubeEnabled: false,
      postProcessState: {
        fxaa: { enabled: false },
        taa: { enabled: false, jitterSample: [0, 0], motionVectorClamp: true },
        dof: { enabled: false, focalDistance: 5.0, aperture: 0.05, bokehShape: "circle" },
        ssao: { enabled: false, radius: 0.5, intensity: 1.5, sampleCount: 16 },
        ssr: { enabled: false, maxSteps: 64, thickness: 0.02, falloff: 0.8, iblBlend: 0.5 },
      },
      atmosphereParams: {
        timeOfDay: 12.0,
        sunIntensity: 1.0,
        turbidity: 2.5,
        solarElevationDeg: 90.0,
      },
    }
  }

  async mount(canvas: HTMLCanvasElement): Promise<boolean> {
    return true
  }

  setRenderQueue(queue: any): void {}
  recompileShader(source: string): void {}
  updateUniform(name: string, value: UniformValue): void {}
  resize(width: number, height: number, dpr?: number): void {}
  dispose(): void {}

  setRenderingPipelineMode(mode: "forward" | "deferred"): void {
    this.state.pipelineMode = mode
    if (mode === "deferred") {
      this.state.gBufferTargets = {
        albedo: { format: "rgba8unorm", width: 1920, height: 1080 },
        normal: { format: "rgba16float", width: 1920, height: 1080 },
        roughnessMetallic: { format: "rg8unorm", width: 1920, height: 1080 },
        depth: { format: "depth24plus-stencil8", width: 1920, height: 1080 },
        motionVectors: { format: "rg16float", width: 1920, height: 1080 },
      }
    } else {
      this.state.gBufferTargets = null
    }
  }

  getGBufferTextures(): GBufferTargets | null {
    return this.state.gBufferTargets
  }

  setShadowConfig(config: Partial<ShadowMapConfig>): void {
    if (config.resolution && ![512, 1024, 2048, 4096].includes(config.resolution)) {
      throw new Error(`Invalid shadow resolution ${config.resolution}. Supported: 512, 1024, 2048, 4096`)
    }
    this.state.shadowConfig = { ...this.state.shadowConfig, ...config }
  }

  setPointLightShadowCube(enabled: boolean): void {
    this.state.pointShadowCubeEnabled = enabled
  }

  setPostProcessEnabled(
    pass: "fxaa" | "taa" | "dof" | "ssao" | "ssr",
    enabled: boolean,
    params?: any
  ): void {
    if (this.state.postProcessState[pass]) {
      this.state.postProcessState[pass].enabled = enabled
      if (params) {
        Object.assign(this.state.postProcessState[pass], params)
      }
    }
  }

  setAtmosphereParams(params: { timeOfDay: number; sunIntensity?: number; turbidity?: number }): void {
    const tod = Math.max(0, Math.min(24, params.timeOfDay))
    // Calculate solar elevation angle: 0 at sunrise/sunset (~6h and 18h), 90 deg at noon (12h)
    const solarElevation = Math.max(0, Math.sin(((tod - 6) / 12) * Math.PI) * 90)

    this.state.atmosphereParams = {
      timeOfDay: tod,
      sunIntensity: params.sunIntensity ?? this.state.atmosphereParams.sunIntensity,
      turbidity: params.turbidity ?? this.state.atmosphereParams.turbidity,
      solarElevationDeg: solarElevation,
    }
  }

  calculateRayleighMieScattering(wavelengthNm = [680, 550, 440]): { rayleigh: number[]; mie: number } {
    // Rayleigh scattering is inversely proportional to wavelength^4
    const rayleigh = wavelengthNm.map((lambda) => {
      const lambdaUm = lambda / 1000.0
      return 0.008 * Math.pow(lambdaUm, -4)
    })
    // Mie scattering aerosol turbidity
    const mie = 0.002 * this.state.atmosphereParams.turbidity
    return { rayleigh, mie }
  }
}

// ============================================================================
// 3. R3: Export & Ecosystem Expansion Harness
// ============================================================================

export class EngineTranspilerHarness {
  transpileToUE5(shaderSource: string, uniforms: ParsedUniform[]): {
    customExpressionHLSL: string
    materialFunctionHLSL: string
    parameters: Array<{ name: string; type: string; ue5Type: string }>
  } {
    return coreTranspileToUE5(shaderSource, uniforms)
  }

  exportGltf2Material(materialName: string, unlit = false): {
    gltfJson: Record<string, any>
    extensionsUsed: string[]
  } {
    return coreExportGltf2Material(materialName, unlit)
  }

  transpileToBlenderOSL(shaderSource: string, uniforms: ParsedUniform[]): string {
    return coreTranspileToBlenderOSL(shaderSource, uniforms)
  }

  generateNpmPackage(packageName: string, shaderSource: string): {
    packageJson: Record<string, any>
    indexTs: string
  } {
    return coreGenerateNpmPackage(packageName, shaderSource)
  }

  importShadertoy(code: string): {
    convertedSource: string
    mappedUniforms: Record<string, string>
    channels: number[]
  } {
    return coreImportShadertoy(code)
  }

  generateR3FExport(materialName: string): string {
    return coreGenerateR3FExport(materialName)
  }
}

// ============================================================================
// 4. R4: Tauri v2 Desktop Bridge Simulator & Models
// ============================================================================

export class TauriDesktopHarness {
  private fileSystem: Map<string, string> = new Map()
  private mcpBridgeRunning = false
  private mcpBridgePort = 0
  private windowState = { minimized: false, maximized: false, closed: false }
  private trayCreated = false

  async save_project_native(path: string | undefined, projectJson: string): Promise<string> {
    const targetPath = path || "C:/Users/binit/Documents/ShaderStudio/untitled.shaderstudio"
    if (!targetPath.endsWith(".shaderstudio")) {
      throw new Error("File extension must be .shaderstudio")
    }
    this.fileSystem.set(targetPath, projectJson)
    return targetPath
  }

  async load_project_native(path: string | undefined): Promise<[string, string]> {
    const targetPath = path || Array.from(this.fileSystem.keys())[0]
    if (!targetPath || !this.fileSystem.has(targetPath)) {
      throw new Error(`File not found: ${targetPath}`)
    }
    return [targetPath, this.fileSystem.get(targetPath)!]
  }

  async start_mcp_bridge(port: number): Promise<string> {
    if (port <= 1024 || port > 65535) {
      throw new Error(`Invalid port: ${port}. Must be between 1025 and 65535`)
    }
    this.mcpBridgeRunning = true
    this.mcpBridgePort = port
    return `MCP Bridge active on port ${port}`
  }

  async get_mcp_bridge_status(): Promise<boolean> {
    return this.mcpBridgeRunning
  }

  stop_mcp_bridge(): void {
    this.mcpBridgeRunning = false
    this.mcpBridgePort = 0
  }

  minimizeWindow(): void {
    this.windowState.minimized = true
  }

  maximizeWindow(): void {
    this.windowState.maximized = !this.windowState.maximized
  }

  closeWindow(): void {
    this.windowState.closed = true
  }

  setupTray(): void {
    this.trayCreated = true
  }

  isTrayActive(): boolean {
    return this.trayCreated
  }

  validateBinarySizeConfig(cargoToml: string): { valid: boolean; flags: string[] } {
    const requiredSettings = [
      'opt-level = "z"',
      "lto = true",
      "codegen-units = 1",
      'panic = "abort"',
      "strip = true",
    ]
    const missing = requiredSettings.filter((s) => !cargoToml.includes(s))
    return {
      valid: missing.length === 0,
      flags: requiredSettings,
    }
  }
}

// ============================================================================
// 5. R5: Performance & Scale Profiler & Models
// ============================================================================

export class PerformanceScaleHarness {
  private telemetry = new PerformanceTelemetry()
  private memoryBudgetManager = new MemoryBudgetManager()

  recordFrameTime(ms: number): void {
    this.telemetry.recordFrameTime(ms)
  }

  getTimeline(): number[] {
    return this.telemetry.getTimeline()
  }

  getAverageFps(): number {
    return this.telemetry.getAverageFps()
  }

  setMemoryBudget(config: Partial<MemoryBudgetConfig>): void {
    this.memoryBudgetManager.setConfig(config)
  }

  getMemoryBudget(): MemoryBudgetConfig {
    return this.memoryBudgetManager.getConfig()
  }

  checkMemoryThreshold(usage: { textureMB: number; geometryMB: number; totalVramMB: number }): {
    textureWarning: boolean
    geometryWarning: boolean
    totalVramWarning: boolean
    hasAnyWarning: boolean
  } {
    return this.memoryBudgetManager.checkMemoryThreshold(usage)
  }

  /**
   * Mesh LOD generator: decimate vertex count into 3 levels based on distance
   */
  generateMeshLods(vertexCount: number): { lod0: number; lod1: number; lod2: number } {
    return coreGenerateMeshLods(vertexCount)
  }

  selectLodByDistance(distance: number, thresholds = { lod0Dist: 10, lod1Dist: 30 }): "lod0" | "lod1" | "lod2" {
    return coreSelectLodByDistance(distance, thresholds)
  }

  /**
   * Progressive Texture Streaming simulator
   */
  createTextureStreamer(): {
    loadMipmapProgressive: (
      url: string,
      onMipLoaded: (level: number, resolution: [number, number]) => void
    ) => Promise<boolean>
  } {
    return coreCreateTextureStreamer()
  }
}

// ============================================================================
// Combined Workstation Test Harness Factory
// ============================================================================

export interface NextGenWorkstationHarness {
  subgraphs: SubGraphLibraryHarness
  customNodes: CustomNodeSdkHarness
  mathExpr: MathExpressionHarness
  livePreview: PerNodePreviewHarness
  annotations: AnnotationNodesHarness
  rendering: {
    webgpu: RenderingPipelineHarness
    webgl2: RenderingPipelineHarness
    threejs: RenderingPipelineHarness
  }
  transpiler: EngineTranspilerHarness
  desktop: TauriDesktopHarness
  perf: PerformanceScaleHarness
}

export function createNextGenWorkstationHarness(): NextGenWorkstationHarness {
  return {
    subgraphs: new SubGraphLibraryHarness(),
    customNodes: new CustomNodeSdkHarness(),
    mathExpr: new MathExpressionHarness(),
    livePreview: new PerNodePreviewHarness(),
    annotations: new AnnotationNodesHarness(),
    rendering: {
      webgpu: new RenderingPipelineHarness("webgpu"),
      webgl2: new RenderingPipelineHarness("webgl2"),
      threejs: new RenderingPipelineHarness("threejs"),
    },
    transpiler: new EngineTranspilerHarness(),
    desktop: new TauriDesktopHarness(),
    perf: new PerformanceScaleHarness(),
  }
}
