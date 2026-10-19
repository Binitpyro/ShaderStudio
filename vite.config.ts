import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          const normalized = id.replace(/\\/g, "/")
          if (normalized.includes("node_modules")) {
            if (normalized.includes("@monaco-editor") || normalized.includes("monaco-editor")) {
              return "vendor-monaco"
            }
            if (normalized.includes("three")) {
              return "vendor-three"
            }
            if (normalized.includes("@xyflow") || normalized.includes("reactflow")) {
              return "vendor-reactflow"
            }
            if (normalized.includes("@radix-ui")) {
              return "vendor-radix"
            }
            return "vendor"
          }
          if (normalized.includes("src/components/inspector")) {
            return "inspector"
          }
        },
      },
    },
  },
})
