import { useState, useEffect } from "react"
import { FolderOpen, Unplug } from "lucide-react"
import { useFileSystemStore, isIframe } from "@/stores/fileSystemStore"
import { useProjectStore } from "@/stores/projectStore"
import { startFolderSync, stopFolderSync, scheduleFolderSnapshot } from "@/services/folderSync"
import { Badge, Button } from "@/components/ui"
import { cn } from "@/lib/utils"

/** Connect/disconnect UI. Polling itself lives in services/folderSync so it survives this component unmounting. */
export function FileImporter() {
  const [isDragging, setIsDragging] = useState(false)

  const setSyncMode = useFileSystemStore((state) => state.setSyncMode)
  const setFileHandle = useFileSystemStore((state) => state.setFileHandle)
  const setActiveFilePath = useFileSystemStore((state) => state.setActiveFilePath)
  const clearFileHandles = useFileSystemStore((state) => state.clearFileHandles)
  const syncMode = useFileSystemStore((state) => state.syncMode)
  const storeIsIframe = useFileSystemStore((state) => state.isIframe)

  const setShaderSource = useProjectStore((state) => state.setShaderSource)
  const setActiveShaderPath = useProjectStore((state) => state.setActiveShaderPath)
  const triggerRecompile = useProjectStore((state) => state.triggerRecompile)

  const checkIframe = isIframe || storeIsIframe

  // Folder mode that survived a tab switch / remount: make sure the service is polling.
  useEffect(() => { if (syncMode === "folder") startFolderSync() }, [syncMode])

  async function connectLocalFolder() {
    if (!("showDirectoryPicker" in window)) { alert("File System Access API is not supported in this browser"); return }
    try {
      const dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker()
      clearFileHandles()
      await readShaderFiles(dirHandle, "")
      setSyncMode("folder")
      startFolderSync()
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
            scheduleFolderSnapshot(path, content)
          }
        }
      }
    }
  }

  function disconnect() {
    stopFolderSync()
    clearFileHandles()
    setSyncMode("local")
    setActiveFilePath(null)
  }

  if (checkIframe) {
    return (
      <div className="flex flex-col gap-2">
        <Button variant="outline" size="sm" disabled className="w-full justify-start"><FolderOpen />Connect local folder</Button>
        <p className="text-xs text-fg-subtle">Open in a new tab to enable local folder sync.</p>
        <Button variant="secondary" size="sm" onClick={() => window.open(window.location.href, "_blank")} className="w-full">Open in new tab</Button>
      </div>
    )
  }

  if (syncMode === "folder") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Badge tone="info">Folder</Badge>
          <span>Connected, watching for changes</span>
        </div>
        <Button variant="outline" size="sm" onClick={disconnect} className="w-full"><Unplug />Disconnect</Button>
      </div>
    )
  }

  return (
    <div
      className={cn("flex flex-col gap-2 rounded-lg border border-dashed border-line-strong p-2 transition-colors", isDragging && "border-brand bg-brand-soft")}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false) }}
    >
      <Button variant="outline" size="sm" onClick={connectLocalFolder} className="w-full justify-start"><FolderOpen />Connect local folder</Button>
      <p className="text-center text-xs text-fg-subtle">Or drag and drop shader files</p>
    </div>
  )
}
