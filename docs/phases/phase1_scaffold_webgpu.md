# SHADER STUDIO - PHASE 1: CORE WEBGPU & LAYOUT

> **ROLE:** You are a senior graphics engineer. We are building "Shader Studio", a browser-based shader compositor. Building iteratively to avoid context limits. See the master brief for full project context and architecture rules.

## GOAL FOR THIS STEP
Build the Vite/React scaffold, the resizable UI layout, Zustand state, and a robust Raw WebGPU adapter that renders an auto-rotating cube, correctly handling canvas resize and device loss.

## 1. EXACT FILE STRUCTURE (Generate ONLY these files)
```text
src/
├── main.tsx
├── App.tsx                       # Layout shell
├── stores/projectStore.ts        # Zustand: backend choice, shader source, params
├── adapters/webgpu.ts            # WebGPU adapter
├── components/
│   ├── Viewport.tsx              # Canvas mount + adapter lifecycle + resize observer
│   ├── Toolbar.tsx               # Backend selector placeholder, Save status
│   └── panels/
│       ├── ResizablePanels.tsx   # react-resizable-panels layout
│       └── Panel.tsx             # Reusable panel chrome
├── shaders/default.wgsl          # Default WGSL shader
└── utils/throttle.ts             # Debounce utility
```
**DO NOT create folders for React Flow, Three.js, Monaco, or NodeGraph yet.**

## 2. UI LAYOUT (react-resizable-panels)
Create a 3-panel layout:
- **Left (240px):** Placeholder text "Node Graph goes here".
- **Center (flex):** Viewport (Canvas) on top (60%), empty div for Editor on bottom (40%).
- **Right (280px):** Placeholder text "Parameters go here".
- **Bottom (collapsible):** Empty ErrorPanel div.
- **Toolbar (40px):** App title, "WebGPU" text, "Auto-compile" toggle.
- Use Tailwind CSS. Dark theme (slate-950 background).

## 3. WEBGPU ADAPTER SPECIFICATION (`adapters/webgpu.ts`)
Self-contained adapter with `mount(canvas)`, `render()`, `updateUniforms()`, `resize(width, height)`, `dispose()`.
1. Request adapter/device. If null, throw error "WebGPU not supported".
2. Configure canvas context with `alphaMode: 'premultiplied'`.
3. Create a render pipeline (primitive topology `triangle-list`, depth-stencil).
4. Create a uniform buffer for a 4x4 matrix (MVP) and a `vec3f` color.
5. Render loop: `requestAnimationFrame` → advance rotation by delta time (auto-rotate, no user input this phase) → recompute MVP → encode render pass → draw 36 vertices (cube) → present.
6. **Resize handling:** `resize(width, height)` reconfigures the canvas backing store using `window.devicePixelRatio` (`canvas.width = width * dpr`, same for height) and reconfigures the GPU context. Must not leak GPU resources on repeated resize.
7. **Device loss handling:** attach `device.lost.then(...)`. On loss, stop the render loop, attempt to re-request adapter/device and re-init the pipeline once. If re-init fails, surface a simple on-screen message "WebGPU device lost — reload to recover" (a full ErrorPanel comes in Phase 2; a plain overlay div is fine here).
8. `dispose()`: destroy device, stop rAF, remove resize listener.

## 4. VIEWPORT RESIZE WIRING (`components/Viewport.tsx`)
- Wrap the canvas's parent container in a `ResizeObserver`. On resize, call `adapter.resize(width, height)` — do not just resize the CSS box, the backing store must match or the render will look blurry/incorrect.
- Debounce resize calls slightly (e.g. via `utils/throttle.ts`) to avoid thrashing on drag-resize of the panels.

## 5. DEFAULT WGSL SHADER (`shaders/default.wgsl`)
**CRITICAL: Do not hallucinate syntax. Use strict 2023+ WGSL spec.**
- Use `@group(0) @binding(0) var<uniform> uniforms: Uniforms;`
- Struct `Uniforms` must contain `mvp: mat4x4<f32>` and `color: vec3<f32>`.
- Vertex shader: takes cube vertex positions, multiplies by MVP, outputs to `@builtin(position)`.
- Fragment shader: outputs `color`.
- Include standard struct alignment (`@size(16)`).

## 6. ACCEPTANCE CRITERIA
- App loads without errors in Chrome 113+.
- Viewport displays an auto-rotating cube using the default WGSL shader.
- Resizing the panels (dragging the splitters) keeps the cube sharp and correctly proportioned, no stretching or blur.
- Forcing a device loss (e.g. via `chrome://gpuinternals` or `device.destroy()` in devtools) shows the recovery message instead of a blank/crashed canvas.
- `vite dev` runs without TypeScript errors.
- Panels are resizable.
