# 釉面工坊 Glaze Studio

浏览器端陶瓷釉面材质编辑与渲染工具。React 18 + TypeScript + 手写 WebGL2 / GLSL ES 3.00，零 3D 框架依赖。

## 启动

```bash
npm install
npm run dev      # 开发，默认 http://127.0.0.1:5173（端口被占用会自动顺延）
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览构建产物
```

## 五个页面

| 页面 | 能力 |
| --- | --- |
| 材质库 | 材质新建 / 复制 / 删除 / 重命名，localStorage 持久化，一键打包成 `.glazebundle.json` 发同事，支持导入合并，缩略图抓拍 |
| 节点编辑 | 拖拽式节点图，实时连线生成 GLSL；端口类型校验、环路检测、驱动编译错误回映到具体节点并红框高亮；撤销重做（60 步）、节点复制粘贴、节点库、GLSL 查看 |
| 器型 | 旋转轮廓线（Lathe）成型，SVG 拖拽控制点 / 加点 / 双击删点，碗、梅瓶、盘、玉壶春瓶预设，弧长 UV 防拉花 |
| 渲染预览 | 轨道相机；ACES / Reinhard 色调映射、曝光、MSAA、FOV；HDR 环境贴图（.hdr RGBE）加载与环境旋转；程序化摄影棚环境 |
| 导出 | 1080P–4K 及自定义尺寸，512px 分块协作式渲染，块间让出主线程不卡页面，可取消，显存峰值与出图分辨率无关，PNG 下载 |

## 关键技术点

- **节点 → GLSL 编译器**（`src/nodes/compiler.ts`）：拓扑排序后只生成被引用的输出；参数统一为 uniform；ramp 色带展开为定长 8 个数组。结构校验（缺输出节点、端口类型不匹配、环路、悬空连接）与驱动错误两级报错，`lineMap` 把 ANGLE / Firefox 两种日志格式的行号映射回节点 id。
- **釉层材质**（`src/webgl/shaders.ts`）：GGX PBR + IBL；半透明釉用 Beer-Lambert 吸收 `exp(-σ·厚度)`，釉厚处颜色更深并透出胎色；菲涅尔 F0 由 IOR 推导；开片裂纹在裂纹处压暗反光。
- **器型**（`src/vessel/lathe.ts`）：Catmull-Rom 采样轮廓，UV 的 v 按轮廓弧长、u 按极角并复制接缝列，避免纹理拉花与接缝断裂；壁厚属性随曲率与重力堆积变化。
- **分块渲染**（`Renderer.renderTiles`）：每块独立 512×512 FBO，通过修改投影矩阵的 NDC 缩放/平移裁剪全幅画面，`readPixels` 回读拼接，块间 `await` 一帧。无浮点缓冲扩展时自动回退 RGBA8。
- **显存控制**：4K 出图也只保留单块帧缓冲（RGBA16F + 深度约 2.6 MB），整幅结果只存在系统内存的 ImageData 中。

## 兼容性

所有 shader 经 headless Chrome（ANGLE / SwiftShader，OpenGL ES 3.0）真实编译链接验证，仅使用 GLSL ES 3.00 标准内建与常量索引友好写法，Chrome 与 Firefox 均可编译。不支持 `EXT_color_buffer_float` 的设备自动降级 RGBA8。

## 测试页（开发环境）

- `tests/glsl-test.html` — 编译全部 shader 与 12 种节点的最小图，验证链接与结构校验
- `tests/runtime-test.html` — 实例化 Renderer，四种器型网格、MSAA/非 MSAA 帧、分块出图、取消信号、资源释放的端到端验证

数据全部保存在浏览器 localStorage，不上传任何服务器。
