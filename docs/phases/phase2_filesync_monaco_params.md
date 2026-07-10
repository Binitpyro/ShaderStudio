# SHADER STUDIO - PHASE 2: LIVE CODE SYNC, PARAMETERS & FALLBACK EDITOR

> **CONTEXT:** Phase 1 (WebGPU viewport + resizable layout) is complete. This phase adds the code-editing surface. Per the master brief: **external IDE sync is primary, Monaco is fallback** — the user will always prefer editing in their real IDE over an in-browser editor.

## 1. EXACT FILES TO ADD/MODIFY
```text
src/
├── stores/fileSystemStore.ts      # sync mode state + file handles
├── bridge/
│   ├── wsBridgeClient.ts          # NEW: connects to local companion dev-bridge
│   └── bridgeProtocol.ts          # NEW: message schema
├── components/
│   ├── ShaderEditor.tsx           # Monaco — FALLBACK mode only
│   ├── SyncStatusBanner.tsx       # NEW: shows active sync mode / iframe warning
│   ├── ParameterPanel.tsx         # NEW: auto-generated controls
│   ├── FileImporter.tsx           # NEW: drag-and-drop fallback
│   └── ErrorPanel.tsx             # NEW: collapsible error console
├── parsers/
│   ├── wgslUniforms.ts            # NEW: regex parser
│   └── glslUniforms.ts            # NEW: regex parser
├── db/index.ts                    # NEW: Dexie.js setup
└── package.json                   # MODIFY: add monaco, dexie
```

## 2. SYNC PRIORITY — implement all three, in this order of precedence

### 2a. WebSocket dev-bridge (PRIMARY, iframe-safe)
- A small companion Node script (document its usage, no need to build it in-app this phase) that the user runs locally: `node bridge.js ./shaders --port 8642`. It watches a folder (`chokidar` or `fs.watch`) and pushes JSON over a WebSocket: `{type:'file', path, content}` on change, `{type:'list', files:[...]}` on connect.
- In `wsBridgeClient.ts`: attempt connection to `ws://localhost:8642` on app load. On success, set `fileSystemStore.syncMode = 'bridge'`. Reconnect with backoff if the connection drops.
- Incoming file messages update `projectStore`'s shader source directly → triggers the debounced recompile.

### 2b. File System Access API (SECONDARY, top-level tab only)
- `connectLocalFolder()` using `window.showDirectoryPicker()`.
- **Before** offering this button, check `window.self !== window.top`. If true (running inside an embedded preview iframe), disable the button and instead show: "Open in new tab to enable local folder sync" with a link/button that opens the current URL in a new top-level tab.
- If used successfully: recursively read `.wgsl`/`.glsl` files, store `FileSystemFileHandle`s, poll `lastModified` every 1s, re-read + update on change + trigger recompile.

### 2c. Monaco (FALLBACK, always available)
- Install `@monaco-editor/react` + `vite-plugin-monaco-editor`; set `languageWorkers: ['editor']` in `vite.config.ts` to avoid web worker bundling errors.
- Only editable when neither 2a nor 2b is active for the current file, OR the user has explicitly toggled "detach and edit locally" (warn them this won't persist to disk).
- WGSL/GLSL syntax highlighting if Monaco supports it, else plain text.
- Debounce 400ms after typing stops → update `projectStore` → trigger recompile.

### 2d. `SyncStatusBanner.tsx`
Shows current state clearly, e.g.: "🟢 Synced via local bridge" / "🟡 Synced via folder (this tab)" / "⚪ Editing locally (not saved to disk)" / the iframe warning from 2b.

## 3. UNIFORM PARSING (must cover more than scalars)
`parsers/wgslUniforms.ts` and `glslUniforms.ts` must parse:
- Scalars: `f32`/`float`, `i32`/`int`, `u32`/`uint`, `bool`.
- Vectors: `vec2f/vec3f/vec4f` (WGSL), `vec2/vec3/vec4` (GLSL).
- Textures/samplers: `texture_2d<f32>` + `sampler` (WGSL, treat as one paired binding); `sampler2D` (GLSL, single binding).
- Fixed-size arrays of the above (e.g. `array<f32, 8>`) → render as N stacked sliders.
- **Color heuristic:** name contains `color`/`tint`/`albedo` → vec3/vec4 becomes a color picker.
- **Texture heuristic:** any texture/sampler binding → renders a drop target in `ParameterPanel`, wired to texture assets (full asset pipeline lands in Phase 3 — stub with a placeholder checkerboard texture if Phase 3 isn't built yet).

## 4. PARAMETER PANEL BEHAVIOR
- Changing a slider/color/checkbox/texture calls `adapter.updateUniform(name, value)` directly. This must **never** trigger a shader recompile.
- The panel re-derives its control list only when the parsed uniform *set* actually changes (diff by name+type) — not on every keystroke-driven recompile — so slider values aren't reset while the user is mid-edit elsewhere.

## 5. ACCEPTANCE CRITERIA
- With the bridge script running, editing a `.wgsl` file in VS Code updates the viewport within ~1s — including when the app is embedded inside a preview iframe.
- With no bridge running and outside an iframe, `showDirectoryPicker` sync works as an independent path.
- Inside an iframe with no bridge running, the folder-sync button is disabled with a clear "open in new tab" affordance — it does not fail silently.
- Monaco fallback works standalone with no external sync active at all.
- Parameter panel shows correct control types for float, vec3 color, bool, and at least a placeholder for a texture uniform.
- Bad code in any sync mode shows the error in ErrorPanel; the viewport keeps the last successful frame.
