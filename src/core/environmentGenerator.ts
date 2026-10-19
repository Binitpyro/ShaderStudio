/**
 * Shader Studio — In-Memory Procedural HDR Environment Generator
 * Generates high-dynamic-range equirectangular 360° panoramas mathematically.
 * 100% offline, zero CORS, zero external network dependencies.
 */

export type EnvironmentPreset =
  | "studio_warm"
  | "cyberpunk_neon"
  | "sunset"
  | "nebula"
  | "clean_neutral"
  | "daylight"
  | "atmosphere"
  | "custom"

export interface EnvironmentPresetMetadata {
  id: EnvironmentPreset
  name: string
  description: string
  keyColor: string
  imageSrc?: string
}

export const ENVIRONMENT_PRESETS: EnvironmentPresetMetadata[] = [
  {
    id: "atmosphere",
    name: "Physically-Based Atmosphere",
    description: "Rayleigh and Mie atmospheric scattering with solar disc and time-of-day dynamics.",
    keyColor: "#60a5fa",
    imageSrc: "/environments/daylight.jpg",
  },
  {
    id: "daylight",
    name: "Daylight Sky",
    description: "Clear blue sky with 35° sun, atmospheric Rayleigh scattering, and ground horizon.",
    keyColor: "#38bdf8",
    imageSrc: "/environments/daylight.jpg",
  },
  {
    id: "sunset",
    name: "Sunset Horizon",
    description: "Golden hour sun at 10° elevation with glowing amber horizon and deep indigo sky.",
    keyColor: "#f97316",
    imageSrc: "/environments/sunset.jpg",
  },
  {
    id: "studio_warm",
    name: "Studio Warm",
    description: "3-point photographer softboxes with warm key (3200K) and cool rim (6500K).",
    keyColor: "#f59e0b",
    imageSrc: "/environments/studio.jpg",
  },
  {
    id: "nebula",
    name: "Deep Space Nebula",
    description: "Celestial starfield with Milky Way galactic dust and cosmic gas clouds.",
    keyColor: "#8b5cf6",
    imageSrc: "/environments/night.jpg",
  },
  {
    id: "cyberpunk_neon",
    name: "Cyberpunk Neon",
    description: "High-contrast darkroom with intense electric magenta, cyan, and skyscraper skyline.",
    keyColor: "#ec4899",
    imageSrc: "/environments/cyberpunk.jpg",
  },
  {
    id: "clean_neutral",
    name: "Clean Neutral",
    description: "Balanced 5500K daylight photographic studio with gentle ambient floor occlusion.",
    keyColor: "#06b6d4",
    imageSrc: "/environments/neutral.jpg",
  },
]

export interface RGB {
  r: number
  g: number
  b: number
}

/**
 * Procedural ray direction evaluation for a given equirectangular UV coordinate.
 * u in [0, 1] maps to azimuth theta in [-PI, PI]
 * v in [0, 1] maps to elevation phi in [0, PI] (0 = zenith/top, 1 = nadir/bottom)
 */
export function uvToDirection(u: number, v: number): [number, number, number] {
  const theta = (u - 0.5) * 2.0 * Math.PI
  const phi = v * Math.PI

  const x = Math.sin(phi) * Math.sin(theta)
  const y = Math.cos(phi) // top is +Y
  const z = Math.sin(phi) * Math.cos(theta)

  return [x, y, z]
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
}

/**
 * Evaluates the radiance L(D) for a given direction vector D = [x, y, z].
 */
export function evaluateEnvironmentRadiance(
  dir: [number, number, number],
  preset: EnvironmentPreset,
  timeOfDay: number = 12.0
): RGB {
  const [x, y, z] = dir

  switch (preset) {
    case "studio_warm": {
      // Key light: upper right front (warm 3200K)
      const keyDir = normalize([0.6, 0.7, 0.5])
      const keyDot = Math.max(0, dot(dir, keyDir))
      const keyLight = Math.pow(keyDot, 12) * 3.5

      // Fill light: upper left front (soft neutral)
      const fillDir = normalize([-0.7, 0.5, 0.4])
      const fillDot = Math.max(0, dot(dir, fillDir))
      const fillLight = Math.pow(fillDot, 8) * 1.2

      // Rim light: back left (cool 6500K)
      const rimDir = normalize([-0.5, 0.3, -0.8])
      const rimDot = Math.max(0, dot(dir, rimDir))
      const rimLight = Math.pow(rimDot, 24) * 4.0

      // Studio background gradient
      const floorGradient = Math.max(0, -y) * 0.15
      const ceilingGradient = Math.max(0, y) * 0.25

      return {
        r: 0.15 + keyLight * 1.0 + fillLight * 0.8 + rimLight * 0.4 + ceilingGradient,
        g: 0.14 + keyLight * 0.75 + fillLight * 0.8 + rimLight * 0.6 + ceilingGradient,
        b: 0.16 + keyLight * 0.4 + fillLight * 0.9 + rimLight * 1.0 + ceilingGradient + floorGradient * 0.5,
      }
    }

    case "cyberpunk_neon": {
      // Dark room ambient
      const baseR = 0.03
      const baseG = 0.02
      const baseB = 0.06

      // Vertical magenta neon strip at +X
      const magDir = normalize([1.0, 0.0, 0.2])
      const magDist = Math.hypot(dir[0] - magDir[0], dir[2] - magDir[2])
      const magGlow = Math.exp(-magDist * 3.0) * 4.5

      // Vertical cyan neon strip at -X
      const cyanDir = normalize([-1.0, 0.0, 0.3])
      const cyanDist = Math.hypot(dir[0] - cyanDir[0], dir[2] - cyanDir[2])
      const cyanGlow = Math.exp(-cyanDist * 3.0) * 4.5

      // Ultraviolet overhead strip
      const uvLight = Math.max(0, y) * 0.8

      // Horizon grid light reflection
      const horizonLine = Math.exp(-Math.abs(y) * 15.0) * 0.6

      return {
        r: baseR + magGlow * 1.0 + horizonLine * 0.8 + uvLight * 0.4,
        g: baseG + cyanGlow * 0.9 + horizonLine * 0.1 + uvLight * 0.1,
        b: baseB + magGlow * 0.6 + cyanGlow * 1.0 + horizonLine * 0.9 + uvLight * 0.9,
      }
    }

    case "daylight": {
      // Sun at 35 degrees elevation in +Z
      const sunDir = normalize([0.0, 0.573, 0.819])
      const sunDot = Math.max(0, dot(dir, sunDir))
      const sunDisk = sunDot > 0.999 ? 12.0 : 0.0
      const sunHalo = Math.pow(sunDot, 16.0) * 2.0

      let skyR = 0.2
      let skyG = 0.45
      let skyB = 0.85

      if (y > 0.0) {
        const t = Math.pow(y, 0.5)
        skyR = 0.7 * (1 - t) + 0.18 * t
        skyG = 0.8 * (1 - t) + 0.42 * t
        skyB = 0.95 * (1 - t) + 0.88 * t
      } else {
        const t = Math.abs(y)
        skyR = 0.25 * (1 - t) + 0.05 * t
        skyG = 0.3 * (1 - t) + 0.06 * t
        skyB = 0.18 * (1 - t) + 0.05 * t
      }

      return {
        r: skyR + sunDisk * 1.0 + sunHalo * 1.0,
        g: skyG + sunDisk * 0.98 + sunHalo * 0.95,
        b: skyB + sunDisk * 0.85 + sunHalo * 0.75,
      }
    }

    case "sunset": {
      // Sun disk at 10 degrees elevation in +Z (center of panorama)
      const sunDir = normalize([0.0, 0.174, 0.985])
      const sunDot = Math.max(0, dot(dir, sunDir))
      const sunDisk = Math.pow(sunDot, 180) * 12.0
      const sunHalo = Math.pow(sunDot, 12) * 2.5

      // Sky gradient: indigo top, amber horizon, dark earth bottom
      let skyR = 0.1
      let skyG = 0.1
      let skyB = 0.35

      if (y > 0.0) {
        // Upper hemisphere
        const t = Math.pow(y, 0.6)
        skyR = 0.85 * (1 - t) + 0.15 * t
        skyG = 0.45 * (1 - t) + 0.2 * t
        skyB = 0.2 * (1 - t) + 0.65 * t
      } else {
        // Ground hemisphere
        const t = Math.abs(y)
        skyR = 0.4 * (1 - t) + 0.05 * t
        skyG = 0.2 * (1 - t) + 0.04 * t
        skyB = 0.1 * (1 - t) + 0.05 * t
      }

      return {
        r: skyR + sunDisk * 1.0 + sunHalo * 1.0,
        g: skyG + sunDisk * 0.9 + sunHalo * 0.6,
        b: skyB + sunDisk * 0.5 + sunHalo * 0.2,
      }
    }

    case "nebula": {
      // Cosmic background
      const base = 0.02

      // Procedural cosmic dust clouds via harmonic spatial sinusoids
      const f1 = Math.sin(x * 3.0 + y * 2.0) * Math.cos(z * 3.0)
      const f2 = Math.sin(x * 6.0 - z * 5.0) * 0.5
      const cloud = Math.max(0, f1 + f2)

      // Cyan cloud component
      const cyanFactor = Math.max(0, Math.sin(x * 2.5 + z * 2.0)) * cloud * 2.0
      // Magenta cloud component
      const magFactor = Math.max(0, Math.cos(y * 3.0 - x * 2.0)) * cloud * 2.5

      // Starlight point glints
      const starSeed = Math.sin(x * 123.45 + y * 345.67 + z * 789.01) * 43758.5453
      const isStar = (starSeed - Math.floor(starSeed)) > 0.995 ? 3.0 : 0.0

      return {
        r: base + magFactor * 0.9 + isStar,
        g: base + cyanFactor * 0.8 + isStar,
        b: base * 2.0 + magFactor * 0.8 + cyanFactor * 1.0 + isStar * 1.2,
      }
    }

    case "atmosphere": {
      // Physically-based Rayleigh and Mie scattering sky model
      const tod = Math.max(0, Math.min(24, timeOfDay))
      // Sun elevation angle: 0 at 6h (sunrise) and 18h (sunset), +PI/2 at 12h (noon)
      const elevation = ((tod - 6.0) / 12.0) * Math.PI
      const sunY = Math.sin(elevation)
      const sunHoriz = Math.cos(elevation)
      const sunDir = normalize([sunHoriz * 0.8, sunY, sunHoriz * 0.6])
      const sunDot = Math.max(-1, Math.min(1, dot(dir, sunDir)))

      // Solar disc with limb darkening
      let sunDisc = 0.0
      if (sunY > -0.1 && sunDot > 0.995) {
        const d = (1.0 - sunDot) / 0.005
        const limb = Math.max(0.0, 1.0 - 0.6 * d)
        sunDisc = limb * 18.0 * Math.max(0.0, (sunY + 0.1) / 0.3)
      }

      // Mie forward scattering halo
      const g = 0.76
      const miePhase = (1.0 - g * g) / Math.pow(1.0 + g * g - 2.0 * g * sunDot, 1.5)
      const mieHalo = Math.max(0, sunY) * miePhase * 0.15

      // Time-of-day sky color gradient
      let skyR = 0.02, skyG = 0.02, skyB = 0.06
      if (y > 0) {
        const zenithWeight = Math.pow(y, 0.7)
        if (tod >= 6.0 && tod <= 18.0) {
          const noonFactor = Math.sin(((tod - 6.0) / 12.0) * Math.PI)
          // Noon: blue zenith [0.18, 0.42, 0.92], pale horizon [0.65, 0.78, 0.95]
          // Sunset/sunrise: deep zenith [0.15, 0.1, 0.3], orange horizon [0.95, 0.42, 0.1]
          const zenithR = 0.18 * noonFactor + 0.15 * (1 - noonFactor)
          const zenithG = 0.42 * noonFactor + 0.1 * (1 - noonFactor)
          const zenithB = 0.92 * noonFactor + 0.3 * (1 - noonFactor)

          const horizonR = 0.65 * noonFactor + 0.95 * (1 - noonFactor)
          const horizonG = 0.78 * noonFactor + 0.42 * (1 - noonFactor)
          const horizonB = 0.95 * noonFactor + 0.1 * (1 - noonFactor)

          skyR = zenithR * zenithWeight + horizonR * (1 - zenithWeight)
          skyG = zenithG * zenithWeight + horizonG * (1 - zenithWeight)
          skyB = zenithB * zenithWeight + horizonB * (1 - zenithWeight)
        } else {
          skyR = 0.01 * zenithWeight + 0.05 * (1 - zenithWeight)
          skyG = 0.01 * zenithWeight + 0.03 * (1 - zenithWeight)
          skyB = 0.04 * zenithWeight + 0.08 * (1 - zenithWeight)
        }
      } else {
        const groundT = Math.abs(y)
        skyR = 0.08 * (1 - groundT) + 0.02 * groundT
        skyG = 0.07 * (1 - groundT) + 0.02 * groundT
        skyB = 0.06 * (1 - groundT) + 0.03 * groundT
      }

      return {
        r: Math.max(0, skyR + sunDisc * 1.0 + mieHalo * 1.0),
        g: Math.max(0, skyG + sunDisc * 0.92 + mieHalo * 0.85),
        b: Math.max(0, skyB + sunDisc * 0.75 + mieHalo * 0.65),
      }
    }

    case "clean_neutral":
    default: {
      // Photographic daylight studio
      const skyGrad = 0.5 + 0.4 * Math.max(0, y)
      const floorGrad = 0.5 - 0.2 * Math.max(0, -y)

      // Soft overhead panel light
      const ceilingLight = Math.pow(Math.max(0, y), 3.0) * 1.5

      const light = (y >= 0 ? skyGrad : floorGrad) + ceilingLight

      return {
        r: light * 0.96,
        g: light * 0.98,
        b: light * 1.0,
      }
    }
  }
}

/**
 * Renders an in-memory equirectangular environment texture into an RGBA Uint8ClampedArray.
 * Uses Reinhard tone-mapping to map high dynamic range [0, inf) to displayable [0, 255].
 */
export function generateEnvironmentRGBA(
  preset: EnvironmentPreset,
  width = 512,
  height = 256
): Uint8ClampedArray {
  const totalPixels = width * height
  const buffer = new Uint8ClampedArray(totalPixels * 4)

  let offset = 0
  for (let py = 0; py < height; py++) {
    const v = py / (height - 1)
    for (let px = 0; px < width; px++) {
      const u = px / (width - 1)
      const dir = uvToDirection(u, v)
      const hdr = evaluateEnvironmentRadiance(dir, preset)

      // Reinhard tone mapping: color / (1 + color) with gamma 2.2 correction
      const tmR = hdr.r / (1.0 + hdr.r)
      const tmG = hdr.g / (1.0 + hdr.g)
      const tmB = hdr.b / (1.0 + hdr.b)

      buffer[offset] = Math.min(255, Math.floor(Math.pow(tmR, 1.0 / 2.2) * 255))
      buffer[offset + 1] = Math.min(255, Math.floor(Math.pow(tmG, 1.0 / 2.2) * 255))
      buffer[offset + 2] = Math.min(255, Math.floor(Math.pow(tmB, 1.0 / 2.2) * 255))
      buffer[offset + 3] = 255
      offset += 4
    }
  }

  return buffer
}

/**
 * Creates an HTMLCanvasElement with the generated environment texture.
 */
export function generateEnvironmentCanvas(
  preset: EnvironmentPreset,
  width = 512,
  height = 256
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  const rgba = generateEnvironmentRGBA(preset, width, height)
  const imgData = ctx.createImageData(width, height)
  imgData.data.set(rgba)
  ctx.putImageData(imgData, 0, 0)
  return canvas
}

/**
 * Generates a base64 PNG data URL for the procedural environment texture.
 */
export function generateEnvironmentDataUrl(
  preset: EnvironmentPreset,
  width = 512,
  height = 256
): string {
  const canvas = generateEnvironmentCanvas(preset, width, height)
  if (!canvas) {
    // Return empty 1x1 data URL fallback in headless/node environments
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  }
  return canvas.toDataURL("image/png")
}
