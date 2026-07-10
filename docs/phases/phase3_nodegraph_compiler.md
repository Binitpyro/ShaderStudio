# SHADER STUDIO - PHASE 3: NODE GRAPH & GRAPH COMPILER

> **CONTEXT:** Phases 1-2 (WebGPU, resize/device-loss handling, code sync, parameters) are working. Now replace the Left Panel placeholder with a React Flow node graph covering the full node set needed for freeform composition, not just mesh+material.

## 1. EXACT FILES TO ADD/MODIFY
```text
src/
├── components/
│   ├── NodeGraph.tsx             # NEW: React Flow canvas
│   └── nodes/
│       ├── MeshNode.tsx          # NEW: Geometry selector
│       ├── MaterialNode.tsx      # NEW: Links to shader file
│       ├── TextureNode.tsx       # NEW: Image asset → texture binding
│       ├── UniformNode.tsx       # NEW: Manually exposed custom parameter
│       ├── TimeNode.tsx          # NEW: Emits elapsed time
│       ├── PostProcessNode.tsx   # NEW: Render target chain (pass-through this phase)
│       └── OutputNode.tsx        # NEW: Marks the terminal render target
├── core/graphCompiler.ts         # NEW: Converts visual graph to execution queue
└── package.json                  # MODIFY: add reactflow
```

## 2. NODE SET (all seven must exist this phase, even where behavior is minimal)
- **MeshNode**: 1 output. Dropdown: Cube / Sphere / Plane.
- **MaterialNode**: 1 input (mesh), 1 output. Shows the active shader's filename; clicking it opens that file in the Phase 2 editor pane (jump-to-code, don't duplicate editing UI in the node itself).
- **TextureNode**: 1 output. Drag-and-drop an image onto the node; on drop, load it as a texture resource keyed by an id. Its output feeds a texture/sampler binding on a connected MaterialNode (matches the texture heuristic from Phase 2 §3).
- **UniformNode**: 1 output. Freeform name + type (float/vec3/bool) + default value. Lets the user expose a custom control in the Parameter Panel before it's wired into any shader code — useful for staging a value.
- **TimeNode**: 1 output, no configuration. Always emits elapsed seconds; wire into any material needing a time-based uniform (e.g. `u_time`).
- **PostProcessNode**: 1 input, 1 output (chainable, so multiple can be stacked). This phase: pass-through only — real framebuffer implementation lands in Phase 4.
- **OutputNode**: 1 input, 0 outputs. Marks the terminal node the compiler renders to screen. Exactly one OutputNode must exist in a valid graph.

## 3. STATE RULE (unchanged from original spec, still critical)
React Flow's internal state (nodes, edges, viewport pan/zoom) MUST stay inside React Flow. Do NOT mirror node positions or edges into Zustand.

## 4. GRAPH COMPILER (`core/graphCompiler.ts`)
**CRITICAL:** Do not render directly from React Flow state — it's visual, not execution-ready.
- `compileGraph(nodes, edges): RenderQueue`. Topologically sort by walking backward from the single OutputNode.
- Nodes not connected (directly or transitively) to the OutputNode are excluded from the queue — dead/scratch branches are allowed in the graph but ignored at render time.
- Emit a flat array of typed steps, e.g.:
  `[{type:'mesh', geometry:'cube'}, {type:'texture', id:'tex_0', src:'...'}, {type:'material', shader:'default.wgsl', bindings:{...}}, {type:'postprocess', pass:'passthrough'}]`
- **Validation, surfaced in ErrorPanel (not console-only):** exactly one OutputNode exists ("no output node" / "multiple output nodes" errors); every MaterialNode has an incoming MeshNode.
- Export `compileGraph`.

## 5. ADAPTER INTEGRATION
- Modify `adapters/webgpu.ts` to accept the `RenderQueue` instead of hardcoded cube logic.
- Adapter loops through the queue: sets up VBOs for the requested mesh, binds any texture steps, applies the material, renders.
- `PostProcessNode` steps just pass through to the screen this phase (no real framebuffers yet — Phase 4).

## 6. ACCEPTANCE CRITERIA
- All seven node types are placeable from a palette and connectable per their input/output rules.
- A minimal valid graph (Mesh → Material → Output) renders identically to Phase 2's hardcoded cube.
- Dropping an image on a TextureNode and wiring it to a MaterialNode's sampler binding shows the texture in the viewport.
- A UniformNode's value appears as a live control in the Parameter Panel.
- Removing the OutputNode (or adding a second one) shows a clear compiler error in ErrorPanel; the app doesn't crash.
- Changing the MeshNode dropdown updates geometry in the viewport; deleting a node or edge updates the render loop without crashing.
