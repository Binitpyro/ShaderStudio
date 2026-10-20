// @vitest-environment happy-dom
import "../setup/rtl"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { NodePaletteModal, NODE_PALETTE_ITEMS } from "@/components/NodePaletteModal"

function setup() {
  const onClose = vi.fn()
  const onSelectNode = vi.fn()
  render(<NodePaletteModal isOpen onClose={onClose} onSelectNode={onSelectNode} />)
  return { onClose, onSelectNode, input: screen.getByRole("combobox", { name: "Search nodes" }) }
}

describe("node palette (command palette)", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<NodePaletteModal isOpen={false} onClose={() => {}} onSelectNode={() => {}} />)
    expect(container.innerHTML).toBe("")
  })

  it("groups results under category headings and selects the first option", () => {
    setup()
    const options = screen.getAllByRole("option")
    expect(options.length).toBeGreaterThanOrEqual(NODE_PALETTE_ITEMS.length)
    expect(options[0].getAttribute("aria-selected")).toBe("true")
    expect(screen.getByText("Geometry", { selector: "div" })).toBeTruthy()
  })

  it("ArrowDown/ArrowUp move the selection (wrapping) and Enter inserts the highlighted node then closes", () => {
    const { input, onSelectNode, onClose } = setup()
    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true")
    fireEvent.keyDown(input, { key: "ArrowUp" })
    fireEvent.keyDown(input, { key: "ArrowUp" }) // wraps to last
    const opts = screen.getAllByRole("option")
    expect(opts[opts.length - 1].getAttribute("aria-selected")).toBe("true")
    fireEvent.keyDown(input, { key: "ArrowDown" }) // wraps to first
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSelectNode).toHaveBeenCalledTimes(1)
    expect(onSelectNode.mock.calls[0][0]).toBe(NODE_PALETTE_ITEMS.find((i) => i.category === "Geometry")!.type)
    expect(onClose).toHaveBeenCalled()
  })

  it("typing filters, resets the selection and shows an empty state", () => {
    const { input, onSelectNode } = setup()
    fireEvent.change(input, { target: { value: "bloom" } })
    const opts = screen.getAllByRole("option")
    expect(opts).toHaveLength(1)
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSelectNode).toHaveBeenCalledWith("postprocess", expect.objectContaining({ passType: "bloom" }))

    fireEvent.change(input, { target: { value: "zzzz-nothing" } })
    expect(screen.queryAllByRole("option")).toHaveLength(0)
    expect(screen.getByText(/No matching nodes/)).toBeTruthy()
  })

  it("Escape closes; clicking an option inserts it", () => {
    const { input, onClose, onSelectNode } = setup()
    fireEvent.keyDown(input, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getAllByRole("option")[2])
    expect(onSelectNode).toHaveBeenCalledTimes(1)
  })

  it("category chips filter the list", () => {
    setup()
    fireEvent.click(screen.getByRole("button", { name: "Output" }))
    const opts = screen.getAllByRole("option")
    expect(opts.length).toBeGreaterThan(0)
    expect(opts.length).toBeLessThan(NODE_PALETTE_ITEMS.length)
  })
})
