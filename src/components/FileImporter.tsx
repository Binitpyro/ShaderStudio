import { useState, useEffect, useRef } from "react"
import { useFileSystemStore, isIframe } from "@/stores/fileSystemStore"
import { useProjectStore } from "@/stores/projectStore"
import { saveSnapshot } from "@/db"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const SNAPSHOT_DEBOUNCE = 5000

export function FileImporter() {
  const [isDragging, setIsDragging] = useState(false)
  const [polling, setPolling] = useState(false)
  const pollingRef = useRef<number | null>(null)
  const snapshotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setSyncMode = useFileSystemStore((state) => state.setSyncMode)
  const setFileHandle = useFileSystemStore((state) => state.setFileHandle)
  const setActiveFilePath = useFileSystemStore((state) => state.setActiveFilePath)
  const clearFileHandles = useFileSystemStore((state) => state.clearFileHandles)
  const syncMode = useFileSystemStore((state) => state.syncMode)
  const fileHandles = useFileSystemStore((state) => state.fileHandles)
  const storeIsIframe = useFileSystemStore((state) => state.isIframe)

  const setShaderSource = useProjectStore((state) => state.setShaderSource)
  const setActiveShaderPath = useProjectStore((state) => state.setActiveShaderPath)
  const triggerRecompile = useProjectStore((state) => state.triggerRecompile)

  const checkIframe = isIframe || storeIsIframe

  function debouncedSaveSnapshot(path: string, content: string) {
    if (snapshotTimeoutRef.current) clearTimeout(snapshotTimeoutRef.current)
    snapshotTimeoutRef.current = setTimeout(() => { saveSnapshot(path, content); snapshotTimeoutRef.current = null }, SNAPSHOT_DEBOUNCE)
  }

  async function connectLocalFolder() {
    if (!("showDirectoryPicker" in window)) { alert("File System Access API is not supported in this browser"); return }
    try {
      const dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker()
      clearFileHandles()
      await readShaderFiles(dirHandle, "")
      setSyncMode("folder")
      startPolling()
    } catch (e) { if (e instanceof Error && e.name === "AbortError") return; console.error("Failed to connect folder:", e) }
  }

  async function readShaderFiles(dir: FileSystemDirectoryHandle, basePath: string) {
    const entries: FileSystemHandle[] = []
    for await (const entry of (dir as unknown as Iterable<FileSystemHandle>)) { entries.push(entry) }
    for (const entry of entries) {
      const path = basePath ? `${basePath}/${entry.name}` : entry.name
      if (entry.kind === "directory") { await readShaderFiles(entry as FileSystemDirectoryHandle, path) }
      else if (entry.kind === "file") {
        const fileHandle = entry as FileSystemFileHandle
        const ext = entry.name.split(".").pop()?.toLowerCase()
        if (ext === "wgsl" || ext === "glsl" || ext === "frag" || ext === "vert") {
          const file = await fileHandle.getFile()
          const content = await file.text()
          setFileHandle(path, { handle: fileHandle, lastModified: file.lastModified, path })
          if (basePath === "" || basePath.split("/").length === 1) {
            setShaderSource(content); setActiveShaderPath(path); setActiveFilePath(path); triggerRecompile()
            debouncedSaveSnapshot(path, content)
          }
        }
      }
    }
  }

  function startPolling() {
    if (pollingRef.current) clearInterval(pollingRef.current)
    pollingRef.current = window.setInterval(async () => {
      setPolling(true)
      for (const [path, entry] of fileHandles) {
        try {
          const file = await entry.handle.getFile()
          if (file.lastModified > entry.lastModified) {
            const content = await file.text()
            setFileHandle(path, { ...entry, lastModified: file.lastModified })
            const activeFilePath = useFileSystemStore.getState().activeFilePath
            if (path === activeFilePath) { setShaderSource(content); triggerRecompile(); debouncedSaveSnapshot(path, content) }
          }
        } catch { /* File might have been deleted */ }
      }
      setPolling(false)
    }, 1000)
  }

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
      if (snapshotTimeoutRef.current) clearTimeout(snapshotTimeoutRef.current)
    }
  }, [])

  function openInNewTab() { window.open(window.location.href, "_blank") }

  if (checkIframe) {
    return (
      <div className="flex flex-col gap-2">
        <Button variant="outline" size="sm" disabled className="w-full justify-start text-xs">Local folder sync</Button>
        <p className="text-xs text-muted-foreground">Open in new tab to enable local folder sync</p>
        <Button variant="secondary" size="sm" onClick={openInNewTab} className="w-full text-xs">Open in new tab</Button>
      </div>
    )
  }

  if (syncMode === "folder") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
          <span>Folder connected</span>
          {polling && <span className="opacity-50">(polling...)</span>}
        </div>
        <Button variant="outline" size="sm" onClick={() => { if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }; clearFileHandles(); setSyncMode("local"); setActiveFilePath(null) }} className="w-full text-xs">Disconnect</Button>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-2 p-2 rounded-md border border-dashed border-border transition-colors", isDragging && "border-primary bg-primary/5")} onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }} onDragLeave={() => setIsDragging(false)} onDrop={(e) => { e.preventDefault(); setIsDragging(false) }}>
      <Button variant="outline" size="sm" onClick={connectLocalFolder} className="w-full justify-start text-xs">Connect local folder</Button>
      <p className="text-xs text-muted-foreground text-center">or drag & drop shader files</p>
    </div>
  )
}
