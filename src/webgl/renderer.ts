// WebGL2 渲染器：场景渲染、环境贴图管理、分块高分辨率出图
import type { CompileResult, GlazeParams, Material, MeshDataLike, RenderSettings } from './renderTypes';
import {
  BG_FRAG, BG_VERT, ENV_FRAG, ENV_VERT, FRAGMENT_SHADER_HEADER, VERTEX_SHADER,
} from './shaders';
import { GLSL_LIB } from '../nodes/glslLib';
import { mapDriverError } from '../nodes/compiler';
import type { NodeError, UniformSpec } from '../types';
import { mat4Identity, mat4LookAt, mat4Multiply, mat4Perspective, normalMat3 } from './mat4';

export interface CameraState {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
}

interface ProgramBundle {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

const ENV_SIZE = 512;
const TILE = 512;

export class Renderer {
  gl: WebGL2RenderingContext;
  get canvas(): HTMLCanvasElement { return this.canvasEl; }
  private canvasEl: HTMLCanvasElement;
  private mainProgram: ProgramBundle | null = null;
  private envProgram: ProgramBundle;
  private bgProgram: ProgramBundle;
  private envTexture: WebGLTexture;
  private quadVao: WebGLVertexArrayObject;
  private meshVao: WebGLVertexArrayObject | null = null;
  private indexCount = 0;
  private meshBuffers: WebGLBuffer[] = [];
  private indexBuffer: WebGLBuffer | null = null;
  private colorFBO: WebGLFramebuffer | null = null;
  private resolveFBO: WebGLFramebuffer | null = null;
  private colorTex: WebGLTexture | null = null;
  private depthRb: WebGLRenderbuffer | null = null;
  private resolveTex: WebGLTexture | null = null;
  private fboWidth = 0;
  private fboHeight = 0;
  private fboMsaa = false;
  private fboFloat = true;
  private lineMap: Record<number, string> = {};
  private lineOffset = 0;
  private materialUniforms: UniformSpec[] = [];
  private material: Material | null = null;
  private envMipCount = 1;
  private supportsFloatBuffer: boolean;

  constructor(canvas: HTMLCanvasElement) {
    this.canvasEl = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('当前浏览器不支持 WebGL2，请使用最新版 Chrome 或 Firefox');
    this.gl = gl;
    this.supportsFloatBuffer = !!gl.getExtension('EXT_color_buffer_float');
    this.envProgram = this.buildProgram(ENV_VERT, ENV_FRAG);
    this.bgProgram = this.buildProgram(BG_VERT, BG_FRAG);
    this.quadVao = this.createQuadVAO();
    this.envTexture = this.createEnvTexture();
    this.generateProceduralEnv(1.0);
  }

  // ---------- 基础工具 ----------

  private createQuadVAO(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) ?? 'unknown shader error';
      gl.deleteShader(sh);
      throw new Error(log);
    }
    return sh;
  }

  private buildProgram(vsSrc: string, fsSrc: string): ProgramBundle {
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, vsSrc);
    const fs = this.compile(gl.FRAGMENT_SHADER, fsSrc);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Program 链接失败: ' + gl.getProgramInfoLog(program));
    }
    const uniforms = new Map<string, WebGLUniformLocation | null>();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i)!;
      const name = info.name.replace(/\[0\]$/, '');
      uniforms.set(name, gl.getUniformLocation(program, name));
    }
    return { program, uniforms };
  }

  private loc(b: ProgramBundle, name: string) {
    return b.uniforms.get(name) ?? null;
  }

  // ---------- 环境贴图 ----------

  private envMipLevels(): number {
    return Math.floor(Math.log2(ENV_SIZE / 4)) + 1;
  }

  private createEnvTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const internal = this.supportsFloatBuffer ? gl.RGBA16F : gl.RGBA8;
    // 一次性分配完整 mip 链，后续 generateMipmap 才合法
    gl.texStorage2D(gl.TEXTURE_2D, this.envMipLevels(), internal, ENV_SIZE, ENV_SIZE / 2);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** 离屏把环境 shader 渲染到 envTexture 第 0 级，再生成预滤波 mip 链 */
  private renderEnvToTexture(seed: number) {
    const gl = this.gl;
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.envTexture, 0);
    gl.viewport(0, 0, ENV_SIZE, ENV_SIZE / 2);
    gl.useProgram(this.envProgram.program);
    gl.uniform1f(this.loc(this.envProgram, 'uSeed'), seed);
    gl.bindVertexArray(this.quadVao);
    gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindTexture(gl.TEXTURE_2D, this.envTexture);
    this.envMipCount = this.envMipLevels();
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.deleteFramebuffer(fbo);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  generateProceduralEnv(seed: number) {
    this.renderEnvToTexture(seed);
  }

  /** 加载 HDR 文件（.hdr RGBE） */
  loadHDRImage(buffer: ArrayBuffer, parse: (b: ArrayBuffer) => { width: number; height: number; data: Float32Array }) {
    const gl = this.gl;
    const img = parse(buffer);
    gl.deleteTexture(this.envTexture);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const internal = this.supportsFloatBuffer ? gl.RGBA16F : gl.RGBA8;
    if (this.supportsFloatBuffer) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, img.width, img.height, 0, gl.RGBA, gl.FLOAT, img.data);
    } else {
      // 回退：RGBM 编码到 RGBA8
      const rgbm = new Uint8Array(img.width * img.height * 4);
      for (let i = 0; i < img.width * img.height; i++) {
        const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2];
        const m = Math.min(1, Math.max(r, g, b) / 6 + 0.001);
        rgbm[i * 4] = Math.round((r / (m * 6)) * 255);
        rgbm[i * 4 + 1] = Math.round((g / (m * 6)) * 255);
        rgbm[i * 4 + 2] = Math.round((b / (m * 6)) * 255);
        rgbm[i * 4 + 3] = Math.round(m * 255);
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, img.width, img.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgbm);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.envMipCount = Math.floor(Math.log2(Math.min(img.width, img.height))) + 1;
    this.envTexture = tex;
  }

  // ---------- 材质编译 ----------

  /** 用编译结果构建主渲染 program；失败返回定位到节点的错误 */
  setMaterial(material: Material, compiled: CompileResult): NodeError[] {
    if (!compiled.ok) return compiled.errors;
    // 最终片元 = header（含 GLSL_LIB 占位符）+ 生成代码；库必须在材质函数之前
    const libInjected = FRAGMENT_SHADER_HEADER
      .replace('// ===== GLSL_LIB =====', GLSL_LIB)
      .replace('// ===== MATERIAL_GLSL =====', compiled.glsl);
    // 生成代码第一行在最终 shader 中的行号（lineMap 的 key 从 1 开始）
    const libMarkerLine = FRAGMENT_SHADER_HEADER.split('\n').findIndex((l) => l.includes('GLSL_LIB')) + 1;
    this.lineOffset = libMarkerLine + GLSL_LIB.split('\n').length;
    this.lineMap = compiled.lineMap;
    this.materialUniforms = compiled.uniforms;
    this.material = material;
    try {
      const bundle = this.buildProgram(VERTEX_SHADER, libInjected);
      if (this.mainProgram) this.gl.deleteProgram(this.mainProgram.program);
      this.mainProgram = bundle;
      return [];
    } catch (e) {
      return mapDriverError((e as Error).message, this.lineMap, this.lineOffset);
    }
  }

  // ---------- 网格 ----------

  setMesh(mesh: MeshDataLike) {
    const gl = this.gl;
    if (this.meshVao) gl.deleteVertexArray(this.meshVao);
    this.meshBuffers.forEach((b) => gl.deleteBuffer(b));
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
    this.meshBuffers = [];

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const attribs: [number, Float32Array, number][] = [
      [0, mesh.positions, 3],
      [1, mesh.normals, 3],
      [2, mesh.uvs, 2],
      [3, mesh.thickness, 1],
    ];
    attribs.forEach(([loc0, data, size]) => {
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc0);
      gl.vertexAttribPointer(loc0, size, gl.FLOAT, false, 0, 0);
      this.meshBuffers.push(buf);
    });
    this.indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    this.indexCount = mesh.indexCount;
    gl.bindVertexArray(null);
    this.meshVao = vao;
  }

  // ---------- FBO 管理（按需重建，限制显存占用） ----------

  private ensureFBO(w: number, h: number, msaa: boolean) {
    if (this.fboWidth === w && this.fboHeight === h && this.fboMsaa === msaa && this.colorFBO) return;
    const gl = this.gl;
    this.destroyFBO();
    const internal = this.supportsFloatBuffer ? gl.RGBA16F : gl.RGBA8;
    const type = this.supportsFloatBuffer ? gl.FLOAT : gl.UNSIGNED_BYTE;

    if (msaa) {
      const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
      this.colorFBO = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.colorFBO);
      this.colorTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
      this.depthRb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
      const msaaRb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, msaaRb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, internal, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msaaRb);

      this.resolveFBO = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFBO);
      this.resolveTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.resolveTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.resolveTex, 0);
    } else {
      this.colorFBO = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.colorFBO);
      this.colorTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTex, 0);
      this.depthRb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
      void type;
    }
    this.fboWidth = w;
    this.fboHeight = h;
    this.fboMsaa = msaa;
    this.fboFloat = this.supportsFloatBuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private destroyFBO() {
    const gl = this.gl;
    [this.colorFBO, this.resolveFBO].forEach((f) => f && gl.deleteFramebuffer(f));
    [this.colorTex, this.resolveTex].forEach((t) => t && gl.deleteTexture(t));
    if (this.depthRb) gl.deleteRenderbuffer(this.depthRb);
    this.colorFBO = this.resolveFBO = null;
    this.colorTex = this.resolveTex = null;
    this.depthRb = null;
    this.fboWidth = 0;
    this.fboFloat = true;
  }

  // ---------- 每帧渲染 ----------

  private cameraMatrices(cam: CameraState, aspect: number, fovDeg: number) {
    const eye: [number, number, number] = [
      cam.target[0] + cam.distance * Math.cos(cam.pitch) * Math.sin(cam.yaw),
      cam.target[1] + cam.distance * Math.sin(cam.pitch),
      cam.target[2] + cam.distance * Math.cos(cam.pitch) * Math.cos(cam.yaw),
    ];
    const view = mat4LookAt(eye, cam.target, [0, 1, 0]);
    const proj = mat4Perspective((fovDeg * Math.PI) / 180, aspect, 0.05, 100);
    return { eye, view, proj };
  }

  private applySceneUniforms(settings: RenderSettings, glaze: GlazeParams,
    eye: number[], view: Float32Array, proj: Float32Array, model: Float32Array) {
    const gl = this.gl;
    const b = this.mainProgram!;
    const u = (n: string) => this.loc(b, n);
    gl.uniformMatrix4fv(u('uView'), false, view);
    gl.uniformMatrix4fv(u('uProj'), false, proj);
    gl.uniformMatrix4fv(u('uModel'), false, model);
    gl.uniformMatrix3fv(u('uNormalMat'), false, normalMat3(model));
    gl.uniform3fv(u('uCameraPos'), eye);
    const vd = Math.hypot(eye[0], eye[1] - 0.45, eye[2]) || 1;
    gl.uniform3fv(u('uViewDir'), [eye[0] / vd, (eye[1] - 0.45) / vd, eye[2] / vd]);
    gl.uniform1f(u('uTime'), performance.now() / 1000);
    gl.uniform1f(u('uSeed'), glaze.seed);
    gl.uniform3fv(u('uBodyColor'), glaze.bodyColor);
    gl.uniform1f(u('uThicknessScale'), glaze.thicknessScale);
    gl.uniform1f(u('uAbsorption'), glaze.absorption);
    gl.uniform1f(u('uIor'), glaze.ior);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.envTexture);
    gl.uniform1i(u('uEnvMap'), 0);
    gl.uniform1f(u('uEnvRotation'), (settings.envRotation * Math.PI) / 180);
    gl.uniform1f(u('uEnvIntensity'), settings.envIntensity);
    gl.uniform1f(u('uLightIntensity'), settings.lightIntensity);
    gl.uniform3fv(u('uLightDir'), [-0.5, 0.8, 0.35]);
    gl.uniform3fv(u('uLightColor'), [1, 0.97, 0.92]);
    gl.uniform1f(u('uExposure'), settings.exposure);
    gl.uniform1i(u('uTonemap'), settings.tonemap === 'aces' ? 0 : settings.tonemap === 'reinhard' ? 1 : 2);
    gl.uniform1i(u('uBackground'), settings.background === 'env' ? 0 : settings.background === 'solid' ? 1 : 2);
    gl.uniform3fv(u('uBackgroundColor'), settings.backgroundColor);
    gl.uniform1f(u('uEnvMipCount'), this.envMipCount);

    // 材质节点 uniforms
    for (const spec of this.materialUniforms) {
      const l = this.loc(b, spec.name);
      if (!l) continue;
      if (spec.type === 'float') gl.uniform1f(l, spec.value as number);
      else if (spec.type === 'int') gl.uniform1i(l, spec.value as number);
      else if (spec.type === 'vec2') gl.uniform2fv(l, spec.value as number[]);
      else if (spec.type === 'vec3') gl.uniform3fv(l, spec.value as number[]);
      else if (spec.type === 'floatArray') gl.uniform1fv(l, spec.value as number[]);
      else if (spec.type === 'vec3Array') gl.uniform3fv(l, spec.value as number[]);
    }
  }

  render(settings: RenderSettings, glaze: GlazeParams, cam: CameraState) {
    if (!this.mainProgram || !this.meshVao) return;
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ensureFBO(w, h, settings.msaa);
    const { eye, view, proj } = this.cameraMatrices(cam, w / h, settings.fov);
    const model = mat4Identity();

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.colorFBO);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(...settings.backgroundColor, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 背景 pass
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.bgProgram.program);
    const invViewProj = invertMat4(mat4Multiply(proj, view));
    gl.uniformMatrix4fv(this.loc(this.bgProgram, 'uInvViewProj'), false, invViewProj);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.envTexture);
    gl.uniform1i(this.loc(this.bgProgram, 'uEnvMap'), 0);
    gl.uniform1f(this.loc(this.bgProgram, 'uEnvRotation'), (settings.envRotation * Math.PI) / 180);
    gl.uniform1f(this.loc(this.bgProgram, 'uEnvIntensity'), settings.envIntensity);
    gl.uniform1i(this.loc(this.bgProgram, 'uBackground'), settings.background === 'env' ? 0 : settings.background === 'solid' ? 1 : 2);
    gl.uniform3fv(this.loc(this.bgProgram, 'uBackgroundColor'), settings.backgroundColor);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 物体 pass
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.mainProgram.program);
    this.applySceneUniforms(settings, glaze, eye, view, proj, model);
    gl.bindVertexArray(this.meshVao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

    // MSAA resolve
    if (settings.msaa && this.resolveFBO) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.colorFBO);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFBO);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(null);
  }

  /** 当前帧画面呈现到画布（在 render 之后调用） */
  present() {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fboMsaa ? this.resolveFBO : this.colorFBO);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  }

  // ---------- 分块高分辨率出图 ----------

  /**
   * 协作式分块渲染：每块之间 await 一帧，页面保持响应。
   * 显存峰值 = 单块 TILE×TILE，而非整幅 4K。
   */
  async renderTiles(
    settings: RenderSettings,
    glaze: GlazeParams,
    cam: CameraState,
    outWidth: number,
    outHeight: number,
    onProgress: (done: number, total: number) => void,
    signal: { cancelled: boolean },
  ): Promise<ImageData | null> {
    if (!this.mainProgram || !this.meshVao) return null;
    const gl = this.gl;
    const cols = Math.ceil(outWidth / TILE);
    const rows = Math.ceil(outHeight / TILE);
    const total = cols * rows;
    const result = new ImageData(outWidth, outHeight);
    const baseAspect = outWidth / outHeight;
    const { eye, view, baseProj } = (() => {
      const c = this.cameraMatrices(cam, baseAspect, settings.fov);
      return { eye: c.eye, view: c.view, baseProj: c.proj };
    })();
    const model = mat4Identity();

    // 单块 FBO（无 MSAA，分块 + 亚像素 jitter 自带超采样效果）
    this.ensureFBO(TILE, TILE, false);
    const floatTiles = this.fboFloat;
    const px = floatTiles ? new Float32Array(TILE * TILE * 4) : new Uint8Array(TILE * TILE * 4);
    const bytePx = floatTiles ? null : (px as Uint8Array);

    let done = 0;
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        if (signal.cancelled) return null;
        const x0 = tx * TILE;
        const y0 = ty * TILE;
        const tw = Math.min(TILE, outWidth - x0);
        const th = Math.min(TILE, outHeight - y0);

        // 子投影：把全幅 NDC 窗口裁剪到当前块。
        // 投影列主序：m[0]/m[5] 控制缩放，m[8]/m[9] 控制 NDC 平移
        const scaleX = outWidth / tw;
        const scaleY = outHeight / th;
        const subProj = new Float32Array(baseProj);
        subProj[0] = baseProj[0] / scaleX;
        subProj[5] = baseProj[5] / scaleY;
        // 当前块中心在全幅 NDC 中的坐标
        const ndcCX = ((x0 + tw / 2) / outWidth) * 2 - 1;
        const ndcCY = 1 - ((y0 + th / 2) / outHeight) * 2;
        subProj[8] = baseProj[8] - ndcCX * subProj[0];
        subProj[9] = baseProj[9] - ndcCY * subProj[5];

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.colorFBO);
        gl.viewport(0, 0, TILE, TILE);
        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(this.bgProgram.program);
        gl.uniformMatrix4fv(this.loc(this.bgProgram, 'uInvViewProj'), false, invertMat4(mat4Multiply(subProj, view)));
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.envTexture);
        gl.uniform1i(this.loc(this.bgProgram, 'uEnvMap'), 0);
        gl.uniform1f(this.loc(this.bgProgram, 'uEnvRotation'), (settings.envRotation * Math.PI) / 180);
        gl.uniform1f(this.loc(this.bgProgram, 'uEnvIntensity'), settings.envIntensity);
        gl.uniform1i(this.loc(this.bgProgram, 'uBackground'), settings.background === 'env' ? 0 : settings.background === 'solid' ? 1 : 2);
        gl.uniform3fv(this.loc(this.bgProgram, 'uBackgroundColor'), settings.backgroundColor);
        gl.bindVertexArray(this.quadVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(this.mainProgram.program);
        this.applySceneUniforms(settings, glaze, eye, view, subProj, model);
        gl.bindVertexArray(this.meshVao);
        gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

        if (floatTiles) {
          gl.readPixels(0, 0, TILE, TILE, gl.RGBA, gl.FLOAT, px);
        } else {
          gl.readPixels(0, 0, TILE, TILE, gl.RGBA, gl.UNSIGNED_BYTE, bytePx);
        }
        // 翻转 Y 写入结果（WebGL 原点左下，ImageData 原点左上）
        for (let yy = 0; yy < th; yy++) {
          const srcRow = (TILE - 1 - yy) * TILE * 4;
          const dstY = y0 + yy;
          for (let xx = 0; xx < tw; xx++) {
            const si = srcRow + xx * 4;
            const di = ((dstY * outWidth) + x0 + xx) * 4;
            if (floatTiles) {
              result.data[di] = Math.round(Math.min(1, px[si]) * 255);
              result.data[di + 1] = Math.round(Math.min(1, px[si + 1]) * 255);
              result.data[di + 2] = Math.round(Math.min(1, px[si + 2]) * 255);
            } else {
              result.data[di] = bytePx![si];
              result.data[di + 1] = bytePx![si + 1];
              result.data[di + 2] = bytePx![si + 2];
            }
            result.data[di + 3] = 255;
          }
        }

        done++;
        onProgress(done, total);
        await yieldToBrowser();
      }
    }
    return result;
  }

  dispose() {
    const gl = this.gl;
    this.destroyFBO();
    gl.deleteTexture(this.envTexture);
    gl.deleteVertexArray(this.quadVao);
    if (this.meshVao) gl.deleteVertexArray(this.meshVao);
    this.meshBuffers.forEach((b) => gl.deleteBuffer(b));
    if (this.mainProgram) gl.deleteProgram(this.mainProgram.program);
    gl.deleteProgram(this.envProgram.program);
    gl.deleteProgram(this.bgProgram.program);
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/** 通用 4x4 求逆（列主序） */
function invertMat4(m: Float32Array): Float32Array {
  const inv = new Float32Array(16);
  const a = Array.from(m);
  inv[0] = a[5]*a[10]*a[15] - a[5]*a[11]*a[14] - a[9]*a[6]*a[15] + a[9]*a[7]*a[14] + a[13]*a[6]*a[11] - a[13]*a[7]*a[10];
  inv[4] = -a[4]*a[10]*a[15] + a[4]*a[11]*a[14] + a[8]*a[6]*a[15] - a[8]*a[7]*a[14] - a[12]*a[6]*a[11] + a[12]*a[7]*a[10];
  inv[8] = a[4]*a[9]*a[15] - a[4]*a[11]*a[13] - a[8]*a[5]*a[15] + a[8]*a[7]*a[13] + a[12]*a[5]*a[11] - a[12]*a[7]*a[9];
  inv[12] = -a[4]*a[9]*a[14] + a[4]*a[10]*a[13] + a[8]*a[5]*a[14] - a[8]*a[6]*a[13] - a[12]*a[5]*a[10] + a[12]*a[6]*a[9];
  inv[1] = -a[1]*a[10]*a[15] + a[1]*a[11]*a[14] + a[9]*a[2]*a[15] - a[9]*a[3]*a[14] - a[13]*a[2]*a[11] + a[13]*a[3]*a[10];
  inv[5] = a[0]*a[10]*a[15] - a[0]*a[11]*a[14] - a[8]*a[2]*a[15] + a[8]*a[3]*a[14] + a[12]*a[2]*a[11] - a[12]*a[3]*a[10];
  inv[9] = -a[0]*a[9]*a[15] + a[0]*a[11]*a[13] + a[8]*a[1]*a[15] - a[8]*a[3]*a[13] - a[12]*a[1]*a[11] + a[12]*a[3]*a[9];
  inv[13] = a[0]*a[9]*a[14] - a[0]*a[10]*a[13] - a[8]*a[1]*a[14] + a[8]*a[2]*a[13] + a[12]*a[1]*a[10] - a[12]*a[2]*a[9];
  inv[2] = a[1]*a[6]*a[15] - a[1]*a[7]*a[14] - a[5]*a[2]*a[15] + a[5]*a[3]*a[14] + a[13]*a[2]*a[7] - a[13]*a[3]*a[6];
  inv[6] = -a[0]*a[6]*a[15] + a[0]*a[7]*a[14] + a[4]*a[2]*a[15] - a[4]*a[3]*a[14] - a[12]*a[2]*a[7] + a[12]*a[3]*a[6];
  inv[10] = a[0]*a[5]*a[15] - a[0]*a[7]*a[13] - a[4]*a[5]*a[15] + a[4]*a[3]*a[13] + a[12]*a[1]*a[7] - a[12]*a[3]*a[5];
  inv[14] = -a[0]*a[5]*a[14] + a[0]*a[6]*a[13] + a[4]*a[1]*a[14] - a[4]*a[2]*a[13] - a[12]*a[1]*a[6] + a[12]*a[2]*a[5];
  inv[3] = -a[1]*a[6]*a[11] + a[1]*a[7]*a[10] + a[5]*a[2]*a[11] - a[5]*a[3]*a[10] - a[9]*a[2]*a[7] + a[9]*a[3]*a[6];
  inv[7] = a[0]*a[6]*a[11] - a[0]*a[7]*a[10] - a[4]*a[2]*a[11] + a[4]*a[3]*a[10] + a[8]*a[2]*a[7] - a[8]*a[3]*a[6];
  inv[11] = -a[0]*a[5]*a[11] + a[0]*a[7]*a[9] + a[4]*a[5]*a[11] - a[4]*a[3]*a[9] - a[8]*a[1]*a[7] + a[8]*a[3]*a[5];
  inv[15] = a[0]*a[5]*a[10] - a[0]*a[6]*a[9] - a[4]*a[1]*a[10] + a[4]*a[2]*a[9] + a[8]*a[1]*a[6] - a[8]*a[2]*a[5];
  let det = a[0]*inv[0] + a[1]*inv[4] + a[2]*inv[8] + a[3]*inv[12];
  if (Math.abs(det) < 1e-10) return mat4Identity();
  det = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}
