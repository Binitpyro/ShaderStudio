import { describe, it, expect } from "vitest"
import { selectLodByDistance, DEFAULT_LOD_THRESHOLDS } from "../src/core/meshLod"
import { PerformanceTelemetry } from "../src/core/performanceTelemetry"

describe("Milestone 5 Gate 2 Empirical Challenger Probes", () => {
  describe("1. Probe selectLodByDistance in src/core/meshLod.ts", () => {
    it("handles Infinity, +Infinity, -Infinity, NaN, 0, -10, 10.0, 10.0001, 30.0, 30.0001, 1e12", () => {
      // 1. Positive Infinity
      expect(selectLodByDistance(Infinity)).toBe("lod2")
      expect(selectLodByDistance(+Infinity)).toBe("lod2")

      // 2. Extremely large finite distances (> 30.0)
      expect(selectLodByDistance(1e12)).toBe("lod2")
      expect(selectLodByDistance(Number.MAX_VALUE)).toBe("lod2")
      expect(selectLodByDistance(100.0)).toBe("lod2")
      expect(selectLodByDistance(30.0001)).toBe("lod2")
      expect(selectLodByDistance(30.0000001)).toBe("lod2")

      // 3. Exact threshold 30.0 (<= lod1Dist) -> lod1
      expect(selectLodByDistance(30.0)).toBe("lod1")

      // 4. Intermediate distances (10.0 < dist <= 30.0) -> lod1
      expect(selectLodByDistance(10.0001)).toBe("lod1")
      expect(selectLodByDistance(20.0)).toBe("lod1")

      // 5. Exact threshold 10.0 (<= lod0Dist) -> lod0
      expect(selectLodByDistance(10.0)).toBe("lod0")

      // 6. Near zero and zero -> lod0
      expect(selectLodByDistance(5.0)).toBe("lod0")
      expect(selectLodByDistance(0)).toBe("lod0")
      expect(selectLodByDistance(-0)).toBe("lod0")

      // 7. Negative numbers and negative Infinity -> safely clamped to 0 -> lod0
      expect(selectLodByDistance(-10)).toBe("lod0")
      expect(selectLodByDistance(-1e12)).toBe("lod0")
      expect(selectLodByDistance(-Infinity)).toBe("lod0")

      // 8. NaN -> safely treated as 0 -> lod0
      expect(selectLodByDistance(NaN)).toBe("lod0")
    })

    it("verifies strict lod2 guarantee for all numbers > 30 and positive Infinity", () => {
      const distancesAbove30 = [
        30.000000000001,
        30.0001,
        30.1,
        31,
        50,
        100,
        1000,
        1e6,
        1e12,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_VALUE,
        Infinity,
        +Infinity,
      ]

      for (const d of distancesAbove30) {
        expect(selectLodByDistance(d)).toBe("lod2")
      }
    })

    it("verifies custom threshold behavior with boundary conditions", () => {
      const customThresholds = { lod0Dist: 50, lod1Dist: 150 }
      expect(selectLodByDistance(Infinity, customThresholds)).toBe("lod2")
      expect(selectLodByDistance(150.001, customThresholds)).toBe("lod2")
      expect(selectLodByDistance(150.0, customThresholds)).toBe("lod1")
      expect(selectLodByDistance(50.001, customThresholds)).toBe("lod1")
      expect(selectLodByDistance(50.0, customThresholds)).toBe("lod0")
      expect(selectLodByDistance(0, customThresholds)).toBe("lod0")
      expect(selectLodByDistance(-Infinity, customThresholds)).toBe("lod0")
      expect(selectLodByDistance(NaN, customThresholds)).toBe("lod0")
    })
  })

  describe("2. Probe calculateTextureMemory and calculateGeometryMemory in src/core/performanceTelemetry.ts", () => {
    const telemetry = new PerformanceTelemetry()

    describe("calculateTextureMemory(width, height, bytesPerPixel)", () => {
      it("returns 0 for all non-finite dimensions (NaN, Infinity, -Infinity)", () => {
        // NaN in any argument
        expect(telemetry.calculateTextureMemory(NaN, 100, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, NaN, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 100, NaN)).toBe(0)
        expect(telemetry.calculateTextureMemory(NaN, NaN, NaN)).toBe(0)

        // Infinity in any argument
        expect(telemetry.calculateTextureMemory(Infinity, 100, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, Infinity, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 100, Infinity)).toBe(0)
        expect(telemetry.calculateTextureMemory(Infinity, Infinity, Infinity)).toBe(0)

        // -Infinity in any argument
        expect(telemetry.calculateTextureMemory(-Infinity, 100, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, -Infinity, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 100, -Infinity)).toBe(0)
        expect(telemetry.calculateTextureMemory(-Infinity, -Infinity, -Infinity)).toBe(0)
      })

      it("returns 0 for all non-positive dimensions (<= 0)", () => {
        // Zero dimensions
        expect(telemetry.calculateTextureMemory(0, 100, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 0, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 100, 0)).toBe(0)
        expect(telemetry.calculateTextureMemory(0, 0, 0)).toBe(0)
        expect(telemetry.calculateTextureMemory(-0, 100, 4)).toBe(0)

        // Negative dimensions
        expect(telemetry.calculateTextureMemory(-1, 100, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, -50, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 100, -4)).toBe(0)
        expect(telemetry.calculateTextureMemory(-10, -10, -10)).toBe(0)
      })

      it("safely handles non-integer dimensions via Math.floor", () => {
        // width = 10.8 -> floor 10, height = 10.2 -> floor 10, bytesPerPixel = 4 -> 400
        expect(telemetry.calculateTextureMemory(10.8, 10.2, 4)).toBe(400)
        // dimensions < 1 floor to 0
        expect(telemetry.calculateTextureMemory(0.5, 100, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 0.999, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 100, 0.5)).toBe(0)
      })

      it("computes accurate memory for valid standard textures", () => {
        expect(telemetry.calculateTextureMemory(1024, 1024, 4)).toBe(4194304) // 4 MB
        expect(telemetry.calculateTextureMemory(2048, 2048, 4)).toBe(16777216) // 16 MB
        expect(telemetry.calculateTextureMemory(4096, 4096, 4)).toBe(67108864) // 64 MB
      })
    })

    describe("calculateGeometryMemory(vertexCount, strideBytes)", () => {
      it("returns 0 for all non-finite arguments (NaN, Infinity, -Infinity)", () => {
        expect(telemetry.calculateGeometryMemory(NaN, 32)).toBe(0)
        expect(telemetry.calculateGeometryMemory(1000, NaN)).toBe(0)
        expect(telemetry.calculateGeometryMemory(NaN, NaN)).toBe(0)

        expect(telemetry.calculateGeometryMemory(Infinity, 32)).toBe(0)
        expect(telemetry.calculateGeometryMemory(1000, Infinity)).toBe(0)
        expect(telemetry.calculateGeometryMemory(Infinity, Infinity)).toBe(0)

        expect(telemetry.calculateGeometryMemory(-Infinity, 32)).toBe(0)
        expect(telemetry.calculateGeometryMemory(1000, -Infinity)).toBe(0)
        expect(telemetry.calculateGeometryMemory(-Infinity, -Infinity)).toBe(0)
      })

      it("returns 0 for all non-positive arguments (<= 0)", () => {
        expect(telemetry.calculateGeometryMemory(0, 32)).toBe(0)
        expect(telemetry.calculateGeometryMemory(1000, 0)).toBe(0)
        expect(telemetry.calculateGeometryMemory(0, 0)).toBe(0)

        expect(telemetry.calculateGeometryMemory(-10, 32)).toBe(0)
        expect(telemetry.calculateGeometryMemory(1000, -32)).toBe(0)
        expect(telemetry.calculateGeometryMemory(-100, -32)).toBe(0)
      })

      it("safely handles non-integer vertex counts and strides via Math.floor", () => {
        expect(telemetry.calculateGeometryMemory(100.9, 32.5)).toBe(100 * 32)
        expect(telemetry.calculateGeometryMemory(0.8, 32)).toBe(0)
        expect(telemetry.calculateGeometryMemory(100, 0.5)).toBe(0)
      })

      it("computes accurate memory for standard geometry buffers", () => {
        expect(telemetry.calculateGeometryMemory(10000, 32)).toBe(320000)
        expect(telemetry.calculateGeometryMemory(50000, 32)).toBe(1600000)
      })
    })
  })
})
