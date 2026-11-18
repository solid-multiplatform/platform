import type { RendererCapabilities } from '../../common/types.js';
import { ENABLE_COMPRESSED_TEXTURES } from '../../common/flags.js';
import type { ClipStore } from '../scene/ClipStore.js';
import { defaultVertex, viewportGlsl } from '../shaders/glsl.js';
import { DEFAULT_FRAGMENT } from '../shaders/builtin/Default.js';
import { ContextSpy } from './contextSpy.js';
import {
  ARRAY_BUFFER,
  ELEMENT_ARRAY_BUFFER,
  FLOAT,
  LINEAR,
  LINEAR_MIPMAP_LINEAR,
  MAX_TEXTURE_IMAGE_UNITS,
  MAX_TEXTURE_SIZE,
  UNSIGNED_BYTE,
  createGlContext,
  type GlContext,
} from './GlContext.js';
import type { OpList } from './OpList.js';
import {
  enableCompressedFormat,
  mipmapped,
  uploadCompressed,
  type CompressedData,
} from '../textures/compressed.js';
import { Program, U_PIXEL_RATIO, U_RESOLUTION } from './Program.js';
import {
  BYTES_PER_VERTEX,
  WORDS_PER_QUAD,
  type VertexStream,
} from './VertexStream.js';

export interface GlBackendSettings {
  resizable?: boolean;
  forceWebGL2: boolean;
  disableVertexArrayObject: boolean;
  powerPreference: WebGLPowerPreference;
  enableContextSpy: boolean;
  /** 0xRRGGBBAA, uploaded straight as 1.10 did. */
  clearColor: number;
  /** Device pixels per logical pixel, compiled into every program. */
  pixelRatio: number;
  /**
   * Quads per chunk, the VertexStream's capacity (at most MAX_QUADS): sizes
   * the static index and node-coordinate buffers.
   */
  quadBufferSize: number;
}

/**
 * A chunk uploads its used quads rounded up to a multiple of this: at most
 * 63 stale quads (6 KB) ride along per upload.
 */
const UPLOAD_QUADS = 64;
/** Every attribute of Program ATTRIBUTES (5), one bit each. */
const ALL_ATTRIBUTES = 0x1f;

/**
 * The WebGL backend (spec 7): static buffers, textures (0 is a 1x1 white
 * texture), programs (0 is Default), one vertex layout for every program,
 * and the draw loop. The OpList has already merged quads that share a
 * program, params block, texture and clip; a draw issues one drawElements
 * per op plus the state changes GlContext cannot skip.
 */
export class GlBackend {
  readonly ctx: GlContext;
  /** WebGL call counts when `enableContextSpy` is set (telemetry, phase 6). */
  readonly spy: ContextSpy | null;
  /** Programs by id; phase 4 sets a program's `perOp`. */
  readonly programs: Program[] = [];
  /** This canvas's viewport as GLSL, for every program to compile in. */
  readonly viewport: string;
  /**
   * MAX_TEXTURE_SIZE, read once here (a CPU to GPU round trip, never in the
   * frame loop): the Uploader fails a larger texture, which WebGL would
   * refuse without an exception (TextureSink).
   */
  readonly maxTextureSize: number;
  /** Called when the context is lost; nothing is restored (1.10). */
  onContextLost: (() => void) | null = null;

  private readonly canvas: HTMLCanvasElement;
  /** Device pixels per logical pixel: u_pixelRatio for a custom shader. */
  private pixelRatio: number;
  private readonly textures: (WebGLTexture | null)[] = [];
  /** Texture 0: an op whose texture has no GL texture yet binds it. */
  private readonly white: WebGLTexture;
  private readonly vbo: WebGLBuffer;
  private readonly nodeCoords: WebGLBuffer;
  private readonly indices: WebGLBuffer;
  private cleared = false;
  private views: (Float32Array | null)[] = [];
  private viewSource: ArrayBuffer | null = null;
  private readonly lost: () => void;

  /** `canvas` is already sized: the viewport compiles in its size. */
  constructor(canvas: HTMLCanvasElement, settings: GlBackendSettings) {
    this.canvas = canvas;
    const spy = settings.enableContextSpy === true ? new ContextSpy() : null;
    this.spy = spy;
    const ctx = createGlContext(
      canvas,
      settings.forceWebGL2,
      settings.powerPreference,
      settings.disableVertexArrayObject,
      spy,
    );
    this.ctx = ctx;
    ctx.clearColor(settings.clearColor);
    // A lost context answers null (getCapabilities): 0, no limit known.
    this.maxTextureSize = ctx.parameter(MAX_TEXTURE_SIZE) ?? 0;
    this.viewport = settings.resizable
      ? 'uniform vec2 u_resolution;\n#ifndef SMP_PIXEL_RATIO_UNIFORM\n#define SMP_PIXEL_RATIO_UNIFORM\nuniform float u_pixelRatio;\n#endif\n#define PIXEL_RATIO u_pixelRatio\n#define RESOLUTION u_resolution\nvec4 pxToClip(vec2 p){return vec4((p*PIXEL_RATIO/RESOLUTION*2.0-1.0)*vec2(1.0,-1.0),0.0,1.0);}'
      : viewportGlsl(
      settings.pixelRatio,
      canvas.width,
      canvas.height,
    );
    this.pixelRatio = settings.pixelRatio;

    // The quad pattern [0,1,2, 2,1,3] for every quad of a chunk (Uint16:
    // Mali 400 has no 32-bit indices), bound with the vertex layout below.
    const quads = settings.quadBufferSize;
    const indices = new Uint16Array(quads * 6);
    for (let i = 0, v = 0; i < indices.length; i += 6, v += 4) {
      indices[i] = v;
      indices[i + 1] = v + 1;
      indices[i + 2] = v + 2;
      indices[i + 3] = v + 2;
      indices[i + 4] = v + 1;
      indices[i + 5] = v + 3;
    }
    this.indices = ctx.staticBuffer(ELEMENT_ARRAY_BUFFER, indices);
    // Per-corner node coordinates (0,0) (1,0) (0,1) (1,1) in vertex order,
    // as normalized bytes. Four bytes per corner, not two, keep the stride
    // 4-byte aligned: ES2 drivers repack misaligned attributes on the CPU.
    const corners = new Uint8Array(quads * 16);
    for (let i = 0; i < corners.length; i += 16) {
      corners[i + 4] = 255;
      corners[i + 9] = 255;
      corners[i + 12] = 255;
      corners[i + 13] = 255;
    }
    this.nodeCoords = ctx.staticBuffer(ARRAY_BUFFER, corners);
    this.vbo = ctx.createBuffer();
    // One vertex layout for every program, set up once: all six attributes
    // pointed and enabled, in a VAO when there is one, else in the default
    // VAO (which holds the index buffer already). A program ignores the
    // arrays it does not read, so a program switch binds no VAO and toggles
    // no array (spec 7.2: 4% to 7% more FPS on the Mali-400 TV).
    if (ctx.canUseVao === true) {
      const vao = ctx.createVao();
      if (vao !== null) {
        ctx.bindVao(vao);
        ctx.bindIndexBuffer(this.indices);
      }
    }
    this.point();
    ctx.enableAttribs(ALL_ATTRIBUTES);
    this.uploadTexture(0, new Uint8Array([255, 255, 255, 255]), 1, 1, false);
    this.white = this.textures[0]!;
    this.registerProgram(
      defaultVertex(this.viewport, '', ''),
      DEFAULT_FRAGMENT,
      null,
      'Default',
    );
    this.lost = (): void => {
      const onContextLost = this.onContextLost;
      if (onContextLost !== null) {
        onContextLost();
      }
    };
    canvas.addEventListener('webglcontextlost', this.lost);
  }

  /** A new frame: its first draw clears. */
  beginFrame(): void {
    this.cleared = false;
  }

  /**
   * Draw one chunk (spec 7.3): clear if this is the frame's first draw,
   * upload the used quads once, then one drawElements per op. Called for
   * every chunk flushed mid-walk (RendererCore.onFlush) and for the last
   * chunk after update().
   */
  draw(stream: VertexStream, ops: OpList, clips: ClipStore): void {
    const ctx = this.ctx;
    if (this.cleared === false) {
      this.cleared = true;
      // The scissor test applies to clear too.
      ctx.scissorTest(false);
      ctx.clear();
    }
    const n = ops.length;
    if (n === 0) {
      return;
    }
    ctx.uploadVertices(this.vbo, this.uploadView(stream));
    const programs = this.programs;
    const textures = this.textures;
    const white = this.white;
    const opProgram = ops.program;
    const opTexture = ops.texture;
    const opParams = ops.params;
    const opNode = ops.node;
    const opClip = ops.clip;
    const opStart = ops.start;
    const opCount = ops.count;
    for (let i = 0; i < n; i++) {
      const program = programs[opProgram[i]!]!;
      ctx.useProgram(program.handle);
      // No GL texture yet (a placeholder): white, so the quad draws its
      // colour; an unbound texture samples black.
      ctx.bindTexture(textures[opTexture[i]!] ?? white);
      const params = opParams[i]!;
      if (params !== null && params !== program.lastParams) {
        program.lastParams = params;
        // Built-in shaders: u_params rows, one call straight from the
        // block; a custom shader's named uniforms: one call each.
        const table = program.table;
        if (table === null || table.direct === true) {
          ctx.uniform4fv(program.params, params);
        } else {
          program.uploadTable(params);
        }
      }
      const perOp = program.perOp;
      if (perOp !== null) {
        perOp(opNode[i]!);
      }
      const clip = opClip[i]!;
      // clips.valid is read fresh, not cached above the loop: perOp may run
      // arbitrary code that allocates a clip record, and ClipStore.alloc can
      // grow the store, replacing every typed array (never cache one of its
      // fields across a call to alloc).
      if (clip !== 0 && clips.valid[clip] === 1) {
        ctx.scissorTest(true);
        ctx.scissor(
          clips.sx[clip]!,
          clips.sy[clip]!,
          clips.sw[clip]!,
          clips.sh[clip]!,
        );
      } else {
        ctx.scissorTest(false);
      }
      ctx.drawQuads(opStart[i]!, opCount[i]!);
    }
  }

  /**
   * Compile and link a program; returns its id (0 is Default). Throws when
   * linking fails, or when the device lacks one of `extensions` (a custom
   * shader's 1.10 `webgl1Extensions`, each enabled before compiling, since
   * enabling one is what lets a shader use it). A program that declares
   * `u_resolution` or `u_pixelRatio` gets them now: neither changes after
   * construction. `name` is the Program's, for developer tools.
   */
  registerProgram(
    vertex: string,
    fragment: string,
    extensions: string[] | null = null,
    name = '',
  ): number {
    const ctx = this.ctx;
    if (extensions !== null) {
      for (let i = 0; i < extensions.length; i++) {
        if (ctx.extension(extensions[i]!) === null) {
          throw new Error(`WebGL extension ${extensions[i]!} is not available`);
        }
      }
    }
    const program = new Program(ctx, vertex, fragment, name);
    this.setViewportUniforms(program);
    const programs = this.programs;
    programs.push(program);
    return programs.length - 1;
  }

  resize(pixelRatio: number): void {
    this.pixelRatio = pixelRatio;
    this.ctx.resizeViewport(this.canvas.width, this.canvas.height);
    for (const program of this.programs) this.setViewportUniforms(program);
  }

  private setViewportUniforms(program: Program): void {
    const ctx = this.ctx;
    const resolution = program.system[U_RESOLUTION]!;
    const ratio = program.system[U_PIXEL_RATIO]!;
    if (resolution !== null || ratio !== null) {
      ctx.useProgram(program.handle);
      if (resolution !== null) {
        ctx.uniform2f(resolution, this.canvas.width, this.canvas.height);
      }
      if (ratio !== null) {
        ctx.uniform1f(ratio, this.pixelRatio);
      }
    }

  }

  /**
   * Upload pixels as texture `id`, the op texture id, creating its GL
   * texture on first use. 0 is the white texture: phase 3's texture record
   * ids start at 1, since an upload to 0 would overwrite it. `premultiply`
   * is true for straight-alpha sources.
   */
  uploadTexture(
    id: number,
    source: TexImageSource | ArrayBufferView,
    w: number,
    h: number,
    premultiply: boolean,
  ): void {
    const textures = this.textures;
    while (textures.length <= id) {
      textures.push(null);
    }
    let texture = textures[id] ?? null;
    if (texture === null) {
      texture = this.ctx.createTexture(LINEAR);
      textures[id] = texture;
    }
    this.ctx.texImage(texture, source, w, h, premultiply);
  }

  /**
   * An atlas page as texture `id` (AtlasPages): `w` x `h` transparent
   * texels, LINEAR and CLAMP_TO_EDGE like every image texture.
   */
  createPage(id: number, w: number, h: number): void {
    const textures = this.textures;
    while (textures.length <= id) {
      textures.push(null);
    }
    const texture = this.ctx.createTexture(LINEAR);
    textures[id] = texture;
    this.ctx.texStorage(texture, w, h);
  }

  /** Upload pixels into page `id` at `x`, `y` (AtlasPages). */
  uploadSubImage(
    id: number,
    x: number,
    y: number,
    source: TexImageSource | ArrayBufferView,
    w: number,
    h: number,
    premultiply: boolean,
  ): void {
    this.ctx.texSubImage(this.textures[id]!, x, y, source, w, h, premultiply);
  }

  /**
   * Upload a compressed texture as texture `id`; false when the device has
   * no extension for its format (the texture then fails for good).
   */
  uploadCompressed(id: number, data: CompressedData): boolean {
    // Folds away, with compressed.ts, in a build without the flag.
    if (ENABLE_COMPRESSED_TEXTURES === false) {
      return false;
    }
    const ctx = this.ctx;
    if (enableCompressedFormat(ctx, data.glInternalFormat) === false) {
      return false;
    }
    const textures = this.textures;
    while (textures.length <= id) {
      textures.push(null);
    }
    // A record's GL texture is deleted when it is freed or removed, so an
    // upload always creates it, with the min filter its levels call for.
    const mip = mipmapped(data);
    let texture = textures[id] ?? null;
    if (texture === null) {
      texture = ctx.createTexture(mip === true ? LINEAR_MIPMAP_LINEAR : LINEAR);
      textures[id] = texture;
    }
    uploadCompressed(ctx, texture, data, mip);
    return true;
  }

  deleteTexture(id: number): void {
    const texture = this.textures[id] ?? null;
    if (texture !== null) {
      this.ctx.deleteTexture(texture);
      this.textures[id] = null;
    }
  }

  /** The idle GL out-of-memory probe (GlContext.outOfMemory): idle maintenance only. */
  outOfMemory(): boolean {
    return this.ctx.outOfMemory();
  }

  setClearColor(rgba: number): void {
    this.ctx.clearColor(rgba);
  }

  /** Reads GL parameters (a CPU to GPU round trip): call it once. */
  getCapabilities(): RendererCapabilities {
    const ctx = this.ctx;
    return {
      renderMode: 'webgl',
      webGlVersion: ctx.isWebGl2 === true ? 2 : 1,
      vertexArrayObject: ctx.canUseVao,
      // A lost context answers every query with null (real WebGL, and the
      // fake alike), although parameter() is typed as number.
      maxTextureSize: ctx.parameter(MAX_TEXTURE_SIZE) ?? 0,
      maxTextureUnits: ctx.parameter(MAX_TEXTURE_IMAGE_UNITS) ?? 0,
    };
  }

  /**
   * Stop listening for context loss and release every GL object by losing
   * the context: the canvas cannot host another renderer afterwards.
   */
  destroy(): void {
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    this.ctx.lose();
  }

  /**
   * The used part of the stream rounded up to a multiple of UPLOAD_QUADS:
   * WebGL1 uploads whole views and `subarray` allocates, so one view per
   * size is created on first use and reused.
   */
  private uploadView(stream: VertexStream): Float32Array {
    if (stream.buffer !== this.viewSource) {
      this.viewSource = stream.buffer;
      this.views = [];
    }
    const bucket = Math.ceil(stream.quadCount / UPLOAD_QUADS);
    const views = this.views;
    while (views.length <= bucket) {
      views.push(null);
    }
    let view = views[bucket] ?? null;
    if (view === null) {
      const quads = bucket * UPLOAD_QUADS;
      const capacity = stream.capacityQuads;
      view = new Float32Array(
        stream.buffer,
        0,
        (quads < capacity ? quads : capacity) * WORDS_PER_QUAD,
      );
      views[bucket] = view;
    }
    return view;
  }

  /** Point every attribute at its buffer, in the bound VAO. */
  private point(): void {
    const ctx = this.ctx;
    const vbo = this.vbo;
    ctx.attribPointer(vbo, 0, 2, FLOAT, false, BYTES_PER_VERTEX, 0);
    // FLOAT, not normalized UNSIGNED_SHORT: see VertexStream.
    ctx.attribPointer(vbo, 1, 2, FLOAT, false, BYTES_PER_VERTEX, 8);
    ctx.attribPointer(vbo, 2, 4, UNSIGNED_BYTE, true, BYTES_PER_VERTEX, 16);
    ctx.attribPointer(vbo, 3, 1, FLOAT, false, BYTES_PER_VERTEX, 20);
    ctx.attribPointer(this.nodeCoords, 4, 2, UNSIGNED_BYTE, true, 4, 0);
  }
}
