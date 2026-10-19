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
          "flex h-full w-full flex-col items-center justify-center p-6 text-center select-none overflow-auto bg-card/90 text-foreground border border-border/60 rounded-md",
          className
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-3 ring-1 ring-destructive/20">
          <AlertTriangle className="h-5 w-5" />
        </div>

        <h3 className="text-sm font-semibold tracking-tight text-foreground">
          {fallbackTitle}
        </h3>

        <p className="mt-1 max-w-sm text-xs text-muted-foreground break-words">
          {errorMessage}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={this.resetErrorBoundary}
            className="h-8 gap-1.5 px-3 text-xs cursor-pointer border-border hover:bg-accent hover:text-accent-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Try Again</span>
          </Button>

          {showDetailsToggle && (error?.stack || errorInfo?.componentStack) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={this.toggleDetails}
              className="h-8 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {showDetails ? "Hide Details" : "Show Details"}
            </Button>
          )}
        </div>

        {showDetails && (
          <div className="mt-3 w-full max-w-md text-left">
            <pre className="max-h-48 overflow-auto rounded bg-destructive/10 border border-destructive/20 p-2.5 font-mono text-[11px] leading-relaxed text-destructive whitespace-pre-wrap break-all shadow-inner">
              {error?.stack || errorMessage}
              {errorInfo?.componentStack && `\n\nComponent Stack:${errorInfo.componentStack}`}
            </pre>
          </div>
        )}
      </div>
    )
  }
}
