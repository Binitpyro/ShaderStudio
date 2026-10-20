/* tslint:disable */
/* eslint-disable */

/**
 * Normalized mesh: `positions` / `normals` / `uvs` as `Float32Array`s.
 */
export class MeshResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly name: string;
    readonly normals: Float32Array;
    readonly positions: Float32Array;
    readonly triangle_count: number;
    readonly uvs: Float32Array;
    readonly vertex_count: number;
}

/**
 * PBR bake output: six PNG maps + ZIP archive as `Uint8Array`s.
 */
export class PbrBakeResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly albedo_png: Uint8Array;
    readonly ao_png: Uint8Array;
    readonly height: number;
    readonly height_png: Uint8Array;
    readonly metallic_png: Uint8Array;
    readonly normal_png: Uint8Array;
    readonly roughness_png: Uint8Array;
    readonly width: number;
    readonly zip_archive: Uint8Array;
}

export function bake_pbr_wasm(pixels: Uint8Array, config_val: any): PbrBakeResult;

export function normalize_geometry_wasm(positions: Float32Array, normals: Float32Array | null | undefined, uvs: Float32Array | null | undefined, name: string): MeshResult;

export function normalize_obj_wasm(obj_text: string, name: string): MeshResult;

export function reflect_uniforms_wasm(source: string, lang: string): any;

export function transpile_shader_wasm(request_val: any): string;

/**
 * WGSL -> GLSL ES 3.00 / GLSL 3.30 / HLSL via naga. Returns `{ code }` or `{ error, line? }`.
 */
export function transpile_wgsl_wasm(source: string, target: string, stage?: string | null): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_meshresult_free: (a: number, b: number) => void;
    readonly __wbg_pbrbakeresult_free: (a: number, b: number) => void;
    readonly bake_pbr_wasm: (a: number, b: number, c: any) => [number, number, number];
    readonly meshresult_name: (a: number) => [number, number];
    readonly meshresult_normals: (a: number) => [number, number];
    readonly meshresult_positions: (a: number) => [number, number];
    readonly meshresult_triangle_count: (a: number) => number;
    readonly meshresult_uvs: (a: number) => [number, number];
    readonly meshresult_vertex_count: (a: number) => number;
    readonly normalize_geometry_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly normalize_obj_wasm: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly pbrbakeresult_albedo_png: (a: number) => [number, number];
    readonly pbrbakeresult_ao_png: (a: number) => [number, number];
    readonly pbrbakeresult_height: (a: number) => number;
    readonly pbrbakeresult_height_png: (a: number) => [number, number];
    readonly pbrbakeresult_metallic_png: (a: number) => [number, number];
    readonly pbrbakeresult_normal_png: (a: number) => [number, number];
    readonly pbrbakeresult_roughness_png: (a: number) => [number, number];
    readonly pbrbakeresult_width: (a: number) => number;
    readonly pbrbakeresult_zip_archive: (a: number) => [number, number];
    readonly reflect_uniforms_wasm: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly transpile_shader_wasm: (a: any) => [number, number, number, number];
    readonly transpile_wgsl_wasm: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
