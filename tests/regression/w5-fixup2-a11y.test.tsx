// @vitest-environment happy-dom
import "../setup/rtl"
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { useState } from "react"
import { ReactFlowProvider } from "@xyflow/react"
import { VideoLoopRecorderModal } from "@/components/VideoLoopRecorderModal"
import { ExportModal } from "@/components/ExportModal"
import { TemplatesSidebar } from "@/components/sidebars/TemplatesSidebar"
import { CommentNode } from "@/components/nodes/CommentNode"
import { FrameNode } from "@/components/nodes/FrameNode"
import { SHADER_TEMPLATES } from "@/core/templates"

afterEach(() => vi.useRealTimers())

function Host({ Modal }: { Modal: typeof VideoLoopRecorderModal }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)}>opener</button>
      <Modal isOpen={open} onClose={() => setOpen(false)} />
    </>
  )
}

describe.each([["VideoLoopRecorderModal", VideoLoopRecorderModal], ["ExportModal", ExportModal]] as const)("%s dialog a11y", (_n, Modal) => {
  it("focuses in, traps Tab, closes on Escape and restores focus", () => {
    const { rerender } = render(<Host Modal={Modal as never} />)
    const dialog = screen.getByRole("dialog")
    expect(dialog.contains(document.activeElement)).toBe(true)
    const focusables = dialog.querySelectorAll<HTMLElement>("button:not([disabled]),input,select,textarea")
    const last = focusables[focusables.length - 1]
    last.focus()
    fireEvent.keyDown(document, { key: "Tab" })
    expect(document.activeElement).toBe(focusables[0])
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
    rerender(<Host Modal={Modal as never} />)
  })
})

it("Escape closes and focus returns to the opener", () => {
  function App() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>opener</button>
        <VideoLoopRecorderModal isOpen={open} onClose={() => setOpen(false)} />
      </>
    )
  }
  render(<App />)
  const opener = screen.getByText("opener")
  opener.focus()
  fireEvent.click(opener)
  expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true)
  fireEvent.keyDown(document, { key: "Escape" })
  expect(screen.queryByRole("dialog")).toBeNull()
  expect(document.activeElement).toBe(opener)
})

describe("TemplatesSidebar", () => {
  it("label matches visible text, shows uniform count, clears timer on unmount", () => {
    vi.useFakeTimers()
    const t = SHADER_TEMPLATES[0]
    const { unmount } = render(<TemplatesSidebar />)
    expect(screen.getAllByText(new RegExp(`${Object.keys(t.uniforms).length} uniforms`)).length).toBeGreaterThan(0)
    const btn = screen.getByRole("button", { name: `Load shader: ${t.name}` })
    fireEvent.click(btn)
    expect(screen.getByRole("button", { name: `Loaded: ${t.name}` }).textContent).toContain("Loaded")
    const spy = vi.spyOn(globalThis, "clearTimeout")
    unmount()
    expect(spy).toHaveBeenCalled()
    act(() => void vi.runAllTimers())
  })
})

describe("node colour swatches", () => {
  it.each([["comment", CommentNode], ["frame", FrameNode]] as const)("%s swatches have accessible names", (_n, Node) => {
    render(
      <ReactFlowProvider>
        <Node {...({ id: "n", data: {}, selected: false } as never)} />
      </ReactFlowProvider>,
    )
    expect(screen.getAllByRole("button", { name: /^Set colour: / }).length).toBeGreaterThanOrEqual(4)
  })
})
