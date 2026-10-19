/* tslint:disable */
/* eslint-disable */

export function bake_pbr_wasm(pixels: Uint8Array, config_val: any): any;

export function normalize_geometry_wasm(positions: Float32Array, normals: Float32Array | null | undefined, uvs: Float32Array | null | undefined, name: string): any;

export function normalize_obj_wasm(obj_text: string, name: string): any;

export function reflect_uniforms_wasm(source: string, lang: string): any;

export function transpile_shader_wasm(request_val: any): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly bake_pbr_wasm: (a: number, b: number, c: any) => [number, number, number];
    readonly normalize_geometry_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly normalize_obj_wasm: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly reflect_uniforms_wasm: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly transpile_shader_wasm: (a: any) => [number, number, number, number];
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
