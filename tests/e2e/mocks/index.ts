/**
 * Central Mock Infrastructure for E2E Testing
 */

import { setupDOMEnvironment, teardownDOMEnvironment, MockCanvasElement } from "./mockDOM"
import { mockClock, MockClock } from "./mockTiming"
import { setupWebGPUMock, teardownWebGPUMock, type MockNavigatorGPU, type MockGPUDevice } from "./mockWebGPU"
import { setupWebGL2Mock, teardownWebGL2Mock, type MockWebGL2RenderingContext } from "./mockWebGL2"
import { MockThreeRenderer } from "./mockThreeJS"
import { useProjectStore } from "@/stores/projectStore"

export * from "./mockDOM"
export * from "./mockTiming"
export * from "./mockWebGPU"
export * from "./mockWebGL2"
export * from "./mockThreeJS"

export interface E2ETestEnvironment {
  clock: MockClock
  canvas: MockCanvasElement
  webgpu: {
    gpu: MockNavigatorGPU
    getDevice: () => MockGPUDevice | null
  }
  webgl2: {
    getLastContext: () => MockWebGL2RenderingContext | null
  }
  createCanvas: (width?: number, height?: number) => MockCanvasElement
}

export function setupE2ETestEnvironment(): E2ETestEnvironment {
  setupDOMEnvironment()
  mockClock.install()
  mockClock.reset()
  const webgpu = setupWebGPUMock()
  const webgl2 = setupWebGL2Mock()
  MockThreeRenderer.reset()

  // Reset Zustand project store to default clean state
  useProjectStore.setState({
    activeBackend: "webgpu",
    shaderSource: "",
    activeShaderPath: null,
    parsedUniforms: [],
    uniformValues: {},
    lastCompileError: null,
    deviceLost: false,
    autoCompile: true,
    recompileTrigger: 0,
    graphUniforms: [],
    textureResources: [],
    renderQueue: null,
    _graphNodes: [],
    _graphEdges: [],
    currentProjectName: null,
    hasUnsavedChanges: false,
  })

  const primaryCanvas = new MockCanvasElement(800, 600)

  return {
    clock: mockClock,
    canvas: primaryCanvas,
    webgpu,
    webgl2,
    createCanvas: (w = 800, h = 600) => new MockCanvasElement(w, h),
  }
}

export function teardownE2ETestEnvironment(): void {
  mockClock.uninstall()
  mockClock.reset()
  teardownWebGPUMock()
  teardownWebGL2Mock()
  teardownDOMEnvironment()
  MockThreeRenderer.reset()
}
