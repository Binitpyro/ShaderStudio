// Bundled Monaco (no CDN): loaded only when the editor is first shown. Core editor features + the wgsl
// grammar; GLSL has no built-in grammar so it stays plaintext. Only the base editor worker is needed.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import "monaco-editor/esm/vs/editor/edcore.main.js"
import "monaco-editor/esm/vs/basic-languages/wgsl/wgsl.contribution.js"
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker.js?worker"
import { loader } from "@monaco-editor/react"

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco: monaco as unknown as typeof import("monaco-editor") })
