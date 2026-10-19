import { useState, useCallback, useRef } from "react"
import { useProjectStore, type ProjectData } from "@/stores/projectStore"
import { saveProject, loadProject, listProjects, deleteProject } from "@/db"
import { Button } from "@/components/ui/button"
import { Save, FolderOpen, Download, Upload, FilePlus, Trash2, Sparkles, HardDriveDownload, HardDriveUpload } from "lucide-react"
import { createProjectFromShadertoy } from "@/core/shadertoyImporter"
import {
  isTauri,
  saveProjectNative,
  loadProjectNative,
  pickOpenProjectPath,
  pickSaveProjectPath,
} from "@/desktop/tauriBridge"


export function ProjectPanel() {
  const [projects, setProjects] = useState<Array<{ name: string; updatedAt: number }>>([])
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [projectName, setProjectName] = useState("")
  const [showLoadDialog, setShowLoadDialog] = useState(false)
  const [showShadertoyDialog, setShowShadertoyDialog] = useState(false)
  const [shadertoyCode, setShadertoyCode] = useState("")
  const [shadertoyName, setShadertoyName] = useState("Shadertoy Import")
  const [shadertoyError, setShadertoyError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentProjectName = useProjectStore((s) => s.currentProjectName)
  const setCurrentProjectName = useProjectStore((s) => s.setCurrentProjectName)
  const loadProjectData = useProjectStore((s) => s.loadProjectData)
  const exportProjectData = useProjectStore((s) => s.exportProjectData)
  const resetProject = useProjectStore((s) => s.resetProject)
  const setHasUnsavedChanges = useProjectStore((s) => s.setHasUnsavedChanges)
  const triggerRecompile = useProjectStore((s) => s.triggerRecompile)

  const refreshProjects = useCallback(async () => {
    const list = await listProjects()
    setProjects(list.sort((a, b) => b.updatedAt - a.updatedAt))
  }, [])

  const handleSave = useCallback(async () => {
    const name = projectName || currentProjectName || "Untitled"
    const data = exportProjectData()
    data.name = name
    await saveProject(data)
    setCurrentProjectName(name)
    setHasUnsavedChanges(false)
    setShowSaveDialog(false)
    setProjectName("")
  }, [projectName, currentProjectName, exportProjectData, setCurrentProjectName, setHasUnsavedChanges])

  const handleLoad = useCallback(async (name: string) => {
    const data = await loadProject(name)
    if (data) {
      loadProjectData(data)
      triggerRecompile()
      setShowLoadDialog(false)
    }
  }, [loadProjectData, triggerRecompile])

  const handleDelete = useCallback(async (name: string) => {
    await deleteProject(name)
    refreshProjects()
  }, [refreshProjects])

  const handleExportBundle = useCallback(() => {
    const data = exportProjectData()
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${data.name || "project"}.shaderstudio`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [exportProjectData])

  const processProjectJSON = useCallback(async (jsonText: string) => {
    try {
      setImportError(null)
      const data = JSON.parse(jsonText) as ProjectData
      if (!data || typeof data !== "object") {
        throw new Error("Invalid project file: not an object")
      }
      if (!data.backend) {
        throw new Error("Invalid project file: missing backend specification")
      }
      loadProjectData(data)
      triggerRecompile()
      await saveProject(data)
    } catch (err: any) {
      setImportError(err.message || "Failed to parse project file")
    }
  }, [loadProjectData, triggerRecompile])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      if (content) processProjectJSON(content)
    }
    reader.readAsText(file)
    e.target.value = ""
  }, [processProjectJSON])

  const handleNewProject = useCallback(() => {
    if (window.confirm("Start a new project? Any unsaved changes will be cleared.")) {
      resetProject()
    }
  }, [resetProject])

  const handleImportShadertoy = useCallback(async () => {
    try {
      setShadertoyError(null)
      if (!shadertoyCode.trim()) {
        throw new Error("Please paste Shadertoy GLSL code.")
      }
      const data = createProjectFromShadertoy(shadertoyCode, shadertoyName || "Shadertoy Import")
      loadProjectData(data)
      triggerRecompile()
      await saveProject(data)
      setCurrentProjectName(data.name)
      setShowShadertoyDialog(false)
      setShadertoyCode("")
    } catch (err: any) {
      setShadertoyError(err.message || "Failed to import Shadertoy shader")
    }
  }, [shadertoyCode, shadertoyName, loadProjectData, triggerRecompile, setCurrentProjectName])

  const handleNativeSave = useCallback(async () => {
    try {
      setImportError(null)
      const data = exportProjectData()
      let fileName = `${data.name || "project"}.shaderstudio`
      if (isTauri()) {
        const picked = await pickSaveProjectPath(fileName)
        if (!picked) return
        fileName = picked
      }
      const json = JSON.stringify(data, null, 2)
      await saveProjectNative(fileName, json)
      setHasUnsavedChanges(false)
    } catch (err: any) {
      setImportError(err.message || "Failed to save native project")
    }
  }, [exportProjectData, setHasUnsavedChanges])

  const handleNativeLoad = useCallback(async () => {
    try {
      setImportError(null)
      let targetPath: string | undefined = undefined
      if (isTauri()) {
        const picked = await pickOpenProjectPath()
        if (!picked) return
        targetPath = picked
      }
      const [, content] = await loadProjectNative(targetPath)
      if (content) {
        await processProjectJSON(content)
      }
    } catch (err: any) {
      setImportError(err.message || "Failed to load native project")
    }
  }, [processProjectJSON])

  return (
    <div className="flex flex-col gap-2">
      <input
        type="file"
        ref={fileInputRef}
        accept=".json,.shaderstudio"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={handleNewProject}
          title="New Project"
          className="text-[11px] h-7 px-1.5 gap-1"
        >
          <FilePlus className="h-3 w-3" />
          <span>New</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSaveDialog(true)}
          title="Save Project to DB"
          className="text-[11px] h-7 px-1.5 gap-1"
        >
          <Save className="h-3 w-3" />
          <span>Save</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { refreshProjects(); setShowLoadDialog(true) }}
          title="Load Project from DB"
          className="text-[11px] h-7 px-1.5 gap-1"
        >
          <FolderOpen className="h-3 w-3" />
          <span>Load</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          title="Import .shaderstudio or .json file"
          className="text-[11px] h-7 px-1.5 gap-1"
        >
          <Upload className="h-3 w-3" />
          <span>Import</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowShadertoyDialog(true)}
          title="Import Shadertoy shader"
          className="text-[11px] h-7 px-1.5 gap-1 text-primary hover:text-primary"
        >
          <Sparkles className="h-3 w-3" />
          <span>Shadertoy</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportBundle}
          title="Export as .shaderstudio bundle"
          className="text-[11px] h-7 px-1.5 gap-1"
        >
          <Download className="h-3 w-3" />
          <span>Export</span>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-1 pt-1 border-t border-border/50">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleNativeSave}
          title="Save to native .shaderstudio file"
          className="text-[11px] h-7 px-1.5 gap-1"
        >
          <HardDriveDownload className="h-3 w-3" />
          <span>Native Save</span>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleNativeLoad}
          title="Load from native .shaderstudio file"
          className="text-[11px] h-7 px-1.5 gap-1"
        >
          <HardDriveUpload className="h-3 w-3" />
          <span>Native Open</span>
        </Button>
      </div>

      {importError && (
        <div className="text-[10px] text-destructive bg-destructive/10 p-1.5 rounded border border-destructive/20">
          {importError}
        </div>
      )}

      {showSaveDialog && (
        <div className="flex flex-col gap-2 p-2 bg-background rounded border border-border">
          <input
            type="text"
            placeholder="Project name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1 bg-background"
          />
          <div className="flex gap-1">
            <Button variant="secondary" size="sm" onClick={handleSave} className="flex-1 text-xs">Save</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowSaveDialog(false)} className="flex-1 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      {showLoadDialog && (
        <div className="flex flex-col gap-2 p-2 bg-background rounded border border-border max-h-48 overflow-auto">
          {projects.length === 0 && <span className="text-xs text-muted-foreground">No saved projects</span>}
          {projects.map((p) => (
            <div key={p.name} className="flex items-center gap-2">
              <button
                onClick={() => handleLoad(p.name)}
                className="flex-1 text-xs text-left hover:text-primary truncate"
              >
                {p.name}
              </button>
              <button
                onClick={() => handleDelete(p.name)}
                className="text-xs text-muted-foreground hover:text-destructive p-1"
                title="Delete project"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setShowLoadDialog(false)} className="text-xs mt-1">Cancel</Button>
        </div>
      )}

      {showShadertoyDialog && (
        <div className="flex flex-col gap-2 p-2 bg-background rounded border border-border">
          <div className="text-xs font-semibold text-foreground flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-primary" />
              Import from Shadertoy
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">mainImage(...)</span>
          </div>
          <input
            type="text"
            placeholder="Project name"
            value={shadertoyName}
            onChange={(e) => setShadertoyName(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1 bg-background"
          />
          <textarea
            placeholder="Paste Shadertoy GLSL code here (void mainImage...)"
            value={shadertoyCode}
            onChange={(e) => setShadertoyCode(e.target.value)}
            rows={5}
            className="text-xs border border-border rounded px-2 py-1 bg-background font-mono resize-none"
          />
          {shadertoyError && (
            <div className="text-[10px] text-destructive bg-destructive/10 p-1 rounded">
              {shadertoyError}
            </div>
          )}
          <div className="flex gap-1">
            <Button variant="secondary" size="sm" onClick={handleImportShadertoy} className="flex-1 text-xs">Import Shader</Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowShadertoyDialog(false)
                setShadertoyError(null)
                setShadertoyCode("")
              }}
              className="flex-1 text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
