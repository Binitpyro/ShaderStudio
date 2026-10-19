import type { ParsedGeometry } from "./modelLoader"

type Listener = (model: ParsedGeometry | null) => void

class CustomModelRegistry {
  private activeModel: ParsedGeometry | null = null
  private listeners = new Set<Listener>()

  public setActiveModel(model: ParsedGeometry) {
    this.activeModel = model
    this.notify()
  }

  public getActiveModel(): ParsedGeometry | null {
    return this.activeModel
  }

  public hasCustomModel(): boolean {
    return this.activeModel !== null
  }

  public clearActiveModel() {
    this.activeModel = null
    this.notify()
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.activeModel)
      } catch (e) {
        console.error("CustomModelRegistry listener error:", e)
      }
    }
  }
}

export const customModelRegistry = new CustomModelRegistry()
