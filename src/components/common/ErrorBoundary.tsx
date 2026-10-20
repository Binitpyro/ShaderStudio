import * as React from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface ErrorBoundaryProps {
  children: React.ReactNode
  fallbackTitle?: string
  fallbackMessage?: string
  onReset?: () => void
  onError?: (error: Error, errorInfo?: React.ErrorInfo) => void
  fallbackRender?: (props: { error: Error; resetErrorBoundary: () => void }) => React.ReactNode
  className?: string
  showDetailsToggle?: boolean
}

export interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
  showDetails: boolean
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  private safeSetState(updater: Partial<ErrorBoundaryState>): void {
    const isMounted = typeof (this as any).updater?.isMounted === "function"
      ? (this as any).updater.isMounted(this)
      : (this as any)._reactInternals !== undefined
    if (isMounted) {
      this.setState(updater as any)
    } else {
      this.state = { ...this.state, ...updater }
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.safeSetState({ errorInfo })
    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }
    console.error(`[ErrorBoundary: ${this.props.fallbackTitle || "Error"}]`, error, errorInfo)
  }

  resetErrorBoundary = (): void => {
    this.safeSetState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    })
    if (this.props.onReset) {
      this.props.onReset()
    }
  }

  toggleDetails = (): void => {
    this.safeSetState({ showDetails: !this.state.showDetails })
  }

  render(): React.ReactNode {
    const { hasError, error, errorInfo, showDetails } = this.state
    const {
      children,
      fallbackTitle = "Application Error",
      fallbackMessage = "An unexpected error occurred",
      fallbackRender,
      className,
      showDetailsToggle = true,
    } = this.props

    if (!hasError) {
      return children
    }

    if (fallbackRender && error) {
      return fallbackRender({ error, resetErrorBoundary: this.resetErrorBoundary })
    }

    const errorMessage = error?.message || fallbackMessage

    return (
      <div
        role="alert"
        className={cn(
          "flex h-full w-full flex-col items-center justify-center overflow-auto bg-panel p-6 text-center text-fg",
          className
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-soft text-danger mb-3">
          <AlertTriangle className="h-5 w-5" />
        </div>

        <h3 className="text-sm font-medium text-fg">
          {fallbackTitle}
        </h3>

        <p className="mt-1 max-w-sm text-xs text-fg-muted break-words">
          {errorMessage}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <Button
            variant="secondary" size="sm" onClick={this.resetErrorBoundary}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Try Again</span>
          </Button>

          {showDetailsToggle && (error?.stack || errorInfo?.componentStack) && (
            <Button
              variant="ghost" size="sm" onClick={this.toggleDetails}
            >
              {showDetails ? "Hide Details" : "Show Details"}
            </Button>
          )}
        </div>

        {showDetails && (
          <div className="mt-3 w-full max-w-md text-left">
            <pre className="max-h-48 overflow-auto rounded-md bg-danger-soft p-2.5 font-mono text-2xs text-danger whitespace-pre-wrap break-all">
              {error?.stack || errorMessage}
              {errorInfo?.componentStack && `\n\nComponent Stack:${errorInfo.componentStack}`}
            </pre>
          </div>
        )}
      </div>
    )
  }
}
