# SHADER STUDIO - PHASE 4: MULTI-BACKEND ADAPTERS, REAL POST-PROCESSING & POLISH

> **CONTEXT:** WebGPU, the node graph, and code sync are all working. Add WebGL2 and Three.js backends, make post-processing actually process (not pass-through), and add the remaining v1 polish features from the master brief.

## 1. EXACT FILES TO ADD/MODIFY
```text
src/
├── adapters/
│   ├── types.ts                  # NEW: Minimal shared types
│   ├── webgl2.ts                 # NEW: WebGL2 adapter (GLSL ES 3.00)
│   └── threejs.ts                # NEW: Three.js adapter
├── shaders/default.glsl          # NEW: Default GLSL shaders
├── components/
│   ├── PerfOverlay.tsx           # NEW: FPS / frame time
│   └── ProjectPanel.tsx          # NEW: save / load / export
├── core/
│   └── postProcessChain.ts       # NEW: ping-pong render-target logic per backend
└── package.json                  # MODIFY: add three
```

## 2. SHARED ADAPTER TYPES (`adapters/types.ts`)
**CRITICAL (unchanged from master brief):** DO NOT build a "Renderer" base class. WebGPU and WebGL2 execution models are incompatible.
- Define a loose type: `{ mount, render, updateUniforms, dispose, compile }`.
- Each adapter implements this independently.

## 3. WEBGL2 ADAPTER (`adapters/webgl2.ts`)
- Get `webgl2` context (`alpha: false, antialias: true`).
- Ingest the `RenderQueue` from `graphCompiler.ts`.
- Compile GLSL ES 3.00 (`#version 300 es`). Build VAO/VBO for cube/sphere/plane per the graph.
- Query uniform locations; render loop uses `gl.uniform1f`, etc.
- Handle `webglcontextlost` / `webglcontextrestored` events — stop the render loop on loss, re-initialize buffers/programs on restore, without a page reload.
- `dispose()`: delete programs, buffers, VAOs.

## 4. THREE.JS ADAPTER (`adapters/threejs.ts`)
- Initialize `THREE.WebGLRenderer`.
- Ingest the `RenderQueue`. Map MeshNode → `THREE.Mesh` + `THREE.BoxGeometry` (etc). Map MaterialNode → `THREE.ShaderMaterial`, feeding it the GLSL source.
- `updateUniforms()`: directly mutate `material.uniforms[name].value`.
- `dispose()`: dispose geometries, materials, renderer.

## 5. REAL POST-PROCESSING (`core/postProcessChain.ts`)
No more pass-through — this is the real implementation.
- **WebGPU/WebGL2:** implement ping-pong render targets/framebuffers. Each PostProcessNode in the compiled queue reads the previous target and writes to the next; the final pass writes to the canvas/swap-chain.
- **Three.js:** use `EffectComposer` + `ShaderPass` per PostProcessNode.
- Ship at least one working built-in pass (e.g. a simple gaussian blur or vignette) as proof the chain works end-to-end. Custom user post-process shaders plug into the same chain the same way a MaterialNode does.

## 6. BACKEND SWITCHING (App.tsx / Viewport.tsx)
- Toolbar dropdown: `[WebGPU ▼] → [WebGL2] → [Three.js]`.
- On change:
  1. Call `adapter.dispose()` on the current adapter.
  2. Update `projectStore.backend`.
  3. Viewport re-renders, instantiates the new adapter, passes the existing `RenderQueue` to it.
  4. Editor (Monaco or synced file view) switches language mode based on backend (WGSL for WebGPU, GLSL for WebGL2/Three.js), pointing at that MaterialNode's per-backend source file.
- No page reload; graph and parameter state persist across the switch.

## 7. PERF OVERLAY & EXPORT
- `PerfOverlay.tsx`: rolling FPS + frame time (ms), toggleable, computed from `requestAnimationFrame` deltas.
- Screenshot: a button calls `canvas.toBlob()` and downloads a PNG of the current frame.
- `ProjectPanel.tsx`: serialize the graph (nodes/edges from React Flow), uniform values, and file references via Dexie (IndexedDB); "Save project" / "Load project" / "Export as JSON" actions.

## 8. ACCEPTANCE CRITERIA
- User can switch WebGPU → WebGL2 → Three.js; the scene renders correctly in each using that backend's own shader source, with no graph or parameter loss.
- A PostProcessNode visibly alters the output (e.g. blur is visibly applied) — not a no-op.
- WebGL2 context loss/restore recovers without a page reload.
- Perf overlay updates live; screenshot button downloads a real PNG.
- Saving a project, reloading the page, and loading the project restores the same graph and parameter values.
- If WebGL2/Three.js fails to compile a shader, ErrorPanel shows the error without crashing the app.
