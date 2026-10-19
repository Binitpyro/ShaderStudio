import type { AIProvider, AISettings, ChatMessage } from "./types"

const BRIDGE_PROXY_URL = "http://localhost:8642/api/ai/proxy"

/**
 * Executes a fetch with automatic CORS bridge fallback for local endpoints (Ollama, LM Studio).
 */
async function safeFetch(
  url: string,
  options: RequestInit,
  allowProxy = true
): Promise<Response> {
  try {
    return await fetch(url, options)
  } catch (err) {
    if (allowProxy && (url.includes("localhost") || url.includes("127.0.0.1"))) {
      try {
        const proxyResp = await fetch(BRIDGE_PROXY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetUrl: url,
            headers: options.headers || {},
            body: typeof options.body === "string" ? options.body : JSON.stringify(options.body),
          }),
        })
        if (proxyResp.ok) return proxyResp
      } catch {
        /* proxy failed, rethrow original */
      }
    }
    throw err
  }
}

/**
 * Extracts shader code block from LLM response text.
 */
export function extractShaderCode(rawText: string, backend: "webgpu" | "webgl2" | "threejs"): string {
  if (!rawText) return ""

  // Priority 1: Match specific backend language blocks
  const wgslRegex = /```(?:wgsl)\s*\n([\s\S]*?)```/i
  const glslRegex = /```(?:glsl|frag|vert)\s*\n([\s\S]*?)```/i
  const genericCodeRegex = /```(?:c|cpp|hlsl|shader)?\s*\n([\s\S]*?)```/i

  if (backend === "webgpu") {
    const wgslMatch = rawText.match(wgslRegex)
    if (wgslMatch && wgslMatch[1].trim()) return wgslMatch[1].trim()
  } else {
    const glslMatch = rawText.match(glslRegex)
    if (glslMatch && glslMatch[1].trim()) return glslMatch[1].trim()
  }

  // Priority 2: Generic code fence with shader signatures
  const genericMatch = rawText.match(genericCodeRegex)
  if (genericMatch && genericMatch[1].trim()) {
    const code = genericMatch[1].trim()
    if (
      code.includes("fn ") ||
      code.includes("void main") ||
      code.includes("@fragment") ||
      code.includes("@vertex") ||
      code.includes("vec4")
    ) {
      return code
    }
  }

  // Priority 3: Fallback if model returned raw code without markdown backticks
  if (
    rawText.includes("@fragment") ||
    rawText.includes("void main()") ||
    rawText.includes("precision mediump float;")
  ) {
    return rawText.trim()
  }

  return rawText.trim()
}

/**
 * Call Google Gemini API (supporting multimodal vision input)
 */
async function callGemini(
  messages: ChatMessage[],
  apiKey: string,
  model = "gemini-2.5-flash"
): Promise<string> {
  if (!apiKey) throw new Error("Gemini API key is required. Add it in AI Copilot Settings.")

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const parts: any[] = [{ text: m.content }]
      if (m.imageBase64) {
        const cleanBase64 = m.imageBase64.replace(/^data:image\/[a-z]+;base64,/, "")
        parts.push({
          inlineData: {
            mimeType: "image/png",
            data: cleanBase64,
          },
        })
      }
      return {
        role: m.role === "assistant" ? "model" : "user",
        parts,
      }
    })

  const systemMessage = messages.find((m) => m.role === "system")
  const body: any = { contents }
  if (systemMessage) {
    body.systemInstruction = { parts: [{ text: systemMessage.content }] }
  }

  const res = await safeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, false)

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gemini API error (${res.status}): ${errText}`)
  }

  const json = await res.json()
  const candidate = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!candidate) throw new Error("Gemini returned an empty response.")
  return candidate
}

/**
 * Call Anthropic Claude API
 */
async function callAnthropic(
  messages: ChatMessage[],
  apiKey: string,
  model = "claude-3-7-sonnet-20250219"
): Promise<string> {
  if (!apiKey) throw new Error("Anthropic API key is required. Add it in AI Copilot Settings.")

  const url = "https://api.anthropic.com/v1/messages"
  const systemMessage = messages.find((m) => m.role === "system")

  const anthropicMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const content: any[] = [{ type: "text", text: m.content }]
      if (m.imageBase64) {
        const cleanBase64 = m.imageBase64.replace(/^data:image\/[a-z]+;base64,/, "")
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: cleanBase64,
          },
        })
      }
      return {
        role: m.role === "assistant" ? "assistant" : "user",
        content,
      }
    })

  const body: any = {
    model,
    max_tokens: 4096,
    messages: anthropicMessages,
  }
  if (systemMessage) body.system = systemMessage.content

  const res = await safeFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  }, false)

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic API error (${res.status}): ${errText}`)
  }

  const json = await res.json()
  const text = json.content?.[0]?.text
  if (!text) throw new Error("Anthropic returned an empty response.")
  return text
}

/**
 * Call OpenAI or OpenAI-compatible local endpoint (Ollama, LM Studio, vLLM)
 */
async function callOpenAICompatible(
  messages: ChatMessage[],
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<string> {
  let endpoint = baseUrl.replace(/\/+$/, "")
  if (!endpoint.endsWith("/chat/completions")) {
    endpoint = endpoint.endsWith("/v1") ? `${endpoint}/chat/completions` : `${endpoint}/v1/chat/completions`
  }

  const formattedMessages = messages.map((m) => {
    if (m.imageBase64) {
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          {
            type: "image_url",
            image_url: {
              url: m.imageBase64.startsWith("data:")
                ? m.imageBase64
                : `data:image/png;base64,${m.imageBase64}`,
            },
          },
        ],
      }
    }
    return {
      role: m.role,
      content: m.content,
    }
  })

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

  const res = await safeFetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: formattedMessages,
      temperature: 0.7,
    }),
  }, true)

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Endpoint error (${res.status} at ${endpoint}): ${errText}`)
  }

  const json = await res.json()
  const choice = json.choices?.[0]?.message?.content
  if (!choice) throw new Error("Model returned an empty response.")
  return choice
}

/**
 * Universal dispatcher for any AI provider
 */
export async function dispatchAICall(
  provider: AIProvider,
  messages: ChatMessage[],
  settings: AISettings
): Promise<string> {
  switch (provider) {
    case "gemini":
      return callGemini(messages, settings.apiKeys.gemini || "", settings.models.gemini)

    case "anthropic":
      return callAnthropic(messages, settings.apiKeys.anthropic || "", settings.models.anthropic)

    case "openai":
      return callOpenAICompatible(
        messages,
        "https://api.openai.com/v1",
        settings.apiKeys.openai || "",
        settings.models.openai
      )

    case "ollama":
      return callOpenAICompatible(
        messages,
        settings.endpoints.ollama || "http://localhost:11434",
        "ollama",
        settings.models.ollama || "qwen2.5-coder:7b"
      )

    case "lmstudio":
      return callOpenAICompatible(
        messages,
        settings.endpoints.lmstudio || "http://localhost:1234",
        "lm-studio",
        settings.models.lmstudio || "local-model"
      )

    case "custom":
      return callOpenAICompatible(
        messages,
        settings.endpoints.custom || "http://localhost:8080/v1",
        settings.apiKeys.custom || "",
        settings.models.custom || "default"
      )

    default:
      throw new Error(`Unsupported AI provider: ${provider}`)
  }
}
