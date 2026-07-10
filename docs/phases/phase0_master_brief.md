# SHADER STUDIO — MASTER BRIEF (read first, reference throughout all phases)

## ROLE
Senior graphics engineer + tools engineer. Building "Shader Studio" — a browser-based, node-based shader/material compositor supporting WebGPU (WGSL), WebGL2 (GLSL ES 3.00), and Three.js side by side, with live parameter tweaking and live code sync from the user's own local IDE.

## CORE PROBLEM THIS SOLVES
Rapid iteration on WGSL/GLSL shaders and small 3D scenes without a full engine (Unity/Unreal/Houdini) round-trip. Wire mesh → material → post-process → output visually, edit shader code in a real IDE (VS Code etc.), see it update live, with sliders for exposed uniforms.

## NON-NEGOTIABLE ARCHITECTURE DECISIONS (do not deviate in any phase)

1. **No shared "Renderer" base class.** WebGPU, WebGL2, Three.js are independent adapters implementing one loose common interface (`mount/render/updateUniforms/dispose/compile`). Their execution models are incompatible; forcing abstraction produces leaky code.

2. **No automatic WGSL↔GLSL cross-compilation.** Each MaterialNode holds per-backend source (one `.wgsl`, one `.glsl`). Switching backend switches which file is active for that node. Do not attempt to transpile shaders between languages — this is out of scope and will consume an entire phase for no payoff.

3. **React Flow graph state stays in React Flow.** Zustand holds application/project state (active backend, uniform values, file handles) — never node positions/edges.

4. **External IDE is the primary code-editing surface. Embedded Monaco is a fallback**, not the main workflow. Priority order:
   - a) Local WebSocket dev-bridge (a companion script watches a folder, pushes file diffs) — works even inside a sandboxed preview iframe.
   - b) Browser File System Access API (`showDirectoryPicker`) — works only in a top-level tab, NOT inside an embedded preview iframe (Lovable/Bolt/Replit typically render previews this way). Must ship an "Open in new tab" affordance so this path is reachable.
   - c) Monaco in-browser editor — always available, last resort, or for quick one-off tweaks.
   Disk (or the bridge) is the source of truth whenever (a) or (b) is active; Monaco edits only take effect when no external sync is active, unless the user explicitly enables a "write back to disk" toggle.

5. **Post-processing is real, not decorative.** By Phase 4 the post-process chain uses actual ping-pong framebuffers/render targets per backend (raw FBOs for WebGL2, textures for WebGPU, `EffectComposer`-style for Three.js) — not a pass-through node.

6. **Never let a bad shader kill the app.** Compile errors surface in an Error Panel; viewport keeps the last good frame; device-loss (WebGPU) and context-loss (WebGL2) are caught and recoverable without a page reload.

## FULL FEATURE LIST (target v1)
- Resizable 3-panel layout: node graph (left), viewport + code editor (center), parameters (right), collapsible error console (bottom).
- Node graph: Mesh, Material, Texture, Uniform, Time, PostProcess, Output node types; freeform connections.
- Backend switch (WebGPU / WebGL2 / Three.js) without page reload, without losing graph state.
- Live code editing via IDE sync (bridge or File System Access) or embedded Monaco; debounced recompile; last-good-frame fallback on error.
- Auto-generated parameter panel from parsed uniforms (float sliders, color pickers, checkboxes, texture slots); parameter changes never trigger recompile, only `updateUniforms`.
- Texture/asset import (drag-and-drop images) wired into TextureNode → sampler bindings.
- Real post-processing chain (ping-pong render targets, e.g. blur/vignette as proof-of-concept).
- Perf overlay: FPS / frame time.
- Screenshot export (PNG) of the current viewport.
- Project save/load: serialize graph + uniform values + file references (IndexedDB via Dexie, or exportable JSON).
- Robust error handling and recovery (see decision #6).

## EXPLICIT NON-GOALS (v1)
- No cloud sync / multi-user collaboration.
- No mobile-optimized layout.
- No shader cross-compilation between WGSL and GLSL.
- No VR/AR preview.
- No per-node preview thumbnails (Houdini/Blender-style) — nice-to-have, defer past v1.

## KNOWN PLATFORM RISK (flag to the builder explicitly)
Lovable/Bolt/Replit typically render the live preview inside a sandboxed cross-origin iframe. `window.showDirectoryPicker()` and other File System Access API calls silently fail or throw inside such iframes — this is a browser security restriction, not an app bug to chase. The app must:
- Detect iframe context (`window.self !== window.top`) and show a persistent "Open in new tab to enable local file sync" banner instead of a silently broken button.
- Treat the WebSocket dev-bridge path as the primary, iframe-safe sync mechanism; File System Access is the secondary, new-tab-only path; Monaco is the always-available fallback.

## HOW TO USE THESE FILES
Feed this brief first (as project context / first message), then feed `phase1` → `phase4` in order, one per message. Each phase file is self-contained and references only what prior phases already built.
