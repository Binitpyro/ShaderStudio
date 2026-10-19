import type { AISettings, ChatMessage, GenerationSession, IterationStep } from "./types"
import { dispatchAICall, extractShaderCode } from "./providers"
import { executeShaderLocally } from "@/bridge/wsBridgeClient"
import { useProjectStore } from "@/stores/projectStore"

function buildSystemPrompt(backend: "webgpu" | "webgl2" | "threejs"): string {
  if (backend === "webgpu") {
    return `You are a world-class WebGPU (WGSL) graphics engineer.
Your task is to write high-performance, visually stunning procedural WGSL shaders for Shader Studio.

RULES FOR WGSL:
1. Provide a complete, valid WGSL source containing BOTH vertex and fragment entrypoints:
   - Vertex entry point: @vertex fn vertex_main(@location(0) position: vec3f) -> VertexOutput
   - Fragment entry point: @fragment fn fragment_main(in: VertexOutput) -> @location(0) vec4f
2. Declare uniform buffers at @group(0) @binding(0) with 16-byte alignment rules:
   struct Uniforms {
     u_time: f32,
     u_resolution: vec2f,
     u_color: vec4f,
     // Add customizable parameters here
   };
   @group(0) @binding(0) var<uniform> u: Uniforms;
3. Output clean, valid WGSL code inside a \`\`\`wgsl ... \`\`\` markdown block.
4. Ensure all vectors use modern WGSL syntax (vec2f, vec3f, vec4f, f32).`
  }

  return `You are a world-class WebGL2 / GLSL graphics engineer.
Your task is to write high-performance, visually stunning procedural fragment shaders for Shader Studio.

RULES FOR GLSL ES 3.00:
1. Use "#version 300 es" with "precision highp float;" at the top.
2. Output a single fragment color: "out vec4 fragColor;".
3. Use uniform names like "uniform float u_time;", "uniform vec2 u_resolution;", "uniform vec4 u_color;".
4. Output clean, valid GLSL code inside a \`\`\`glsl ... \`\`\` markdown block.`
}

export async function runAIShaderGeneration(
  userPrompt: string,
  settings: AISettings,
  callbacks?: {
    onStepUpdate?: (step: IterationStep) => void
    onComplete?: (session: GenerationSession) => void
  }
): Promise<GenerationSession> {
  const store = useProjectStore.getState()
  const backend = store.activeBackend
  const sessionId = "gen_" + crypto.randomUUID()

  const session: GenerationSession = {
    id: sessionId,
    userPrompt,
    backend,
    provider: settings.activeProvider,
    model: settings.models[settings.activeProvider] || "default",
    startedAt: performance.now(),
    steps: [],
    status: "running",
  }

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(backend) },
    { role: "user", content: `Create this shader: ${userPrompt}` },
  ]

  let currentShaderCode = ""
  let currentScreenshot: string | null = null

  try {
    // -------------------------------------------------------------
    // Step 1: Initial Generation
    // -------------------------------------------------------------
    const step1: IterationStep = {
      stepNumber: 1,
      type: "generate",
      status: "running",
      description: `Generating initial ${backend.toUpperCase()} shader with ${settings.activeProvider}...`,
    }
    session.steps.push(step1)
    callbacks?.onStepUpdate?.(step1)

    const rawResponse = await dispatchAICall(settings.activeProvider, messages, settings)
    currentShaderCode = extractShaderCode(rawResponse, backend)
    messages.push({ role: "assistant", content: rawResponse })

    step1.status = "success"
    step1.codeSnippet = currentShaderCode.slice(0, 300) + "..."
    callbacks?.onStepUpdate?.(step1)

    // -------------------------------------------------------------
    // Step 2: GPU Compilation Check & Auto-Fix Loop
    // -------------------------------------------------------------
    let retryCount = 0
    let compileSuccess = false

    while (retryCount <= settings.maxAutoFixRetries && !compileSuccess) {
      const compileStep: IterationStep = {
        stepNumber: session.steps.length + 1,
        type: retryCount === 0 ? "compile_check" : "auto_fix",
        status: "running",
        description:
          retryCount === 0
            ? "Compiling shader on GPU and validating pipeline..."
            : `Auto-fixing compiler error (attempt ${retryCount}/${settings.maxAutoFixRetries})...`,
      }
      session.steps.push(compileStep)
      callbacks?.onStepUpdate?.(compileStep)

      const feedback = await executeShaderLocally({
        id: `${sessionId}_try_${retryCount}`,
        source: currentShaderCode,
        backend,
        captureSnapshot: true,
      })

      if (feedback.status === "success" && feedback.errors.length === 0) {
        compileSuccess = true
        currentScreenshot = feedback.screenshotBase64 || null
        compileStep.status = "success"
        compileStep.description = "Pipeline compiled cleanly on GPU."
        compileStep.screenshotBase64 = currentScreenshot
        callbacks?.onStepUpdate?.(compileStep)
        break
      }

      // If compilation failed
      compileStep.status = "error"
      const errorStrings = feedback.errors.map((e) =>
        e.line ? `Line ${e.line}${e.column ? `:${e.column}` : ""}: ${e.message}` : e.message
      )
      compileStep.errorMessages = errorStrings
      compileStep.description = `Compiler error: ${errorStrings[0] || "Unknown error"}`
      callbacks?.onStepUpdate?.(compileStep)

      retryCount++
      if (retryCount <= settings.maxAutoFixRetries) {
        messages.push({
          role: "user",
          content: `The shader failed to compile with the following error(s):\n${errorStrings.join(
            "\n"
          )}\n\nPlease fix the shader syntax or struct layout. Output the full corrected code inside a markdown code block.`,
        })

        const fixResponse = await dispatchAICall(settings.activeProvider, messages, settings)
        currentShaderCode = extractShaderCode(fixResponse, backend)
        messages.push({ role: "assistant", content: fixResponse })
      }
    }

    if (!compileSuccess) {
      session.status = "error"
      session.errorMessage = "Shader failed to compile after maximum auto-fix retries."
      session.completedAt = performance.now()
      callbacks?.onComplete?.(session)
      return session
    }

    // -------------------------------------------------------------
    // Step 3: Multimodal Visual Evaluation (if enabled & screenshot available)
    // -------------------------------------------------------------
    if (settings.visualCritique && currentScreenshot) {
      const critiqueStep: IterationStep = {
        stepNumber: session.steps.length + 1,
        type: "visual_critique",
        status: "running",
        description: "Evaluating rendered image quality and spatial aesthetic...",
        screenshotBase64: currentScreenshot,
      }
      session.steps.push(critiqueStep)
      callbacks?.onStepUpdate?.(critiqueStep)

      try {
        const critiqueMessages: ChatMessage[] = [
          ...messages,
          {
            role: "user",
            content: `Here is the rendered screenshot of the shader on the canvas. Evaluate whether it faithfully represents: "${userPrompt}". If it looks good, reply with "AESTHETIC_APPROVED". If it needs visual refinement (e.g. tweak lighting, colors, or speeds), provide the refined full shader code.`,
            imageBase64: currentScreenshot,
          },
        ]

        const critiqueResponse = await dispatchAICall(settings.activeProvider, critiqueMessages, settings)

        if (!critiqueResponse.includes("AESTHETIC_APPROVED")) {
          const refinedCode = extractShaderCode(critiqueResponse, backend)
          if (refinedCode && refinedCode.length > 50 && refinedCode !== currentShaderCode) {
            currentShaderCode = refinedCode
            const refinedFeedback = await executeShaderLocally({
              id: `${sessionId}_refined`,
              source: currentShaderCode,
              backend,
              captureSnapshot: true,
            })
            if (refinedFeedback.status === "success") {
              currentScreenshot = refinedFeedback.screenshotBase64 || currentScreenshot
            }
          }
        }

        critiqueStep.status = "success"
        critiqueStep.description = "Visual quality check complete."
        critiqueStep.screenshotBase64 = currentScreenshot
        callbacks?.onStepUpdate?.(critiqueStep)
      } catch (err) {
        // Visual critique is optional; if vision fails (e.g. model without vision), continue gracefully
        critiqueStep.status = "warning"
        critiqueStep.description = `Visual check skipped: ${err instanceof Error ? err.message : String(err)}`
        callbacks?.onStepUpdate?.(critiqueStep)
      }
    }

    // -------------------------------------------------------------
    // Finalize session
    // -------------------------------------------------------------
    session.status = "success"
    session.finalShaderCode = currentShaderCode
    session.finalScreenshotBase64 = currentScreenshot
    session.completedAt = performance.now()

    // Sync to store
    store.setShaderSource(currentShaderCode)
    store.triggerRecompile()

    callbacks?.onComplete?.(session)
    return session
  } catch (err) {
    session.status = "error"
    session.errorMessage = err instanceof Error ? err.message : String(err)
    session.completedAt = performance.now()
    callbacks?.onComplete?.(session)
    return session
  }
}
