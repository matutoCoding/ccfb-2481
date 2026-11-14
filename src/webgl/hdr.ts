// Radiance RGBE (.hdr) 解析器，输出线性浮点像素
// 参考 Radiance 文件格式官方说明实现，零依赖

export interface HDRImage {
  width: number;
  height: number;
  /** RGBA float32 线性数据（A 恒为 1） */
  data: Float32Array;
}

export function parseHDR(buffer: ArrayBuffer): HDRImage {
  const bytes = new Uint8Array(buffer);
  let pos = 0;
  const readLine = (): string => {
    let end = pos;
    while (end < bytes.length && bytes[end] !== 0x0a) end++;
    const s = new TextDecoder('ascii').decode(bytes.subarray(pos, end));
    pos = end + 1;
    return s;
  };

  const sig = readLine();
  if (!sig.startsWith('#?RADIANCE') && !sig.startsWith('#?RGBE')) {
    throw new Error('不是有效的 Radiance HDR 文件（缺少 #?RADIANCE 头）');
  }
  // 跳过头部变量
  let line = readLine();
  while (line.length > 0) {
    line = readLine();
  }
  // 分辨率行："-Y height +X width" 或变体
  const dims = readLine();
  const m = /([+-][XY])\s*(\d+)\s*([+-][XY])\s*(\d+)/.exec(dims);
  if (!m) throw new Error('HDR 分辨率行解析失败：' + dims);
  let width = 0, height = 0;
  for (let i = 1; i <= 3; i += 2) {
    if (m[i].endsWith('X')) width = parseInt(m[i + 1], 10);
    else height = parseInt(m[i + 1], 10);
  }
  const flipY = m[1].startsWith('-');

  const data = new Float32Array(width * height * 4);
  const scanline = new Uint8Array(width * 4);

  const rgbeToFloat = (r: number, g: number, b: number, e: number, out: Float32Array, o: number) => {
    if (e === 0) {
      out[o] = out[o + 1] = out[o + 2] = 0;
    } else {
      const f = Math.pow(2, e - 128) / 255;
      out[o] = r * f;
      out[o + 1] = g * f;
      out[o + 2] = b * f;
    }
    out[o + 3] = 1;
  };

  const useNewRLE = width >= 8 && width <= 0x7fff;
  for (let y = 0; y < height; y++) {
    if (useNewRLE && bytes[pos] === 2 && bytes[pos + 1] === 2 && (bytes[pos + 2] & 0x80) === 0) {
      const lineW = (bytes[pos + 2] << 8) | bytes[pos + 3];
      if (lineW !== width) throw new Error('HDR 扫描线宽度不一致');
      pos += 4;
      // 分通道 RLE：R 全通道，再 G、B、E
      for (let ch = 0; ch < 4; ch++) {
        let x = 0;
        while (x < width) {
          const count = bytes[pos++];
          if (count > 128) {
            const run = count - 128;
            const val = bytes[pos++];
            for (let k = 0; k < run; k++) scanline[(x + k) * 4 + ch] = val;
            x += run;
          } else {
            for (let k = 0; k < count; k++) scanline[(x + k) * 4 + ch] = bytes[pos++];
            x += count;
          }
        }
      }
    } else {
      // 旧格式：逐像素 RLE
      let x = 0;
      while (x < width) {
        const r = bytes[pos++], g = bytes[pos++], b = bytes[pos++], e = bytes[pos++];
        if (r === 1 && g === 1 && b === 1 && e > 1) {
          const run = e;
          const pr = scanline[(x - 1) * 4];
          const pg = scanline[(x - 1) * 4 + 1];
          const pb = scanline[(x - 1) * 4 + 2];
          const pe = scanline[(x - 1) * 4 + 3];
          for (let k = 0; k < run && x < width; k++, x++) {
            scanline[x * 4] = pr;
            scanline[x * 4 + 1] = pg;
            scanline[x * 4 + 2] = pb;
            scanline[x * 4 + 3] = pe;
          }
        } else {
          scanline[x * 4] = r;
          scanline[x * 4 + 1] = g;
          scanline[x * 4 + 2] = b;
          scanline[x * 4 + 3] = e;
          x++;
        }
      }
    }
    const targetY = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const o = (targetY * width + x) * 4;
      rgbeToFloat(scanline[x * 4], scanline[x * 4 + 1], scanline[x * 4 + 2], scanline[x * 4 + 3], data, o);
    }
  }
  return { width, height, data };
}
