import init, {
  bake_pbr_wasm,
  reflect_uniforms_wasm,
  transpile_shader_wasm,
  normalize_obj_wasm,
  normalize_geometry_wasm,
} from "@/wasm/pkg/shaderstudio_wasm"

let initialized = false
let initPromise: Promise<void> | null = null

async function ensureInitialized(): Promise<void> {
  if (initialized) return
  if (!initPromise) {
    initPromise = (async () => {
      await init()
      initialized = true
    })()
  }
  return initPromise
}

function postWorkerMessage(message: any, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    (self as any).postMessage(message, transfer)
  } else {
    (self as any).postMessage(message)
  }
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data
  if (!msg || !msg.type) return

  const id: string = msg.id || String(Date.now())

  try {
    await ensureInitialized()

    switch (msg.type) {
      case "INIT": {
        postWorkerMessage({ id, type: "INIT_OK", success: true })
        break
      }

      case "BAKE_PBR": {
        const payload = msg.payload || msg
        const width = payload.width || 512
        const height = payload.height || 512
        const rawBuffer = payload.pixels || payload.albedo
        const pixels = rawBuffer instanceof Uint8Array ? rawBuffer : new Uint8Array(rawBuffer)
        const opts = payload.options || payload.config || {}

        const config = {
          width,
          height,
          normal_strength: opts.normalStrength ?? 2.0,
          invert_normal_y: opts.invertNormalY ?? false,
          ao_strength: opts.aoStrength ?? 1.0,
          metallic_mode: opts.metallicMode ?? "auto",
        }

        const result = bake_pbr_wasm(pixels, config)
        const zipBytes = result.zip_archive ? new Uint8Array(result.zip_archive) : new Uint8Array(0)
        const zipBuffer: ArrayBuffer = zipBytes.buffer.slice(
          zipBytes.byteOffset,
          zipBytes.byteOffset + zipBytes.byteLength
        )

        postWorkerMessage(
          {
            id,
            type: "BAKE_PBR_SUCCESS",
            data: result,
            zipBuffer,
          },
          zipBuffer.byteLength > 0 ? [zipBuffer] : []
        )
        break
      }

      case "REFLECT_UNIFORMS": {
        const payload = msg.payload || msg
        const source = payload.source || ""
        const lang = payload.lang || "wgsl"
        const uniforms = reflect_uniforms_wasm(source, lang)
        postWorkerMessage({
          id,
          type: "REFLECT_SUCCESS",
          data: uniforms,
          layout: uniforms,
        })
        break
      }

      case "TRANSPILE_SHADER": {
        const payload = msg.payload || msg
        const source = payload.source || payload.shader_source || ""
        const shaderName = payload.shaderName || payload.shader_name || "ShaderStudio/CustomEffect"
        const target = payload.target || "unity"
        const sourceLang = payload.sourceLang || payload.source_lang || "wgsl"

        const req = {
          shader_source: source,
          shader_name: shaderName,
          target,
          source_lang: sourceLang,
        }

        const code: string = transpile_shader_wasm(req)
        postWorkerMessage({
          id,
          type: "TRANSPILE_SUCCESS",
          data: code,
          code,
        })
        break
      }

      case "NORMALIZE_MESH":
      case "NORMALIZE_OBJ": {
        const payload = msg.payload || msg
        const objSource = payload.objSource || payload.text || ""
        const name = payload.name || "model.obj"
        const output = normalize_obj_wasm(objSource, name)

        const posBuf = new Float32Array(output.positions)
        const normBuf = new Float32Array(output.normals)
        const uvBuf = new Float32Array(output.uvs)

        postWorkerMessage(
          {
            id,
            type: "NORMALIZE_SUCCESS",
            data: {
              ...output,
              positions: posBuf,
              normals: normBuf,
              uvs: uvBuf,
            },
            positions: posBuf,
            normals: normBuf,
            uvs: uvBuf,
          },
          [posBuf.buffer, normBuf.buffer, uvBuf.buffer]
        )
        break
      }

      case "NORMALIZE_GEOMETRY": {
        const payload = msg.payload || msg
        const positions =
          payload.positions instanceof Float32Array
            ? payload.positions
            : new Float32Array(payload.positions || [])
        const normals = payload.normals
          ? payload.normals instanceof Float32Array
            ? payload.normals
            : new Float32Array(payload.normals)
          : undefined
        const uvs = payload.uvs
          ? payload.uvs instanceof Float32Array
            ? payload.uvs
            : new Float32Array(payload.uvs)
          : undefined
        const name = payload.name || "geometry"

        const output = normalize_geometry_wasm(positions, normals, uvs, name)
        const posBuf = new Float32Array(output.positions)
        const normBuf = new Float32Array(output.normals)
        const uvBuf = new Float32Array(output.uvs)

        postWorkerMessage(
          {
            id,
            type: "NORMALIZE_SUCCESS",
            data: {
              ...output,
              positions: posBuf,
              normals: normBuf,
              uvs: uvBuf,
            },
            positions: posBuf,
            normals: normBuf,
            uvs: uvBuf,
          },
          [posBuf.buffer, normBuf.buffer, uvBuf.buffer]
        )
        break
      }

      default:
        postWorkerMessage({ id, type: "ERROR", error: `Unknown message type: ${msg.type}` })
    }
  } catch (err: any) {
    postWorkerMessage({ id, type: "ERROR", error: err?.message || String(err) })
  }
}
