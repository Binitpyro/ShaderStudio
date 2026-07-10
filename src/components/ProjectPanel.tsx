import { useState, useCallback } from "react"
import { useProjectStore } from "@/stores/projectStore"
import { saveProject, loadProject, listProjects, deleteProject } from "@/db"
import { Button } from "@/components/ui/button"

export function ProjectPanel() {
  const [projects, setProjects] = useState<Array<{ name: string; updatedAt: number }>>([])
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [projectName, setProjectName] = useState("")
  const [showLoadDialog, setShowLoadDialog] = useState(false)

  const currentProjectName = useProjectStore((s) => s.currentProjectName)
  const setCurrentProjectName = useProjectStore((s) => s.setCurrentProjectName)
  const loadProjectData = useProjectStore((s) => s.loadProjectData)
  const exportProjectData = useProjectStore((s) => s.exportProjectData)
  const setHasUnsavedChanges = useProjectStore((s) => s.setHasUnsavedChanges)

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
      setShowLoadDialog(false)
    }
  }, [loadProjectData])

  const handleDelete = useCallback(async (name: string) => {
    await deleteProject(name)
    refreshProjects()
  }, [refreshProjects])

  const handleExportJSON = useCallback(() => {
    const data = exportProjectData()
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${data.name}-project.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [exportProjectData])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        <Button variant="outline" size="sm" onClick={() => setShowSaveDialog(true)} className="flex-1 text-xs">Save</Button>
        <Button variant="outline" size="sm" onClick={() => { refreshProjects(); setShowLoadDialog(true) }} className="flex-1 text-xs">Load</Button>
        <Button variant="outline" size="sm" onClick={handleExportJSON} className="flex-1 text-xs">Export</Button>
      </div>

      {showSaveDialog && (
        <div className="flex flex-col gap-2 p-2 bg-background rounded border border-border">
          <input
            type="text"
            placeholder="Project name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1"
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
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                del
              </button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setShowLoadDialog(false)} className="text-xs mt-1">Cancel</Button>
        </div>
      )}
    </div>
  )
}
