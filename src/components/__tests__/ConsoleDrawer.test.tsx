import { describe, it, expect, beforeEach } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ConsoleDrawer } from "../layout/ConsoleDrawer"
import { useProjectStore } from "@/stores/projectStore"
import { useLayoutStore } from "@/stores/layoutStore"

describe("ConsoleDrawer Component (Requirement R4)", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject()
    useLayoutStore.setState({
      isConsoleOpen: true,
      maximizedPanel: "none",
      jumpTarget: null,
    })
  })

  // --------------------------------------------------------------------------
  // 1. Clean Diagnostics State
  // --------------------------------------------------------------------------
  it("renders 0 Errors and 0 Warnings badges when there are no compilation errors", () => {
    useProjectStore.getState().setLastCompileError(null)
    const html = renderToStaticMarkup(<ConsoleDrawer />)

    expect(html).toContain("data-testid=\"console-drawer\"")
    expect(html).toContain("data-testid=\"console-error-badge\"")
    expect(html).toContain("0 Errors")
    expect(html).toContain("data-testid=\"console-warning-badge\"")
    expect(html).toContain("0 Warnings")
    expect(html).toContain("No compilation errors or diagnostics.")
    expect(html).not.toContain("Clear Diagnostics")
  })

  // --------------------------------------------------------------------------
  // 2. Error Cards & Badges (F-CONS-01)
  // --------------------------------------------------------------------------
  it("renders parsed error cards with line/column badges and red Error badge", () => {
    useProjectStore.getState().setLastCompileError(":15:8 error: invalid type 'vec5'")
    const html = renderToStaticMarkup(<ConsoleDrawer />)

    expect(html).toContain("1 Error")
    expect(html).toContain("0 Warnings")
    expect(html).toContain("[Line 15:8]")
    expect(html).toContain("invalid type &#x27;vec5&#x27;")
    expect(html).toContain("data-testid=\"clear-diagnostics-btn\"")
    expect(html).toContain("Clear Diagnostics")
    expect(html).toContain("data-testid=\"jump-to-line-btn\"")
    expect(html).toContain("Jump")
  })

  it("renders warning cards with amber Warning badge", () => {
    useProjectStore.getState().setLastCompileError(":24:5 warning: unused variable 'u_blur'")
    const html = renderToStaticMarkup(<ConsoleDrawer />)

    expect(html).toContain("0 Errors")
    expect(html).toContain("1 Warning")
    expect(html).toContain("[Line 24:5]")
    expect(html).toContain("unused variable &#x27;u_blur&#x27;")
  })

  // --------------------------------------------------------------------------
  // 3. Clear Diagnostics Button (F-CONS-03)
  // --------------------------------------------------------------------------
  it("clearing diagnostics resets lastCompileError to null in store", () => {
    useProjectStore.getState().setLastCompileError(":42:1 error: syntax error")
    expect(useProjectStore.getState().lastCompileError).not.toBeNull()

    useProjectStore.getState().setLastCompileError(null)
    expect(useProjectStore.getState().lastCompileError).toBeNull()

    const clearedHtml = renderToStaticMarkup(<ConsoleDrawer />)
    expect(clearedHtml).toContain("0 Errors")
    expect(clearedHtml).not.toContain("Clear Diagnostics")
  })

  // --------------------------------------------------------------------------
  // 4. Click-to-Jump Line Navigation (F-CONS-02)
  // --------------------------------------------------------------------------
  it("jumpToLine navigates to target line and automatically un-maximizes Viewport", () => {
    // Maximize viewport so editor is hidden
    useLayoutStore.setState({ maximizedPanel: "viewport" })
    expect(useLayoutStore.getState().maximizedPanel).toBe("viewport")

    // Jump to line 42, col 15
    useLayoutStore.getState().jumpToLine(42, 15)

    // Viewport must be automatically un-maximized to reveal editor
    expect(useLayoutStore.getState().maximizedPanel).toBe("none")

    // Jump target must be recorded with exact coordinates
    const target = useLayoutStore.getState().jumpTarget
    expect(target).not.toBeNull()
    expect(target?.line).toBe(42)
    expect(target?.column).toBe(15)
  })

  it("does not render Jump button for errors without line numbers", () => {
    useProjectStore.getState().setLastCompileError("Shader execution timeout / watchdog triggered")
    const html = renderToStaticMarkup(<ConsoleDrawer />)

    expect(html).toContain("1 Error")
    expect(html).toContain("Shader execution timeout / watchdog triggered")
    expect(html).not.toContain("Jump")
  })

  it("does not render coordinate badges or literal '0' when line number is 0 or non-positive", () => {
    // Single line regex fallback without line number or line 0
    useProjectStore.getState().setLastCompileError("Internal driver error: 0:0: unknown failure")
    const html = renderToStaticMarkup(<ConsoleDrawer />)

    expect(html).not.toContain("[Line 0")
    expect(html).not.toContain(">0</span>")
    expect(html).not.toContain("Jump")
  })

  it("correctly renders WebGL warning badges with line coordinates", () => {
    useProjectStore.getState().setLastCompileError("WARNING: 0:7: 'u_exposure' : variable declared but not used")
    const html = renderToStaticMarkup(<ConsoleDrawer />)

    expect(html).toContain("1 Warning")
    expect(html).toContain("0 Errors")
    expect(html).toContain("[Line 7]")
    expect(html).toContain("Jump")
  })
})
