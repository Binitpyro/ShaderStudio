import { describe, it, expect, vi } from "vitest"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"

describe("ErrorBoundary Component", () => {
  it("initializes with hasError false and renders children normally", () => {
    const child = React.createElement("div", { id: "test-child" }, "Normal content")
    const boundary = new ErrorBoundary({ children: child })

    expect(boundary.state.hasError).toBe(false)
    expect(boundary.state.error).toBeNull()

    const rendered = renderToStaticMarkup(boundary.render() as React.ReactElement)
    expect(rendered).toContain("Normal content")
  })

  it("updates state via getDerivedStateFromError when error is thrown", () => {
    const error = new Error("Simulated tokenizer crash")
    const nextState = ErrorBoundary.getDerivedStateFromError(error)

    expect(nextState.hasError).toBe(true)
    expect(nextState.error).toBe(error)
  })

  it("calls onError callback in componentDidCatch", () => {
    const onErrorSpy = vi.fn()
    const error = new Error("DOM layout overflow")
    const errorInfo: React.ErrorInfo = { componentStack: "\n    in MonacoEditor" }

    const boundary = new ErrorBoundary({
      children: React.createElement("div"),
      fallbackTitle: "Shader Editor Error",
      onError: onErrorSpy,
    })

    boundary.componentDidCatch(error, errorInfo)
    expect(onErrorSpy).toHaveBeenCalledTimes(1)
    expect(onErrorSpy).toHaveBeenCalledWith(error, errorInfo)
    expect(boundary.state.errorInfo).toEqual(errorInfo)
  })

  it("renders dark-mode fallback card with role='alert', title, and error message on error", () => {
    const boundary = new ErrorBoundary({
      children: React.createElement("div"),
      fallbackTitle: "Viewport Error",
      fallbackMessage: "Default fallback message",
    })

    boundary.state = {
      hasError: true,
      error: new Error("WebGL context lost unexpectedly"),
      errorInfo: null,
      showDetails: false,
    }

    const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
    expect(html).toContain("role=\"alert\"")
    expect(html).toContain("Viewport Error")
    expect(html).toContain("WebGL context lost unexpectedly")
    expect(html).toContain("Try Again")
    expect(html).toContain("Show Details")
  })

  it("supports custom fallbackRender prop", () => {
    const fallbackRender = vi.fn(({ error }) => {
      return React.createElement("div", { id: "custom-fallback" }, `Custom: ${error.message}`)
    })

    const boundary = new ErrorBoundary({
      children: React.createElement("div"),
      fallbackRender,
    })

    const error = new Error("Custom crash")
    boundary.state = {
      hasError: true,
      error,
      errorInfo: null,
      showDetails: false,
    }

    const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
    expect(html).toContain("Custom: Custom crash")
    expect(fallbackRender).toHaveBeenCalledTimes(1)
  })

  it("toggles stack trace details when toggleDetails is invoked", () => {
    const boundary = new ErrorBoundary({ children: React.createElement("div") })
    expect(boundary.state.showDetails).toBe(false)

    boundary.toggleDetails()
    expect(boundary.state.showDetails).toBe(true)

    boundary.toggleDetails()
    expect(boundary.state.showDetails).toBe(false)
  })

  it("resets internal state and invokes onReset when resetErrorBoundary is called", () => {
    const onResetSpy = vi.fn()
    const boundary = new ErrorBoundary({
      children: React.createElement("div"),
      onReset: onResetSpy,
    })

    boundary.state = {
      hasError: true,
      error: new Error("Crash"),
      errorInfo: { componentStack: "stack" },
      showDetails: true,
    }

    boundary.resetErrorBoundary()
    expect(boundary.state.hasError).toBe(false)
    expect(boundary.state.error).toBeNull()
    expect(boundary.state.errorInfo).toBeNull()
    expect(boundary.state.showDetails).toBe(false)
    expect(onResetSpy).toHaveBeenCalledTimes(1)
  })
})
