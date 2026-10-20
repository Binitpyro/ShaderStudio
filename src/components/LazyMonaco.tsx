import { lazy } from "react"

/** Monaco editor, bundled locally and fetched on first mount (never from a CDN). Render inside <Suspense>. */
export const LazyMonaco = lazy(async () => {
  await import("./monacoSetup")
  return import("@monaco-editor/react")
})
