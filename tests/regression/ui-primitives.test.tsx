// @vitest-environment happy-dom
import "../setup/rtl"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Button, IconButton, Segmented, NumericField, Tabs, TabsList, TabsTrigger, TabsContent, Section, Select, Tooltip } from "@/components/ui"
import { ThemeProvider, useTheme } from "@/components/theme-provider"

describe("ui primitives", () => {
  it("Button defaults to type=button and supports danger/legacy variants", () => {
    render(<><Button>a</Button><Button variant="destructive" size="sm">b</Button></>)
    expect(screen.getByText("a").getAttribute("type")).toBe("button")
    expect(screen.getByText("b").className).toContain("bg-danger-solid")
  })

  it("IconButton is labelled", () => {
    render(<IconButton label="Settings" tooltip={false}><span /></IconButton>)
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy()
  })

  it("Segmented selects and moves with arrow keys", () => {
    const onChange = vi.fn()
    render(<Segmented aria-label="Backend" value="a" onValueChange={onChange} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />)
    expect(screen.getByRole("radio", { name: "A" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.keyDown(screen.getByRole("radio", { name: "A" }), { key: "ArrowRight" })
    expect(onChange).toHaveBeenCalledWith("b")
  })

  it("NumericField commits on Enter, clamps, steps with arrows, scrubs by drag", () => {
    const onChange = vi.fn()
    render(<NumericField label="X" value={0.5} min={0} max={1} step={0.1} onChange={onChange} />)
    const input = screen.getByRole("textbox", { name: "X" })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "5" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onChange).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(input, { key: "ArrowUp" })
    expect(onChange).toHaveBeenLastCalledWith(0.6)
    const grip = document.querySelector("[data-scrub]") as HTMLElement
    fireEvent.pointerDown(grip, { clientX: 0, button: 0, pointerId: 1 })
    fireEvent.pointerMove(grip, { clientX: 4, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(0.7)
  })

  it("Tabs switch panels", () => {
    render(<Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger><TabsTrigger value="b">B</TabsTrigger></TabsList><TabsContent value="a">pa</TabsContent><TabsContent value="b">pb</TabsContent></Tabs>)
    expect(screen.getByText("pa")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "B" }))
    expect(screen.getByText("pb")).toBeTruthy()
    expect(screen.queryByText("pa")).toBeNull()
  })

  it("Section can start collapsed; Select renders", () => {
    render(<><Section title="Adv" defaultOpen={false}>x</Section><Select aria-label="s"><option>one</option></Select></>)
    expect(document.querySelector("details")!.hasAttribute("open")).toBe(false)
    expect(screen.getByRole("combobox", { name: "s" })).toBeTruthy()
  })
})

describe("ThemeProvider", () => {
  it("applies stored theme class synchronously and switches", () => {
    localStorage.setItem("t-key", "light")
    const Probe = () => {
      const { theme, resolvedTheme, setTheme } = useTheme()
      return <button onClick={() => setTheme("dark")}>{theme}/{resolvedTheme}</button>
    }
    render(<ThemeProvider storageKey="t-key"><Probe /></ThemeProvider>)
    expect(document.documentElement.classList.contains("light")).toBe(true)
    fireEvent.click(screen.getByRole("button"))
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(localStorage.getItem("t-key")).toBe("dark")
  })
})

describe("Tooltip", () => {
  it("merges with an existing aria-describedby instead of overwriting it", () => {
    render(<Tooltip label="tip"><button aria-describedby="hint">go</button></Tooltip>)
    const ids = screen.getByRole("button").getAttribute("aria-describedby")!.split(" ")
    expect(ids[0]).toBe("hint")
    expect(ids).toHaveLength(2)
    expect(document.getElementById(ids[1])!.getAttribute("role")).toBe("tooltip")
  })

  it("sets only the tooltip id when the child has none", () => {
    render(<Tooltip label="tip"><button>go</button></Tooltip>)
    expect(screen.getByRole("button").getAttribute("aria-describedby")!.split(" ")).toHaveLength(1)
  })
})

describe("ThemeProvider purity", () => {
  it("does not touch the DOM until the layout effect runs (initializer is pure)", () => {
    document.documentElement.className = "dark"
    localStorage.setItem("pure-key", "light")
    render(<ThemeProvider storageKey="pure-key"><span /></ThemeProvider>)
    expect(document.documentElement.classList.contains("light")).toBe(true)
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })
})
