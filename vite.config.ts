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
  // Cargo writes locked .dll/.pdb files under target/ while building; watching them crashes the dev server on Windows.
  server: { watch: { ignored: ["**/target/**"] } },
})
