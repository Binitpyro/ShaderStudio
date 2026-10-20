// @vitest-environment happy-dom
import "../setup/rtl"
import { describe, it, expect, vi, beforeAll } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("@/components/PostProcessDrawer", () => ({ PostProcessDrawer: () => null }))

import { NodeGraph } from "@/components/NodeGraph"
import { useProjectStore } from "@/stores/projectStore"

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal("ResizeObserver", RO)
  ;(globalThis as any).DOMMatrixReadOnly ??= class { m22 = 1; constructor() {} }
})

describe("NodeGraph chrome", () => {
  it("shows the empty-state hint and opens the palette on Space inside the graph only", () => {
    useProjectStore.getState().resetProject()
    useProjectStore.getState().setGraphNodes([])
    useProjectStore.getState().setGraphEdges([])
    const { container } = render(<NodeGraph />)
    expect(screen.getByTestId("graph-empty-state").textContent).toContain("to add a node")

    // Space outside the graph (window/body) is ignored by the graph: it must never open the palette
    fireEvent.keyDown(document.body, { code: "Space", key: " " })
    expect(screen.queryByRole("dialog", { name: "Add node" })).toBeNull()

    const root = container.querySelector("[data-node-graph]") as HTMLElement
    const ev = fireEvent.keyDown(root, { code: "Space", key: " " })
    expect(ev).toBe(false) // default prevented
    expect(screen.getByRole("dialog", { name: "Add node" })).toBeTruthy()
  })

  it("Space typed in the palette search does not re-trigger the graph handler", () => {
    useProjectStore.getState().setGraphNodes([])
    render(<NodeGraph />)
    fireEvent.keyDown(document.querySelector("[data-node-graph]")!, { code: "Space", key: " " })
    const input = screen.getByRole("combobox", { name: "Search nodes" })
    const notPrevented = fireEvent.keyDown(input, { code: "Space", key: " " })
    expect(notPrevented).toBe(true)
  })
})
