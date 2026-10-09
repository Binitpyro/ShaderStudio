# Shader Studio

<p align="center">
  <img src="public/vite.svg" alt="Shader Studio Logo" width="80" height="80" />
</p>

<p align="center">
  <strong>A high-performance, browser-based visual shader compositor & real-time development environment.</strong><br>
  Compose, inspect, and iterate on 3D shaders and materials across <strong>WebGPU</strong>, <strong>WebGL2</strong>, and <strong>Three.js</strong> side-by-side with zero engine overhead.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/WebGPU-WGSL-blue?style=flat-square" alt="WebGPU WGSL" />
  <img src="https://img.shields.io/badge/WebGL2-GLSL_ES_3.00-orange?style=flat-square" alt="WebGL2 GLSL" />
  <img src="https://img.shields.io/badge/Three.js-r178-black?style=flat-square" alt="Three.js" />
  <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue?style=flat-square" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tests-328_Passed-brightgreen?style=flat-square" alt="Tests" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License MIT" />
</p>

---

## 📖 Overview

**Shader Studio** solves a fundamental bottleneck in graphics development: rapid iteration on shaders and small 3D scenes without the heavyweight overhead and slow compile times of full game engines (Unity, Unreal, Houdini).

With Shader Studio, you can:
- Visually connect **Mesh &rarr; Material &rarr; Post-Process &rarr; Output** in an interactive node graph.
- Write and edit shader code in your **favorite local IDE** (VS Code, Cursor, Neovim) with live WebSocket file sync.
- Hot-switch between **WebGPU (WGSL)**, **WebGL2 (GLSL ES 3.00)**, and **Three.js** in real-time without reloading the page or losing graph state.
- Instantly tweak uniforms via an **auto-generated parameter control panel** that mutates GPU buffers directly without triggering shader recompilation.
- Build multi-pass post-processing chains with real ping-pong render targets.
- Benefit from bulletproof error resilience: broken shaders never kill your session, thanks to last-good-frame fallback and automatic GPU device-loss recovery.

---

## ✨ Features

### 🚀 1. Multi-Backend Rendering Architecture
- **Raw WebGPU Adapter (`adapters/webgpu.ts`)**: Direct WGSL pipeline using `@group` and `@binding` conventions, uniform buffers, and modern GPU rendering passes.
- **Raw WebGL2 Adapter (`adapters/webgl2.ts`)**: Pure GLSL ES 3.00 pipeline (`#version 300 es`) with VAOs, VBOs, and uniform location updates.
- **Three.js Adapter (`adapters/threejs.ts`)**: Interoperability adapter utilizing `THREE.ShaderMaterial` and built-in geometries.
- **Zero Page Reload Backend Switching**: Switch dynamically from the toolbar dropdown (`WebGPU` &harr; `WebGL2` &harr; `Three.js`). Viewport swaps adapters instantly while preserving node graph topology and parameter values.
- **Independent Adapters**: Built without a leaky shared base class, honoring the unique execution models and memory structures of each graphics API.

### 🕸️ 2. Visual Node Graph (React Flow)
Compose rendering pipelines with a clean, node-based visual workflow:
- **MeshNode**: Generates 3D geometries (Cube, Sphere, Plane).
- **MaterialNode**: Maps geometry to active shader sources (`.wgsl` / `.glsl`) with one-click jump-to-code navigation.
- **TextureNode**: Drag-and-drop image import and GPU texture resource binding.
- **UniformNode**: Expose custom float, vector, or boolean parameters to the UI before wiring them into shader code.
- **TimeNode**: Emits real-time elapsed seconds (`u_time`) for procedural animation.
- **PostProcessNode**: Stacks chainable post-processing passes (vignette, blur, bloom, chromatic aberration, custom).
- **OutputNode**: Designates the final render target for screen presentation.
- **Graph Compiler (`core/graphCompiler.ts`)**: Validates node connections, topologically sorts backward from the OutputNode, discards disconnected scratch nodes, and generates an optimized `RenderQueue`.

### 🔄 3. Tri-Tier Live Code Sync (External IDE First)
Shader Studio prioritizes your native development workflow over constrained in-browser text fields:
1. **WebSocket Dev-Bridge (Primary & Iframe-Safe)**: A lightweight Node.js companion script watches your local shader folder and streams changes via WebSockets (`ws://localhost:8642`). Works seamlessly even inside sandboxed iframe previews (Lovable, Bolt, Replit).
2. **File System Access API (Secondary)**: Direct browser folder mounting via `window.showDirectoryPicker()` in top-level browser tabs with automatic polling and iframe detection.
3. **Embedded Monaco Editor (Fallback)**: Built-in Monaco editor with GLSL/WGSL syntax highlighting, 400ms debounced auto-compilation, and offline standalone editing.

### 🎛️ 4. Dynamic Uniform Reflection & Parameter Panel
- **Automatic Uniform Reflection**: Regex AST parsers (`parsers/wgslUniforms.ts`, `parsers/glslUniforms.ts`) inspect shader code to discover scalars (`float`, `int`, `uint`, `bool`), vectors (`vec2`, `vec3`, `vec4`), matrices, arrays, and textures.
- **Smart Control Inference**: Automatically renders color pickers for variables containing `color`, `tint`, or `albedo`, sliders for numeric ranges, switches for booleans, and asset drop targets for textures.
- **Direct GPU Buffer Updates**: Adjusting parameters invokes `adapter.updateUniforms()` directly, updating GPU memory instantly with **zero recompilation overhead**.

### 🎞️ 5. Real Multi-Pass Post-Processing Pipeline
- **Ping-Pong Render Targets**: WebGPU textures and WebGL2 Framebuffer Objects (FBOs) chain outputs across consecutive passes.
- **Built-in Effects**:
  - Gaussian Blur (`blur.wgsl` / `blur.frag`)
  - Vignette (`vignette.wgsl` / `vignette.frag`)
  - Bloom (`bloom.wgsl` / `bloom.frag`)
  - Chromatic Aberration (`chromatic_aberration.wgsl` / `chromatic_aberration.frag`)
  - Passthrough (`passthrough.wgsl` / `passthrough.frag`)
- **Custom Post-Process Shaders**: Dedicated Post-Processing Drawer enables authoring and testing custom post-effect fragment and compute shaders.

### 🛡️ 6. Fault Resilience & Diagnostics
- **Last-Good-Frame Caching**: Compilation errors will never black out your canvas. The viewport retains and presents the last successfully compiled frame.
- **Collapsible Error Console**: Rich compiler error panel displaying exact shader line, column, and diagnostic messages.
- **Device & Context Loss Recovery**: Gracefully handles WebGPU `device.lost` and WebGL2 `webglcontextlost` / `webglcontextrestored` events, recovering the pipeline automatically without requiring a full browser refresh.

### 💾 7. Persistence & Developer Utilities
- **Project Storage**: IndexedDB persistence via Dexie.js for project save, load, and versioning.
- **JSON Import / Export**: Export entire projects (graph structure, shader sources, and uniform states) as portable JSON files.
- **Performance Monitor (`PerfOverlay`)**: Real-time FPS and frame time (ms) counter.
- **Screenshot Tool**: High-resolution one-click PNG viewport capture.

---

## 🏗️ Architecture & Core Principles

```
┌─────────────────────────────────────────────────────────────┐
│                       Shader Studio                         │
├─────────────────┬───────────────────────────┬───────────────┤
│   Left Panel    │       Center Workspace    │  Right Panel  │
│                 │                           │               │
│   Node Graph    │   ┌───────────────────┐   │  Parameters   │
│  (React Flow)   │   │  Viewport Canvas  │   │ (Reflected UI)│
│                 │   │  (WebGPU/GL2/3JS) │   │               │
│  MeshNode       │   ├───────────────────┤   ├───────────────┤
│  MaterialNode   │   │   Shader Editor   │   │  Asset Drop   │
│  TextureNode    │   │ (Monaco Fallback) │   │  & Project DB │
│  PostProcessNode│   └───────────────────┘   │  (Dexie.js)   │
├─────────────────┴───────────────────────────┴───────────────┤
│           Collapsible Error Diagnostics & Perf Overlay      │
└─────────────────────────────────────────────────────────────┘
```

1. **Independent Render Adapters**: WebGPU, WebGL2, and Three.js implement a lightweight common interface (`mount`, `render`, `updateUniforms`, `dispose`, `recompileShader`) without forced inheritance hierarchies.
2. **Native Language Sources**: Each material maintains distinct `.wgsl` and `.glsl` implementations to leverage backend-specific capabilities and ensure optimal performance without leaky transpilers.
3. **Decoupled Visual State**: React Flow retains graph geometry, pan, and zoom, while Zustand manages runtime application state, backend selection, and active uniform buffers.
4. **Compiled Render Queue**: Visual graphs compile into a sequential, validated execution array before reaching the active GPU adapter.

---

## 📂 Project Structure

```text
ShaderStudio/
├── docs/                      # Architectural briefs and phase documentation
│   └── phases/                # Phase 0-4 design specifications
├── public/                    # Static assets
├── scripts/
│   └── bridge.js              # Companion WebSocket file watcher bridge
├── src/
│   ├── adapters/              # Graphics backend adapters
│   │   ├── types.ts           # RenderAdapter shared contract
│   │   ├── webgpu.ts          # Raw WebGPU / WGSL adapter
│   │   ├── webgl2.ts          # Raw WebGL2 / GLSL ES 3.00 adapter
│   │   └── threejs.ts         # Three.js ShaderMaterial adapter
│   ├── bridge/                # WebSocket dev-bridge client & message protocol
│   │   ├── bridgeProtocol.ts  # Protocol schemas
│   │   └── wsBridgeClient.ts  # Client connection manager
│   ├── components/            # React UI components
│   │   ├── nodes/             # React Flow custom node components
│   │   │   ├── MeshNode.tsx
│   │   │   ├── MaterialNode.tsx
│   │   │   ├── TextureNode.tsx
│   │   │   ├── UniformNode.tsx
│   │   │   ├── TimeNode.tsx
│   │   │   ├── PostProcessNode.tsx
│   │   │   └── OutputNode.tsx
│   │   ├── panels/            # Resizable panel layouts
│   │   │   ├── Panel.tsx
│   │   │   └── ResizablePanels.tsx
│   │   ├── ui/                # UI primitives (Radix UI / Tailwind)
│   │   ├── ErrorPanel.tsx     # Compiler error console
│   │   ├── FileImporter.tsx   # Asset file drag-and-drop
│   │   ├── NodeGraph.tsx      # React Flow visual canvas
│   │   ├── ParameterPanel.tsx # Auto-generated uniform controls
│   │   ├── PerfOverlay.tsx    # Live FPS / frame time HUD & screenshot
│   │   ├── PostProcessDrawer.tsx # Custom post-fx editor drawer
│   │   ├── ProjectPanel.tsx   # IndexedDB save/load & JSON export
│   │   ├── ShaderEditor.tsx   # Monaco editor fallback
│   │   ├── SyncStatusBanner.tsx # IDE sync mode indicator
│   │   ├── Toolbar.tsx        # Top navigation and backend switch
│   │   └── Viewport.tsx       # Canvas host & lifecycle manager
│   ├── core/                  # Engine pipeline core
│   │   ├── graphCompiler.ts   # React Flow -> RenderQueue compiler
│   │   ├── postProcessChain.ts# Ping-pong framebuffer pipeline
│   │   └── uniformLayout.ts   # Struct byte alignment & GPU buffer layout
│   ├── db/                    # Dexie.js IndexedDB schema
│   ├── parsers/               # WGSL & GLSL uniform reflection parsers
│   ├── shaders/               # Default shaders & post-processing filters
│   │   ├── postprocess/       # Blur, Bloom, Vignette, Chromatic Aberration
│   │   ├── default.wgsl       # Default WebGPU shader
│   │   ├── default.vert       # Default GLSL vertex shader
│   │   └── default.frag       # Default GLSL fragment shader
│   ├── stores/                # Zustand application stores
│   │   ├── fileSystemStore.ts # Sync status & file handles
│   │   └── projectStore.ts    # Project state, uniforms, and graph data
│   ├── utils/                 # Helpers (throttling, formatters)
│   ├── App.tsx                # Main application layout shell
│   └── main.tsx               # Application entry point
├── tests/                     # Comprehensive Vitest test suite
│   └── e2e/                   # 5-tier test suites & GPU mocks
├── index.html                 # HTML host document
├── package.json               # Dependencies and scripts
└── vite.config.ts             # Vite configuration
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **Browser**: Modern Chromium-based browser with WebGPU support (Chrome 113+, Edge 113+) or modern Firefox / Safari with WebGL2 / WebGPU enabled.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Binitpyro/ShaderStudio.git
   cd ShaderStudio
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the local development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## ⚡ Using the Local IDE Dev-Bridge

To edit shader files directly in VS Code, Cursor, or your preferred IDE with live hot-reloading:

1. Launch the bridge companion script, passing the directory containing your shader files:
   ```bash
   npm run bridge -- ./src/shaders
   ```
   *(Or specify an optional port: `node scripts/bridge.js ./src/shaders --port 8642`)*

2. Open Shader Studio in your browser. The connection indicator in the toolbar will illuminate green (**Synced via local bridge**).
3. Any changes saved to `.wgsl`, `.glsl`, `.frag`, or `.vert` files in that folder will instantly push to Shader Studio and recompile in the viewport.

---

## 🛠️ Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the Vite development server with hot module reloading. |
| `npm run build` | Runs TypeScript compilation (`tsc -b`) and builds production assets with Vite. |
| `npm run preview` | Previews the production build locally. |
| `npm run typecheck` | Validates TypeScript types across the entire project without emitting code. |
| `npm run test` | Executes the Vitest test suite (328 tests across 19 suites). |
| `npm run bridge` | Starts the WebSocket local IDE file synchronizer script (`scripts/bridge.js`). |

---

## 🧪 Testing & Quality Assurance

Shader Studio maintains a rigorous test suite comprising **328 unit, integration, and end-to-end tests** organized across 5 distinct tiers:

- **Tier 1 (Feature Integrations)**: GPU uniform buffer alignment (16-byte WGSL rules), topological graph compiler sorting, multi-pass post-processing chains, texture sampler bindings, and render loops.
- **Tier 2 (Boundary & Corner Cases)**: Context/device loss recovery, empty graph states, malformed uniform declarations, invalid texture paths, and rapid backend switching.
- **Tier 3 (Cross-Feature Combinations)**: Simultaneous backend switching with active post-processing chains and animated uniforms.
- **Tier 4 (Application Scenarios)**: Complex multi-node graphs, project serialization round-trips, and project state hydration.
- **Tier 5 (Adversarial Stress Testing)**: Deep uniform nesting, oversized arrays, high-frequency parameter mutations, and concurrent recompile triggers.

Run all tests via:
```bash
npm run test
```

---

## 📜 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for full details.

Copyright (c) 2026 **Binit Varghese**.
