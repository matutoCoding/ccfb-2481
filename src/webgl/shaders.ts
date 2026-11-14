// 主渲染 shader（GLSL ES 3.00）
// MATERIAL_GLSL 占位符由编译器生成的材质函数替换

export const VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in float aThickness;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat3 uNormalMat;

out vec3 vWorldPos;
out vec3 vNormalW;
out vec2 vUv;
out vec3 vLocalPos;
out float vThickness;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormalW = normalize(uNormalMat * aNormal);
  vUv = aUv;
  vLocalPos = aPosition;
  vThickness = aThickness;
  gl_Position = uProj * uView * world;
}
`;

export const FRAGMENT_SHADER_HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

in vec3 vWorldPos;
in vec3 vNormalW;
in vec2 vUv;
in vec3 vLocalPos;
in float vThickness;

uniform vec3 uCameraPos;
uniform vec3 uViewDir;
uniform float uTime;
uniform float uSeed;

// 釉层与胎体
uniform vec3 uBodyColor;
uniform float uThicknessScale;
uniform float uAbsorption;
uniform float uIor;

// 环境与灯光
uniform sampler2D uEnvMap;
uniform float uEnvRotation;
uniform float uEnvIntensity;
uniform float uLightIntensity;
uniform vec3 uLightDir;
uniform vec3 uLightColor;

// 后处理
uniform float uExposure;
uniform int uTonemap;       // 0=ACES 1=Reinhard 2=无
uniform int uBackground;    // 0=环境 1=纯色 2=无(透明黑)
uniform vec3 uBackgroundColor;
uniform float uEnvMipCount;

out vec4 fragColor;

#define GS_PI 3.14159265359

vec3 rotateY(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

// 等距柱状环境贴图采样（支持粗糙度预滤波 mip）
vec3 sampleEnv(vec3 dir, float roughness) {
  vec3 d = rotateY(dir, uEnvRotation);
  float u = atan(d.z, d.x) / (2.0 * GS_PI) + 0.5;
  float v = asin(clamp(d.y, -1.0, 1.0)) / GS_PI + 0.5;
  float lod = roughness * roughness * (uEnvMipCount - 1.0);
  vec3 c = textureLod(uEnvMap, vec2(u, v), lod).rgb;
  return c * uEnvIntensity;
}

float distributionGGX(float ndh, float rough) {
  float a = rough * rough;
  float a2 = a * a;
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / max(1e-7, GS_PI * d * d);
}

float geometrySchlick(float ndv, float rough) {
  float r = rough + 1.0;
  float k = (r * r) / 8.0;
  return ndv / max(1e-7, ndv * (1.0 - k) + k);
}

vec3 fresnelSchlick(float cosTheta, vec3 f0) {
  return f0 + (1.0 - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// 轻量法线扰动：用程序化 3D 噪声梯度承载材质高度/裂纹，避免重复求值整个材质图
float gsHash31(vec3 q) {
  q = fract(q * 0.3183099 + vec3(0.1, 0.2, 0.3));
  q *= 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}

float gsVnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(gsHash31(i), gsHash31(i + vec3(1,0,0)), f.x),
        mix(gsHash31(i + vec3(0,1,0)), gsHash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(gsHash31(i + vec3(0,0,1)), gsHash31(i + vec3(1,0,1)), f.x),
        mix(gsHash31(i + vec3(0,1,1)), gsHash31(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}

vec3 perturbNormal(vec3 n, vec3 p, float height, float crackle) {
  float e = 0.08;
  float hx = gsVnoise(p + vec3(e, 0.0, 0.0)) - gsVnoise(p - vec3(e, 0.0, 0.0));
  float hy = gsVnoise(p + vec3(0.0, e, 0.0)) - gsVnoise(p - vec3(0.0, e, 0.0));
  float hz = gsVnoise(p + vec3(0.0, 0.0, e)) - gsVnoise(p - vec3(0.0, 0.0, e));
  // 高度量调制噪声强度，裂纹处叠加更锐利的高频扰动
  float amp = 0.25 + 0.5 * abs(height);
  vec3 grad = vec3(hx, hy, hz) * amp + vec3(hx, hy, hz) * crackle * 0.8;
  return normalize(n - grad * 0.35);
}

// ===== GLSL_LIB =====
// ===== MATERIAL_GLSL =====

void main() {
  MaterialOut m = evaluateMaterial();

  vec3 N = normalize(vNormalW);
  // 材质凹凸（含开片下陷），三维噪声梯度在 UV 接缝处保持连续
  N = perturbNormal(N, vLocalPos * 3.0 + vec3(uSeed * 11.0), m.normalHeight, m.crackle);

  vec3 V = normalize(uCameraPos - vWorldPos);
  float ndv = max(dot(N, V), 1e-4);

  // 釉厚：几何壁厚 * 材质厚度 * 节点厚度变化
  float thickness = clamp(vThickness * uThicknessScale * (0.6 + 0.8 * m.thickness), 0.0, 3.0);

  // 菲涅尔 F0：由 IOR 推导
  vec3 f0 = vec3(pow((uIor - 1.0) / (uIor + 1.0), 2.0));
  f0 = mix(f0, m.baseColor, m.metallic);

  vec3 R = reflect(-V, N);
  vec3 F = fresnelSchlick(ndv, f0);

  // ---- 环境 IBL（预滤波环境 + 固定 BRDF 积分近似） ----
  float rough = clamp(m.roughness, 0.04, 1.0);
  vec3 prefiltered = sampleEnv(R, rough);
  vec2 brdf = vec2(
    max(0.0, 1.0 - 0.5 * rough) * (1.0 - F.x) + F.x * 0.94,
    0.04 + 0.96 * pow(1.0 - ndv, 2.0) * (1.0 - rough * 0.6)
  );
  vec3 kS = F;
  vec3 kD = (1.0 - kS) * (1.0 - m.metallic);
  vec3 ambientSpec = prefiltered * (F * brdf.x + vec3(brdf.y));

  // ---- 半透明釉层：Beer-Lambert 吸收，釉厚处颜色更深，可透胎色 ----
  vec3 absorptionCoeff = uAbsorption * (1.0 / max(m.baseColor, vec3(0.02)));
  vec3 glazeTint = exp(-absorptionCoeff * thickness);
  vec3 diffuseBody = uBodyColor * glazeTint;
  // 釉色对散射光的染色
  vec3 ambientDiff = kD * diffuseBody * m.baseColor * sampleEnv(N, 1.0) * 0.6;
  vec3 color = ambientDiff + ambientSpec;

  // ---- 主方向光（陶瓷展台光） ----
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(V + L);
  float ndl = max(dot(N, L), 0.0);
  float ndh = max(dot(N, H), 0.0);
  float ndh2 = max(dot(H, V), 0.0);
  float D = distributionGGX(ndh, rough);
  float G = geometrySchlick(ndv, rough) * geometrySchlick(ndl, rough);
  vec3 spec = (D * G) * fresnelSchlick(ndh2, f0) / max(1e-4, 4.0 * ndv * ndl);
  vec3 diffuse = kD * diffuseBody * m.baseColor / GS_PI;
  color += (diffuse + spec) * uLightColor * ndl * uLightIntensity;

  // 开片：裂纹处露出更深的胎色、降低反光
  color = mix(color, color * vec3(0.25, 0.2, 0.16) + uBodyColor * 0.08, clamp(m.crackle, 0.0, 1.0) * 0.85);
  color *= 1.0 - clamp(m.crackle, 0.0, 1.0) * 0.35 * F;

  // ---- 曝光与色调映射 ----
  color *= uExposure;
  if (uTonemap == 0) color = aces(color);
  else if (uTonemap == 1) color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0 / 2.2));

  fragColor = vec4(color, 1.0);
}
`;

// 程序化摄影棚环境（浮点 HDR 量级，方向光窗 + 柔光箱 + 地面反弹）
export const ENV_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aQuad;
out vec2 vQuad;
void main() {
  vQuad = aQuad;
  gl_Position = vec4(aQuad, 0.0, 1.0);
}
`;

export const ENV_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vQuad;
out vec4 outColor;
#define GS_PI 3.14159265359
uniform float uSeed;

vec3 rotY(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

void main() {
  // 全屏四边形 -> 方向向量（等距柱状展开）
  float u = vQuad.x * 2.0 * GS_PI;
  float v = vQuad.y * GS_PI;
  vec3 dir = vec3(sin(v) * sin(u), cos(v), sin(v) * cos(u));

  vec3 col = vec3(0.05, 0.055, 0.065); // 暗环境基底

  // 顶部柔光箱
  vec3 keyDir = rotY(normalize(vec3(0.5, 0.8, 0.4)), uSeed * 0.7);
  float key = pow(max(dot(dir, keyDir), 0.0), 24.0);
  col += vec3(7.0, 6.6, 6.0) * key;

  // 侧面补光条带
  vec3 fillDir = rotY(normalize(vec3(-0.7, 0.25, 0.3)), 1.7 + uSeed * 0.3);
  float fill = pow(max(dot(dir, fillDir), 0.0), 40.0);
  col += vec3(2.2, 2.5, 3.2) * fill;

  // 地面暖色反弹
  float ground = smoothstep(0.1, -0.5, dir.y);
  col += vec3(0.55, 0.42, 0.3) * ground;

  // 顶部冷色天光
  float sky = smoothstep(0.2, 0.9, dir.y);
  col += vec3(0.35, 0.45, 0.6) * sky;

  outColor = vec4(col, 1.0);
}
`;

// 背景 pass：等距柱状环境 / 纯色
export const BG_VERT = ENV_VERT;

export const BG_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vQuad;
out vec4 outColor;
#define GS_PI 3.14159265359

uniform sampler2D uEnvMap;
uniform float uEnvRotation;
uniform float uEnvIntensity;
uniform int uBackground;
uniform vec3 uBackgroundColor;
uniform mat4 uInvViewProj;

vec3 rotY(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

void main() {
  if (uBackground == 1) {
    outColor = vec4(pow(uBackgroundColor, vec3(2.2)), 1.0);
    return;
  }
  vec4 ndc = vec4(vQuad, 1.0, 1.0);
  vec4 world = uInvViewProj * ndc;
  vec3 dir = normalize(world.xyz / world.w);
  dir = rotY(dir, uEnvRotation);
  float u = atan(dir.z, dir.x) / (2.0 * GS_PI) + 0.5;
  float v = asin(clamp(dir.y, -1.0, 1.0)) / GS_PI + 0.5;
  vec3 c = texture(uEnvMap, vec2(u, v)).rgb * uEnvIntensity;
  c = c / (c + vec3(1.0));
  outColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}
`;
