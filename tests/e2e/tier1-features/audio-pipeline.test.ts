import { describe, it, expect, beforeEach, afterEach } from "vitest"
import type { Node, Edge } from "@xyflow/react"
import {
  compileGraph,
  hasAudioNode,
  type GraphNodeData,
  type AudioStep,
} from "@/core/graphCompiler"
import { AudioEngine, audioEngine } from "@/audio/audioEngine"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { useProjectStore } from "@/stores/projectStore"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment, type E2ETestEnvironment } from "../mocks"

describe("Audio-Reactive Shaders & Real-Time FFT Pipeline Suite", () => {
  let env: E2ETestEnvironment

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    useProjectStore.getState().setIsAudioPlaying(false)
    useProjectStore.getState().setAudioSourceType("builtin")
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  describe("Web Audio DSP Engine", () => {
    it("initializes AudioEngine with 512-bin buffers and default parameters", () => {
      const engine = new AudioEngine()
      expect(engine.binCount).toBe(512)
      expect(engine.textureBuffer.length).toBe(1024) // 512 x 2
      expect(engine.getVolume()).toBe(0.8)
      expect(engine.getGainMultiplier()).toBe(1.2)
      expect(engine.getSmoothing()).toBe(0.8)
      expect(engine.getSourceType()).toBe("builtin")
      expect(engine.getIsPlaying()).toBe(false)
    })

    it("updates volume, gain multiplier, and smoothing parameters within valid bounds", () => {
      const engine = new AudioEngine()

      engine.setVolume(0.5)
      expect(engine.getVolume()).toBe(0.5)
      engine.setVolume(2.0) // clamped to 1.0
      expect(engine.getVolume()).toBe(1.0)

      engine.setGainMultiplier(2.5)
      expect(engine.getGainMultiplier()).toBe(2.5)

      engine.setSmoothing(0.9)
      expect(engine.getSmoothing()).toBe(0.9)
      engine.setSmoothing(1.5) // clamped to 0.95
      expect(engine.getSmoothing()).toBe(0.95)
    })

    it("produces valid textureBuffer and AudioUniforms on update", () => {
      const engine = new AudioEngine()
      const { textureBuffer, uniforms } = engine.update()

      expect(textureBuffer).toBeInstanceOf(Uint8Array)
      expect(textureBuffer.length).toBe(1024)

      expect(typeof uniforms.bass).toBe("number")
      expect(typeof uniforms.mid).toBe("number")
      expect(typeof uniforms.treble).toBe("number")
      expect(typeof uniforms.level).toBe("number")
      expect(typeof uniforms.beat).toBe("number")

      expect(uniforms.bass).toBeGreaterThanOrEqual(0)
      expect(uniforms.bass).toBeLessThanOrEqual(1.0)
      expect(uniforms.beat).toBeGreaterThanOrEqual(0)
    })

    it("toggles play state cleanly", () => {
      const engine = new AudioEngine()
      expect(engine.getIsPlaying()).toBe(false)
      // Toggle play when headless (safe no-op/handled without unhandled rejection)
      engine.pause()
      expect(engine.getIsPlaying()).toBe(false)
    })
  })

  describe("Graph Compiler with AudioNode", () => {
    it("compiles AudioNode -> MaterialNode -> OutputNode successfully", () => {
      const nodes: Node<GraphNodeData>[] = [
        {
          id: "audio-1",
          type: "audio",
          position: { x: 0, y: 0 },
          data: {
            type: "audio",
            sourceType: "builtin",
            volume: 0.9,
            gain: 1.5,
            smoothing: 0.85,
          },
        },
        {
          id: "mesh-1",
          type: "mesh",
          position: { x: 0, y: 150 },
          data: { type: "mesh", geometry: "cube" },
        },
        {
          id: "mat-1",
          type: "material",
          position: { x: 220, y: 50 },
          data: { type: "material", shaderPath: "audio_spectrum.wgsl" },
        },
        {
          id: "out-1",
          type: "output",
          position: { x: 450, y: 50 },
          data: { type: "output" },
        },
      ]

      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "audio-1", target: "mat-1", targetHandle: "texture" },
        { id: "e3", source: "mat-1", target: "out-1" },
      ]

      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      expect(result.queue.length).toBeGreaterThanOrEqual(3)

      const audioStep = result.queue.find((s) => s.type === "audio") as AudioStep
      expect(audioStep).toBeDefined()
      expect(audioStep.type).toBe("audio")
      expect(audioStep.sourceType).toBe("builtin")
      expect(audioStep.volume).toBe(0.9)
      expect(audioStep.gain).toBe(1.5)

      // Verify material received audioTexture binding
      const matStep = result.queue.find((s) => s.type === "material") as any
      expect(matStep).toBeDefined()
      expect(matStep.textureBindings["audioTexture"]).toBe("audioTexture")
    })

    it("detects AudioNode presence with hasAudioNode helper", () => {
      const withAudio: Node<GraphNodeData>[] = [
        { id: "a1", type: "audio", position: { x: 0, y: 0 }, data: { type: "audio" } },
        { id: "out-1", type: "output", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const withoutAudio: Node<GraphNodeData>[] = [
        { id: "m1", type: "mesh", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "sphere" } },
        { id: "out-1", type: "output", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]

      expect(hasAudioNode(withAudio)).toBe(true)
      expect(hasAudioNode(withoutAudio)).toBe(false)
    })

    it("correctly integrates AudioNode with ComputeNode and MaterialNode", () => {
      const nodes: Node<GraphNodeData>[] = [
        {
          id: "audio-1",
          type: "audio",
          position: { x: 0, y: 0 },
          data: { type: "audio", sourceType: "file" },
        },
        {
          id: "comp-1",
          type: "compute",
          position: { x: 200, y: 0 },
          data: { type: "compute", preset: "audio_vortex", particleCount: 25000 },
        },
        {
          id: "mat-1",
          type: "material",
          position: { x: 400, y: 0 },
          data: { type: "material", shaderPath: "audio_spectrum.wgsl" },
        },
        {
          id: "out-1",
          type: "output",
          position: { x: 600, y: 0 },
          data: { type: "output" },
        },
      ]

      const edges: Edge[] = [
        { id: "e1", source: "comp-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "audio-1", target: "mat-1", targetHandle: "audio" },
        { id: "e3", source: "mat-1", target: "out-1" },
      ]

      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()

      const types = result.queue.map((s) => s.type)
      expect(types).toContain("audio")
      expect(types).toContain("compute")
      expect(types).toContain("material")
    })
  })

  describe("Project Store Audio State & Serialization", () => {
    it("updates and retrieves audio state via store actions", () => {
      const store = useProjectStore.getState()
      expect(store.isAudioPlaying).toBe(false)

      store.setIsAudioPlaying(true)
      expect(useProjectStore.getState().isAudioPlaying).toBe(true)

      store.setAudioSourceType("mic")
      expect(useProjectStore.getState().audioSourceType).toBe("mic")

      store.setAudioVolume(0.65)
      expect(useProjectStore.getState().audioVolume).toBe(0.65)

      store.setAudioGain(1.8)
      expect(useProjectStore.getState().audioGain).toBe(1.8)

      store.setAudioSmoothing(0.75)
      expect(useProjectStore.getState().audioSmoothing).toBe(0.75)
    })

    it("serializes and restores audioSettings in project export / import", () => {
      const store = useProjectStore.getState()
      store.setAudioSourceType("file")
      store.setAudioVolume(0.42)
      store.setAudioGain(2.2)
      store.setAudioSmoothing(0.88)
      store.setCurrentProjectName("AudioVisualizer")

      const exported = store.exportProjectData()
      expect(exported.audioSettings).toBeDefined()
      expect(exported.audioSettings?.sourceType).toBe("file")
      expect(exported.audioSettings?.volume).toBe(0.42)
      expect(exported.audioSettings?.gain).toBe(2.2)
      expect(exported.audioSettings?.smoothing).toBe(0.88)

      // Reset and reload
      store.setAudioSourceType("builtin")
      store.setAudioVolume(1.0)
      store.loadProjectData(exported)

      const restored = useProjectStore.getState()
      expect(restored.audioSourceType).toBe("file")
      expect(restored.audioVolume).toBe(0.42)
      expect(restored.audioGain).toBe(2.2)
      expect(restored.audioSmoothing).toBe(0.88)
    })
  })

  describe("Rendering Adapters Audio Integration", () => {
    it("WebGPUAdapter accepts updateAudioData without error", async () => {
      const canvas = env.createCanvas()
      const mounted = await webgpuAdapter.mount(canvas as any)
      expect(mounted).toBe(true)

      const dummyTexture = new Uint8Array(1024).fill(128)
      const dummyUniforms = { bass: 0.6, mid: 0.4, treble: 0.3, level: 0.5, beat: 1.0 }

      expect(() => {
        webgpuAdapter.updateAudioData?.(dummyTexture, dummyUniforms)
      }).not.toThrow()
    })

    it("WebGL2Adapter accepts updateAudioData without error", async () => {
      const canvas = env.createCanvas()
      const mounted = await webgl2Adapter.mount(canvas as any)
      expect(mounted).toBe(true)

      const dummyTexture = new Uint8Array(1024).fill(128)
      const dummyUniforms = { bass: 0.8, mid: 0.5, treble: 0.2, level: 0.6, beat: 0.0 }

      expect(() => {
        webgl2Adapter.updateAudioData?.(dummyTexture, dummyUniforms)
      }).not.toThrow()
    })
  })
})
