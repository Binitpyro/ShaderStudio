import init, {
  bake_pbr_wasm,
  reflect_uniforms_wasm,
  transpile_shader_wasm,
  transpile_wgsl_wasm,
  normalize_obj_wasm,
  normalize_geometry_wasm,
} from "@/wasm/pkg/shaderstudio_wasm"

let initPromise: Promise<unknown> | null = null

function ensureInitialized(): Promise<unknown> {
  return (initPromise ??= init())
}

function post(message: unknown, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(message, transfer)
}

/** Reads the typed-array getters off a wasm-bindgen result, frees it, returns plain data. */
function drain(res: { free(): void }, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = (res as unknown as Record<string, unknown>)[k]
  res.free()
  return out
}

const BAKE_KEYS = ["albedo_png", "normal_png", "roughness_png", "height_png", "metallic_png", "ao_png", "zip_archive", "width", "height"]
const MESH_KEYS = ["name", "positions", "normals", "uvs", "vertex_count", "triangle_count"]

const buffersOf = (o: Record<string, unknown>): Transferable[] =>
  Object.values(o)
    .filter((v): v is ArrayBufferView => ArrayBuffer.isView(v))
    .map((v) => v.buffer as ArrayBuffer)

const f32 = (v: unknown): Float32Array | undefined =>
  v ? (v instanceof Float32Array ? v : new Float32Array(v as ArrayLike<number>)) : undefined

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data
  if (!msg || !msg.type) return
  const id: string = msg.id || String(Date.now())

  try {
    await ensureInitialized()
    const p = msg.payload || msg

    switch (msg.type) {
      case "INIT":
        post({ id, type: "INIT_OK", success: true })
        break

      case "BAKE_PBR": {
        const raw = p.pixels || p.albedo
        const opts = p.options || p.config || {}
        const data = drain(
          bake_pbr_wasm(raw instanceof Uint8Array ? raw : new Uint8Array(raw), {
            width: p.width || 512,
            height: p.height || 512,
            normal_strength: opts.normalStrength ?? 2.0,
            invert_normal_y: opts.invertNormalY ?? false,
            ao_strength: opts.aoStrength ?? 1.0,
            metallic_mode: opts.metallicMode ?? "auto",
          }),
          BAKE_KEYS
        )
        post({ id, type: "BAKE_PBR_SUCCESS", data }, buffersOf(data))
        break
      }

      case "REFLECT_UNIFORMS": {
        const uniforms = reflect_uniforms_wasm(p.source || "", p.lang || "wgsl")
        post({ id, type: "REFLECT_SUCCESS", data: uniforms, layout: uniforms })
        break
      }

      case "TRANSPILE_SHADER": {
        const code: string = transpile_shader_wasm({
          shader_source: p.source || p.shader_source || "",
          shader_name: p.shaderName || p.shader_name || "ShaderStudio/CustomEffect",
          target: p.target || "unity",
          source_lang: p.sourceLang || p.source_lang || "wgsl",
        })
        post({ id, type: "TRANSPILE_SUCCESS", data: code, code })
        break
      }

      case "TRANSPILE_WGSL": {
        const data = transpile_wgsl_wasm(p.source || "", p.target || "glsl", p.stage ?? null)
        post({ id, type: "TRANSPILE_WGSL_SUCCESS", data })
        break
      }

      case "NORMALIZE_MESH":
      case "NORMALIZE_OBJ": {
        const data = drain(normalize_obj_wasm(p.objSource || p.text || "", p.name || "model.obj"), MESH_KEYS)
        post({ id, type: "NORMALIZE_SUCCESS", data }, buffersOf(data))
        break
      }

      case "NORMALIZE_GEOMETRY": {
        const data = drain(
          normalize_geometry_wasm(f32(p.positions) ?? new Float32Array(0), f32(p.normals), f32(p.uvs), p.name || "geometry"),
          MESH_KEYS
        )
        post({ id, type: "NORMALIZE_SUCCESS", data }, buffersOf(data))
        break
      }

      default:
        post({ id, type: "ERROR", error: `Unknown message type: ${msg.type}` })
    }
  } catch (err: any) {
    post({ id, type: "ERROR", error: err?.message || String(err) })
  }
}
