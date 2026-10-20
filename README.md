# Shader Studio

<p align="center">
  <img src="public/vite.svg" alt="Shader Studio Logo" width="80" height="80" />
</p>

<p align="center">
  <strong>A high-performance, commercial-grade visual shader compositor, real-time development environment & Agentic AI visual sandbox.</strong><br>
  Compose, inspect, and iterate on 3D shaders, compute simulations, and PBR materials across <strong>WebGPU</strong>, <strong>WebGL2</strong>, and <strong>Three.js</strong> with zero engine overhead.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/WebGPU-WGSL-blue?style=flat-square" alt="WebGPU WGSL" />
  <img src="https://img.shields.io/badge/WebGL2-GLSL_ES_3.00-orange?style=flat-square" alt="WebGL2 GLSL" />
  <img src="https://img.shields.io/badge/Three.js-r178-black?style=flat-square" alt="Three.js" />
  <img src="https://img.shields.io/badge/MCP_Server-Enabled-purple?style=flat-square" alt="MCP Server" />
  <img src="https://img.shields.io/badge/Local_AI-Ollama_%7C_LM_Studio-emerald?style=flat-square" alt="Local AI" />
  <img src="https://img.shields.io/badge/Tests-2191_Passed-brightgreen?style=flat-square" alt="Tests" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue?style=flat-square" alt="TypeScript" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License MIT" />
</p>

---

## 📖 Overview

**Shader Studio** transforms graphics programming into an agile, visual, and AI-collaborative creative workflow. Built from the ground up for technical artists, game developers, creative coders, and autonomous AI agents, Shader Studio provides instant sub-millisecond shader compilation, hardware-accelerated compute shaders, and turnkey production pipelines.

Whether you are designing procedural materials for **Unity**, **Godot**, or **Three.js**, testing audio-reactive visualizers, or pairing with **Claude**, **Gemini**, **OpenAI**, or local **Ollama** models via the **Model Context Protocol (MCP)**, Shader Studio gives you real-time visual feedback without the heavyweight bloat of traditional game engines.

---

## ✨ Production Engine Capabilities

### 🤖 1. Agentic AI Visual Sandbox & MCP Server
Shader Studio features a complete closed-loop AI runtime that empowers language models to see, inspect, and iterate on shader code in real time:
- **Universal Model Context Protocol (MCP) Server (`scripts/mcp-server.js`)**: Connect Cursor, Claude Desktop, or Antigravity directly to your running canvas via stdio JSON-RPC. External agents can call `render_shader`, `get_viewport_snapshot`, `get_bridge_status`, `list_templates`, `load_template`, and `transpile_shader`.
- **Integrated In-App Copilot Drawer (`src/components/AICopilotDrawer.tsx`)**: Multi-provider AI assistant supporting cloud models (Anthropic Claude, Google Gemini, OpenAI) and local zero-cost models (**Ollama** on `localhost:11434`, **LM Studio** on `localhost:1234`).
- **Autonomous Vision Loop & Auto-Fix**: The AI compiles shader code, captures high-resolution viewport frames (`POST /api/agent/capture`), inspects GPU error diagnostics, and self-corrects broken shaders automatically.

### 🎨 2. Commercial Game Engine Transpiler
Export your procedural shaders directly into production-ready game engine formats with one click in the Export Modal:
- **Unity URP HLSL (`.shader`)**: ShaderLab syntax with auto-generated `Properties {}` blocks, `CBUFFER_START(UnityPerMaterial)`, vertex programs, and HLSL fragment functions.
- **Godot 4 Spatial (`.gdshader`)**: Godot 4.x shading language with typed uniforms (`uniform vec3 u_color : source_color;`, `uniform float u_speed;`) and `fragment() { ALBEDO = ... }` outputs.
- **Shadertoy GLSL (`.glsl`)**: Portable `mainImage(out vec4 fragColor, in vec2 fragCoord)` entry point mapped to `iTime` and `iResolution`.
- **React Three Fiber Component (`.tsx`)**: Typed React Three Fiber material wrapper with reactive uniform hooks.
- **Webflow / HTML Canvas Embed (`.html`)**: Self-contained zero-dependency WebGL2 canvas embed script ready to paste into any website.

### 📦 3. Custom 3D Model Drag-and-Drop Loader
- Drag and drop any `.glb`, `.gltf`, or `.obj` 3D model directly onto the **MeshNode**.
- Automatic mesh normalization: centers asset origin at `(0, 0, 0)`, scales dimensions to fit the unit bounding sphere, and synthesizes smooth vertex normals if missing.
- Seamless multi-backend synchronization across WebGPU, WebGL2, and Three.js with live triangle counters and wireframe overlays.

### 🗺️ 4. 2K & 4K PBR Texture Baker & ZIP Packager
- Generate production-quality PBR texture suites directly from your procedural shaders:
  - **Albedo / Base Color Map**
  - **Tangent-Space Normal Map** (computed via 3x3 Sobel gradient filtering with DirectX / OpenGL Y-flip toggle)
  - **Roughness Map**
  - **Height / Displacement Map**
  - **Metallic Map**
  - **Ambient Occlusion (AO) Map**
- Choose resolutions from **512x512** up to **4096x4096 (4K)**.
- Built-in zero-dependency PKZIP 2.0 archiver (`src/utils/zipBuilder.ts`) bundles maps and `material_manifest.json` into a single downloadable ZIP archive.

### 🎥 5. 60fps High-Resolution Seamless Video Looper
- High-bitrate (up to 25 Mbps) canvas `MediaRecorder` video capture engine.
- Configurable duration (2s to 8s loop intervals) and framerate (30fps or 60fps).
- Real-time recording progress bar with live pulsating indicator and instant WebM preview & download.

### 🎵 6. Live Audio-Reactive Parameter Modulator & DSP Engine
- Web Audio API DSP pipeline with 512-bin real-time FFT spectrum analysis and spectral flux beat detection.
- **Interactive Audio Binding**: Link any numeric slider to **BASS**, **MID**, **TREBLE**, **BEAT**, or **LEVEL** with customizable modulation intensity (0.1x to 5.0x).
- **Non-Destructive GPU Streaming**: Modulated values stream into GPU uniform buffers on every frame without modifying base values in the project store.
- **Built-in Electronic Synthesizer**: Procedural 4-bar drum & bass loop generated in-memory with zero network or audio file dependencies, plus microphone input and audio file import.

### 🌟 7. Curated Production Shader Templates Library
Seven shader templates ready to load with one click. Every template runs on WebGPU, WebGL2, and Three.js:
1. **Iridescent Torus Knot Hero**: Thin-film iridescent chrome torus knot with Fresnel rim glow, audio pulsation, and Blinn-Phong highlights.
2. **Holographic Energy Shield**: Hexagonal energy barrier with animated scanlines, edge Fresnel emission, and chromatic aberration.
3. **Boiling Solar Plasma Orb**: Turbulent multi-octave FBM convective plasma cells with coronal flares and high-temperature radiation.
4. **Cyberpunk Synthwave Grid**: Retro 80s endless perspective neon grid with glowing horizon sun and atmospheric fog.
5. **Liquid Chrome & Thin-Film Iridescence**: Specular liquid mercury with angle-dependent chromatic thin-film wave interference.
6. **Tropical Ocean & Voronoi Caustics**: Deep oceanic sunlight transmission with animated Voronoi water refraction ripples.
7. **Cosmic Nebula & Twinkling Stars**: Deep space volumetric gas clouds with parallax star dust and stellar nurseries.

The three SDF templates (Organic Metaball Fusion, Morphing Twisted Torus, Infinite Procedural Columns) are node graphs and are listed in section 9.

### ☀️ 8. Studio Lighting & Image-Based Lighting (IBL / HDRI)
- **100% In-Memory Procedural HDR Synthesis**: 5 mathematical studio environments generated on-the-fly (`studio_warm`, `cyberpunk_neon`, `sunset`, `nebula`, `clean_neutral`) with zero external asset downloads or CORS blocks.
- **Full Lighting Controls**: Interactive ParameterPanel controls for **Exposure** (0.1x to 4.0x), **360° Rotation** (0° to 360°), **Background Blur** (0.0 to 1.0), and a toggleable panoramic **Skybox**.
- **Universal Multi-Adapter Support**: Native ACESFilmic tone mapping and PMREM reflections in **Three.js**, dedicated uniform/texture unit bindings in **WebGL2**, and direct GPU texture allocation in **WebGPU**.

### 🧊 9. Visual Raymarching & Signed Distance Field (SDF) Procedural Geometry
- **Modular Node Architecture**:
  - `SdfPrimitiveNode`: Sphere, Box, Torus, Cylinder, Capsule, Plane with interactive real-time dimensions and offsets.
  - `SdfOperatorNode`: Smooth Union (`smin`), Union, Subtraction, Intersection, Repetition, and Twist deformation.
  - `RaymarchNode`: Real-time volumetric raymarching engine with customizable max steps, soft shadow penumbras, and ambient occlusion (AO).
- **Turnkey Shader Generation**: Graph compiler translates the visual SDF node tree directly into optimized **GLSL 300 es** and **WGSL** fragment shaders.
- **Pre-Built Curated Templates**: Instant 1-click loading for *Organic Metaball Fusion*, *Morphing Twisted Torus*, and *Infinite Procedural Columns*.

### 🔍 10. Blender / Unreal Style Interactive Node Palette
- Press **Spacebar** anywhere on the visual canvas to open the fuzzy-searchable Node Palette.
- Fast category filtering across **Geometry**, **Shading**, **Post-Processing**, **Dynamics & Audio**, **SDF & Raymarching**, and **Output**.
- Full keyboard navigation (`↑`/`↓` to highlight, `Enter` to place, `Esc` to close).

### 🏷️ 11. Preset Variations & A/B Snapshot Manager
- Save multiple aesthetic iterations of your shader parameters as named snapshots.
- Switch between variations with 1 click to preview different color schemes, speeds, and textures.
- Full snapshot preservation in `.shaderstudio` project bundles.

### 📁 12. Commercial `.shaderstudio` Project Persistence
- Save, load, import, and export entire projects as `.shaderstudio` bundles.
- Preserves node graph topology, custom shader source code, parameter states, audio bindings, environment lighting, and variation snapshots.
- Robust schema validation and automatic Dexie.js IndexedDB local caching.

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
│                 │   │  (WebGPU/GL2/3JS) │   │  + Audio Sync │
│  MeshNode       │   ├───────────────────┤   ├───────────────┤
│  MaterialNode   │   │   Shader Editor   │   │  Asset Drop   │
│  TextureNode    │   │ (Monaco Fallback) │   │  & Variations │
│  PostProcessNode│   └───────────────────┘   │  & Project DB │
│  AudioNode      │   ┌───────────────────┐   │  (Dexie.js)   │
│  ComputeNode    │   │ AI Copilot Drawer │   │               │
├─────────────────┴───┴───────────────────┴───┴───────────────┤
│           Collapsible Error Diagnostics & Perf Overlay      │
└─────────────────────────────────────────────────────────────┘
```

1. **Independent Graphics Adapters**: WebGPU, WebGL2, and Three.js implement an identical contract (`mount`, `render`, `updateUniform`, `recompileShader`, `dispose`) without forced inheritance hierarchies or leaky abstractions.
2. **Native Language Sources**: Full native WGSL and GLSL ES 3.00 pipelines without forced cross-compilers, unlocking raw hardware performance.
3. **Decoupled Visual State**: React Flow retains graph geometry, pan, and zoom, while Zustand synchronizes application state, active backends, and uniform buffers.
4. **Compiled Render Queue**: Visual graphs compile into an optimized `RenderQueue` before reaching the active GPU adapter.

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v22.18.0 or higher (the MCP server relies on Node's built-in TypeScript type stripping)
- **Browser**: Modern Chromium browser with WebGPU enabled (Chrome 113+, Edge 113+) or modern Firefox / Safari with WebGL2 support.

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

3. Start the development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173](http://localhost:5173) in your browser.

---

### 🔨 Production Build & Standalone Windows Executable (.exe)

ShaderStudio uses npm scripts (defined in `package.json`, implemented in `scripts/`) to build the web distribution and package standalone Windows binaries:

#### 1. Full Production Build (WebAssembly + TypeScript + Vite)
Compiles the Rust WebAssembly engine (`wasm-pack` must be on your PATH), runs typechecking, and generates optimized assets in `dist/`:
```bash
npm run build:all
# or: node scripts/build-all.js
# flags: --skip-wasm (skip the WebAssembly step), --test (also run cargo and vitest tests)
```

`npm run build` runs only the TypeScript check and the Vite bundle (`tsc -b && vite build`). It does not rebuild the WebAssembly package.

#### 2. Standalone Windows Executable (.exe)
`npm run build:exe` compiles `crates/shaderstudio_desktop` into a **single, portable, zero-dependency `ShaderStudio.exe`** that embeds all HTML, CSS, JavaScript, and WebAssembly assets in-memory. The executable is written to the repository root as `ShaderStudio.exe`:
```bash
npm run build:exe
# or: node scripts/build-exe.js
# flag: --full (rebuild dist/ first; dist/ is built automatically if it is missing)
```

**Running `ShaderStudio.exe`:**
* **Desktop Mode**: Simply double-click `ShaderStudio.exe`. It automatically starts an in-memory HTTP server and launches your default browser.
* **Command Line Options**:
  ```cmd
  ShaderStudio.exe                  # Default port: 8650 (next free port if busy)
  ShaderStudio.exe --port 9000      # Custom port
  ShaderStudio.exe --headless       # Run server without launching browser window
  ```

#### 3. Tauri Desktop App (`src-tauri/`)
The Tauri shell runs the same Vite frontend in a native window:
* `npm run tauri:dev`: runs `npm run dev` (http://localhost:5173) and opens the app window (`tauri dev`).
* `npm run tauri:build`: runs `tauri build`, which first runs `npm run build` (`beforeBuildCommand`). The bundled frontend is read from `dist/`.

Project save and open go through native file dialogs. Project paths must end in `.shaderstudio` or `.json`, and double extensions such as `evil.exe.json` are rejected. A file is read or written only if it was picked in a dialog during that session, plus the app's default `Documents/ShaderStudio/untitled.shaderstudio` path (`src-tauri/src/commands/fs_dialog.rs`).

---

## 🤖 Connecting External AI Agents via MCP

To connect external AI coding tools (**Cursor**, **Claude Desktop**, or **Antigravity**) directly to Shader Studio, two processes are involved:
- **Dev bridge** (`scripts/bridge.js`, `npm run bridge`): an HTTP and WebSocket server on port `8642`. The browser app connects to it.
- **MCP server** (`scripts/mcp-server.js`, `npm run mcp`): a stdio JSON-RPC server. Your AI client launches it and it talks to the bridge.

`ws` is a devDependency, so `npm run bridge` needs a normal `npm install` (not `--omit=dev`).

1. Start the bridge:
   ```bash
   npm run bridge
   ```
   It prints an `Open Studio: http://localhost:5173/?token=...` link. Open that link in your browser so the page receives the token. The bridge also writes the token to `~/.shader-studio/bridge-token`, which the MCP server reads. The file is deleted when the bridge exits. To supply the token yourself, set `SHADER_STUDIO_BRIDGE_TOKEN`. To use a different token file, set `SHADER_STUDIO_TOKEN_FILE`.

2. Add the MCP server to your AI client's configuration. For example, in Claude Desktop (`claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "shader-studio": {
         "command": "node",
         "args": ["<path>/scripts/mcp-server.js"]
       }
     }
   }
   ```
   Replace `<path>` with the absolute path to your clone of this repository.

3. Your external AI can now render shaders, inspect live frame captures, query shader templates, and transpile code into Unity and Godot formats in real time!

---

## ⚡ Using the Local IDE Dev-Bridge

To edit shader files directly in VS Code or Cursor with live hot-reloading:

1. Launch the bridge companion script:
   ```bash
   npm run bridge -- ./src/shaders
   ```

2. Open the `Open Studio` link the bridge prints (it includes the token). The connection indicator will turn green (**Synced via local bridge**).
3. Any changes saved to `.wgsl`, `.glsl`, `.frag`, or `.vert` files in that folder will instantly push to Shader Studio and recompile in the viewport.

---

## 🛠️ Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the Vite development server with hot module reloading. |
| `npm run build` | Runs TypeScript compilation (`tsc -b`) and builds production assets with Vite. |
| `npm run preview` | Previews the production build locally. |
| `npm run typecheck` | Validates TypeScript types across the entire project without emitting code. |
| `npm run test` | Executes the complete Vitest test suite (**2,191 tests across 94 test files**). |
| `npm run bridge` | Starts the WebSocket local IDE file synchronizer & agent bridge (`scripts/bridge.js`). |
| `npm run mcp` | Starts the stdio MCP server (`scripts/mcp-server.js`) for an AI client. |
| `npm run build:all` | Full production build: WebAssembly (`wasm-pack`), typecheck, and Vite bundle (`scripts/build-all.js`). |
| `npm run build:exe` | Builds the standalone `ShaderStudio.exe` in the repository root (`scripts/build-exe.js`). |
| `npm run tauri:dev` | Runs the Tauri desktop app in development mode (`tauri dev`). |
| `npm run tauri:build` | Builds the Tauri desktop app (`tauri build`). |

---

## 🧪 Testing & Quality Assurance

Shader Studio maintains an exhaustive automated test suite with **2,191 unit, integration, and end-to-end tests** across 94 test files:

- **Tier 1 (Feature Integrations)**: GPU uniform buffer alignment (16-byte WGSL rules), topological graph compiler sorting, multi-pass post-processing chains, texture sampler bindings, real-time FFT audio pipeline, compute simulation pipelines, and closed-loop agent RPC execution.
- **Tier 2 (Boundary & Corner Cases)**: Context/device loss recovery, empty graph states, malformed uniform declarations, invalid texture paths, network 404 fallbacks, and rapid backend switching.
- **Tier 3 (Cross-Feature Combinations)**: Simultaneous backend switching with active post-processing chains, animated audio uniforms, and custom 3D mesh buffers.
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
