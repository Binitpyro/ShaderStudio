import { createZipArchive, type ZipFileInput } from "@/utils/zipBuilder"

export interface NpmPackageOptions {
  version?: string
  description?: string
  author?: string
  license?: string
  threeVersion?: string
}

export interface NpmPackageResult {
  packageJson: Record<string, any>
  indexTs: string
  readmeMd: string
  tsconfigJson: Record<string, any>
}

/**
 * Generates scaffolding for an npm-publishable material package.
 */
export function generateNpmPackage(
  packageName: string,
  shaderSource: string,
  options?: NpmPackageOptions
): NpmPackageResult {
  const version = options?.version || "1.0.0"
  const description = options?.description || "Compiled ShaderStudio material package"
  const license = options?.license || "MIT"
  const peerThree = options?.threeVersion || ">=0.150.0"

  const packageJson = {
    name: packageName,
    version,
    description,
    main: "dist/index.js",
    module: "dist/index.mjs",
    types: "dist/index.d.ts",
    scripts: {
      build: "tsc",
    },
    peerDependencies: {
      three: peerThree,
    },
    author: options?.author || "ShaderStudio",
    license,
  }

  const indexTs = `
import * as THREE from 'three';

export const shaderSource = ${JSON.stringify(shaderSource)};

export const defaultVertexShader = \`varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}\`;

export interface MaterialUniforms {
  time: number;
  resolution: [number, number];
}

export function createMaterial(renderer: any): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: defaultVertexShader,
    fragmentShader: shaderSource,
    uniforms: {
      u_time: { value: 0 },
      u_resolution: { value: new THREE.Vector2(1920, 1080) },
    },
  });
}
`.trim()

  const readmeMd = `# ${packageName}

${description}

Generated with [ShaderStudio](https://github.com/Binitpyro/ShaderStudio).

## Installation

\`\`\`bash
npm install ${packageName} three
\`\`\`

## Usage

\`\`\`typescript
import * as THREE from 'three';
import { shaderSource, createMaterial } from '${packageName}';

const material = createMaterial();
console.log('Shader material created:', material);
\`\`\`

## License
${license}
`.trim()

  const tsconfigJson = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "node",
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      outDir: "./dist",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
    include: ["src/**/*"],
  }

  return { packageJson, indexTs, readmeMd, tsconfigJson }
}

/**
 * Creates a ready-to-distribute ZIP archive containing all package files.
 */
export function createNpmPackageZip(
  packageName: string,
  shaderSource: string,
  options?: NpmPackageOptions
): Uint8Array {
  const pkg = generateNpmPackage(packageName, shaderSource, options)
  const encoder = new TextEncoder()

  const files: ZipFileInput[] = [
    {
      name: "package.json",
      data: encoder.encode(JSON.stringify(pkg.packageJson, null, 2)),
    },
    {
      name: "README.md",
      data: encoder.encode(pkg.readmeMd),
    },
    {
      name: "tsconfig.json",
      data: encoder.encode(JSON.stringify(pkg.tsconfigJson, null, 2)),
    },
    {
      name: "src/index.ts",
      data: encoder.encode(pkg.indexTs),
    },
  ]

  return createZipArchive(files)
}
