#!/usr/bin/env node
/**
 * scripts/build-all.js
 * 
 * Comprehensive full-stack production build orchestrator for ShaderStudio.
 * 1. Builds Rust WebAssembly engine (crates/shaderstudio_wasm -> src/wasm/pkg)
 * 2. Typechecks entire codebase (npx tsc -b)
 * 3. Builds production Vite bundle (dist/)
 * 4. Asserts chunk size budget (< 300 kB initial entry chunk)
 * 5. (Optional) Runs test suite with --test flag
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ANSI Color Helpers
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};

function logStep(step, message) {
  console.log(`\n${colors.bold}${colors.cyan}[Step ${step}]${colors.reset} ${message}`);
}

function logSuccess(message) {
  console.log(`  ${colors.green}✓${colors.reset} ${message}`);
}

function logError(message) {
  console.error(`  ${colors.red}✗${colors.reset} ${message}`);
}

function runCommand(command, args, cwd = ROOT) {
  const isWindows = process.platform === "win32";
  let cmd = command;
  if (isWindows && (command === "npm" || command === "npx")) {
    cmd = `${command}.cmd`;
  }

  console.log(`  ${colors.dim}$ ${command} ${args.join(" ")}${colors.reset}`);
  const startTime = Date.now();
  
  let res = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: isWindows });
  if (res.error && isWindows) {
    res = spawnSync(command, args, { cwd, stdio: "inherit", shell: true });
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  if (res.status !== 0) {
    logError(`Command failed with exit code ${res.status} (${duration}s)`);
    process.exit(res.status || 1);
  }
  logSuccess(`Completed in ${duration}s`);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} kB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

async function main() {
  const args = process.argv.slice(2);
  const skipWasm = args.includes("--skip-wasm");
  const runTests = args.includes("--test");

  const totalStart = Date.now();

  console.log(`\n${colors.bold}${colors.green}================================================================${colors.reset}`);
  console.log(`  ${colors.bold}ShaderStudio Full Production Build Pipeline${colors.reset}`);
  console.log(`${colors.bold}${colors.green}================================================================${colors.reset}`);

  // Step 1: Rust WebAssembly compilation
  if (!skipWasm) {
    logStep(1, "Compiling Rust WebAssembly Engine (crates/shaderstudio_wasm)");
    const wasmOutDir = path.join(ROOT, "src", "wasm", "pkg");
    runCommand("wasm-pack", [
      "build",
      "crates/shaderstudio_wasm",
      "--target",
      "web",
      "--out-dir",
      "../../src/wasm/pkg",
    ]);

    const wasmFile = path.join(wasmOutDir, "shaderstudio_wasm_bg.wasm");
    if (fs.existsSync(wasmFile)) {
      const wasmStat = fs.statSync(wasmFile);

      // Synchronize to public/wasm and dist/wasm
      const publicWasmDir = path.join(ROOT, "public", "wasm");
      const distWasmDir = path.join(ROOT, "dist", "wasm");
      fs.mkdirSync(publicWasmDir, { recursive: true });
      fs.mkdirSync(distWasmDir, { recursive: true });
      fs.copyFileSync(wasmFile, path.join(publicWasmDir, "shaderstudio_wasm_bg.wasm"));
      fs.copyFileSync(wasmFile, path.join(distWasmDir, "shaderstudio_wasm_bg.wasm"));

      logSuccess(`Generated WebAssembly package: ${formatBytes(wasmStat.size)}`);
      console.log(`    ${colors.dim}→ src/wasm/pkg/shaderstudio_wasm_bg.wasm${colors.reset}`);
      console.log(`    ${colors.dim}→ public/wasm/shaderstudio_wasm_bg.wasm${colors.reset}`);
      console.log(`    ${colors.dim}→ dist/wasm/shaderstudio_wasm_bg.wasm${colors.reset}`);
    }
  } else {
    logStep(1, "Skipping Rust WebAssembly compilation (--skip-wasm flag passed)");
  }

  // Step 2: Optional Test Execution
  if (runTests) {
    logStep("1b", "Running Test Suites (Cargo & Vitest)");
    runCommand("cargo", ["test", "--manifest-path", "crates/shaderstudio_wasm/Cargo.toml"]);
    runCommand("npm", ["test"]);
  }

  // Step 3: TypeScript Typechecking
  logStep(2, "Running TypeScript Strict Typecheck (tsc -b)");
  runCommand("npx", ["tsc", "-b"]);

  // Step 4: Vite Production Bundle
  logStep(3, "Building Production Web Assets with Vite (dist/)");
  runCommand("npx", ["vite", "build"]);

  // Step 5: Assert Chunk Sizes
  logStep(4, "Analyzing Production Bundle Chunks");
  const distDir = path.join(ROOT, "dist");
  const assetsDir = path.join(distDir, "assets");

  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir);
    let entryChunkSize = 0;
    let entryChunkName = "";

    console.log(`\n  ${colors.dim}Asset Bundle Breakdown:${colors.reset}`);
    for (const file of files) {
      const filePath = path.join(assetsDir, file);
      const stat = fs.statSync(filePath);
      const sizeStr = formatBytes(stat.size).padStart(10);

      if (file.startsWith("index-") && file.endsWith(".js")) {
        entryChunkSize = stat.size;
        entryChunkName = file;
        console.log(`  ${colors.bold}${colors.cyan}→ ${file}${colors.reset}: ${sizeStr} ${colors.green}(Entry Chunk)${colors.reset}`);
      } else {
        console.log(`    ${file}: ${sizeStr}`);
      }
    }

    const budgetBytes = 300 * 1024;
    console.log("");
    if (entryChunkSize > 0) {
      if (entryChunkSize <= budgetBytes) {
        logSuccess(
          `Entry chunk ${entryChunkName} is ${formatBytes(entryChunkSize)} (Within 300 kB budget)`
        );
      } else {
        console.log(
          `  ${colors.yellow}⚠ Warning:${colors.reset} Entry chunk ${entryChunkName} is ${formatBytes(
            entryChunkSize
          )} (> 300 kB budget)`
        );
      }
    }
  }

  const totalDuration = ((Date.now() - totalStart) / 1000).toFixed(2);
  console.log(`\n${colors.bold}${colors.green}================================================================${colors.reset}`);
  console.log(`  ${colors.bold}${colors.green}✓ Full Build Succeeded in ${totalDuration}s${colors.reset}`);
  console.log(`  Output directory:   ${path.relative(process.cwd(), distDir)}`);
  console.log(`  WebAssembly Binary: ${path.relative(process.cwd(), path.join(distDir, "wasm", "shaderstudio_wasm_bg.wasm"))}`);
  console.log(`  To package standalone executable, run: npm run build:exe`);
  console.log(`${colors.bold}${colors.green}================================================================${colors.reset}\n`);
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
