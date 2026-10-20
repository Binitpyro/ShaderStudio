#!/usr/bin/env node
/**
 * scripts/build-exe.js
 * 
 * Standalone Windows Executable (.exe) Packager for ShaderStudio.
 * 
 * 1. Checks if web assets exist in dist/; if not (or if --full passed), runs build-all.js.
 * 2. Compiles crates/shaderstudio_desktop into a standalone release executable.
 * 3. Embeds all dist/ assets (HTML, CSS, JS, WebAssembly, SVGs) in-memory inside the binary.
 * 4. Outputs ShaderStudio.exe to the workspace root (not dist/, to keep embedding clean).
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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} kB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
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

async function main() {
  const args = process.argv.slice(2);
  const forceFull = args.includes("--full");

  const totalStart = Date.now();

  console.log(`\n${colors.bold}${colors.cyan}================================================================${colors.reset}`);
  console.log(`  ${colors.bold}ShaderStudio Standalone Windows Executable Builder${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}================================================================${colors.reset}`);

  const distDir = path.join(ROOT, "dist");
  const indexHtml = path.join(distDir, "index.html");

  // Step 1: Ensure web assets exist
  if (!fs.existsSync(indexHtml) || forceFull) {
    logStep(1, "Building web assets first (running scripts/build-all.js)...");
    runCommand("node", ["scripts/build-all.js"]);
  } else {
    logStep(1, "Web assets found in dist/ (use --full to force re-build web assets)");
    logSuccess("Assets ready for embedding");
  }

  // Step 2: Compile Rust desktop binary
  logStep(2, "Compiling Standalone Rust Desktop Binary (crates/shaderstudio_desktop)");
  runCommand("cargo", [
    "build",
    "--release",
    "--manifest-path",
    "crates/shaderstudio_desktop/Cargo.toml",
  ]);

  // Step 3: Copy binary to output locations
  logStep(3, "Packaging Executable Deliverables");
  const targetExe = path.join(
    ROOT,
    "crates",
    "shaderstudio_desktop",
    "target",
    "release",
    "shaderstudio_desktop.exe"
  );

  if (!fs.existsSync(targetExe)) {
    logError(`Could not find compiled binary at: ${targetExe}`);
    process.exit(1);
  }

  const rootExe = path.join(ROOT, "ShaderStudio.exe");

  // Only the workspace root gets the exe. Never write it into dist/: the next cargo build would
  // see a changed dist/ (build.rs also skips *.exe as a second guard) and web deploys would ship it.
  fs.copyFileSync(targetExe, rootExe);
  const stale = path.join(distDir, "ShaderStudio.exe");
  if (fs.existsSync(stale)) fs.rmSync(stale);

  const exeStat = fs.statSync(rootExe);
  logSuccess(`Created root executable: ShaderStudio.exe (${formatBytes(exeStat.size)})`);

  const totalDuration = ((Date.now() - totalStart) / 1000).toFixed(2);
  console.log(`\n${colors.bold}${colors.green}================================================================${colors.reset}`);
  console.log(`  ${colors.bold}${colors.green}✓ Standalone Executable Successfully Generated in ${totalDuration}s!${colors.reset}`);
  console.log(`  File:     ${colors.bold}ShaderStudio.exe${colors.reset} (${formatBytes(exeStat.size)})`);
  console.log(`  Features: 100% Standalone, Zero Runtime Dependencies, Embedded Assets`);
  console.log(`${colors.bold}${colors.green}================================================================${colors.reset}`);
  console.log(`\n${colors.bold}How to Run:${colors.reset}`);
  console.log(`  1. Double-click ${colors.cyan}ShaderStudio.exe${colors.reset} in Windows Explorer.`);
  console.log(`  2. Or from terminal: ${colors.dim}.\\ShaderStudio.exe${colors.reset}`);
  console.log(`     Custom port:      ${colors.dim}.\\ShaderStudio.exe --port 9000${colors.reset}`);
  console.log(`     Headless server:  ${colors.dim}.\\ShaderStudio.exe --headless${colors.reset}\n`);
}

main().catch((err) => {
  console.error("Executable build failed:", err);
  process.exit(1);
});
