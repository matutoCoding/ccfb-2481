// 注入到生成材质 shader 中的 GLSL 公共函数库（GLSL ES 3.00，Chrome / Firefox 通用）
// 只使用标准内建函数与常量索引友好的写法，避免各厂商编译差异。

export const GLSL_LIB = /* glsl */ `
// GS_PI 由主 shader 头部统一定义

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float vnoise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}

float fbm2(vec2 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    sum += amp * vnoise2(p);
    p = p * 2.02 + vec2(17.1, 9.2);
    amp *= 0.5;
  }
  return sum;
}

float fbm3(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    sum += amp * vnoise3(p);
    p = p * 2.03 + vec3(13.7, 7.1, 5.3);
    amp *= 0.5;
  }
  return sum;
}

// 色带查找：positions/colors 长度固定 8，count 为实际停点数
vec3 rampSample3(float positions[8], vec3 colors[8], int count, float t) {
  if (t <= positions[0]) return colors[0];
  for (int i = 0; i < 7; i++) {
    if (i + 1 >= count) break;
    if (t <= positions[i + 1]) {
      float span = max(0.0001, positions[i + 1] - positions[i]);
      float k = (t - positions[i]) / span;
      return mix(colors[i], colors[i + 1], clamp(k, 0.0, 1.0));
    }
  }
  return colors[count - 1];
}

float rampSample1(float positions[8], vec3 colors[8], int count, float t) {
  vec3 c = rampSample3(positions, colors, count, t);
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

// 开片裂纹：Worley 细胞边界 + 域扭曲，返回 vec2(裂纹遮罩, 凹凸高度)
vec2 crackle2(vec2 uv, float scale, float width, float jitter, float seed) {
  vec2 p = uv * scale + vec2(seed * 13.7, seed * 7.3);
  // 域扭曲让裂纹走向自然
  p += (vec2(vnoise2(p * 0.65), vnoise2(p * 0.65 + 8.1)) - 0.5) * 2.0 * jitter;
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(
        hash21(ip + g + vec2(seed, 0.0)),
        hash21(ip + g + vec2(0.0, seed))
      );
      o = mix(g, g + o, 0.85);
      float d = length(o - fp);
      if (d < f1) { f2 = f1; f1 = d; }
      else if (d < f2) { f2 = d; }
    }
  }
  float edge = f2 - f1;
  float mask = 1.0 - smoothstep(width, width * 2.4, edge);
  // 裂纹处略微下陷
  float height = -mask * 0.5;
  return vec2(mask, height);
}

// 流釉：沿器高方向拉伸的域扭曲噪声，受重力方向（局部 -Y）影响
// 返回 vec2(流釉遮罩, 厚度变化)
vec2 flowGlaze(vec3 coord, float scale, float streak, float threshold, float seed) {
  vec3 p = coord * scale;
  p.y /= max(0.1, streak); // 纵向拉伸 → 下流条带
  vec3 warp;
  warp.x = fbm3(p + vec3(seed * 3.1, 0.0, 0.0), 3);
  warp.y = fbm3(p + vec3(0.0, seed * 5.7, 2.0), 3);
  warp.z = fbm3(p + vec3(1.0, 2.0, seed * 9.3), 3);
  float n = fbm3(p + (warp - 0.5) * 1.4, 3);
  float mask = smoothstep(threshold - 0.12, threshold + 0.12, n);
  // 越靠下流釉堆积越厚
  float gravity = clamp(0.5 - coord.y * 0.5, 0.0, 1.0);
  float height = mask * (0.4 + 0.6 * gravity);
  return vec2(mask, height);
}

float mathOp(int op, float a, float b) {
  if (op == 0) return a + b;
  if (op == 1) return a - b;
  if (op == 2) return a * b;
  if (op == 3) return a / max(0.0001, abs(b)) * sign(b);
  if (op == 4) return min(a, b);
  if (op == 5) return max(a, b);
  return pow(max(0.0, a), max(0.001, b));
}

vec3 combineOp(int mode, vec3 a, vec3 b, float f) {
  if (mode == 1) return a * b;
  if (mode == 2) return a + b;
  return mix(a, b, f);
}
`;
