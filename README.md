# Prism — 交互式照片颜色校正原型

Prism 是一个纯前端、研究导向且可实际使用的照片颜色校正编辑器。用户从原图采样少量颜色，指定目标颜色，系统自动估计每个 correction layer 的连续作用场和共享颜色变换。图像不会上传到服务器；特征分析和渲染在浏览器内通过 Web Worker 执行，预览使用 WebGL2。

## 运行

需要 Node.js 20+、pnpm 10+ 和支持 WebGL2 的现代浏览器。

```bash
pnpm install
pnpm dev
pnpm test
```

打开终端输出的本机 URL（通常是 `http://localhost:5173`）。生产构建与本地预览：

```bash
pnpm build
pnpm preview
```

应用通过 `<input type="file">` 在本地解码照片。首次运行不需要账号、服务端、远程 API 或上传照片。

## 快速使用

1. 选择 **Import photo** 加载 JPEG、PNG、WebP 或浏览器支持的图片格式。
2. 在照片上点击：无选中 Layer 时会建立 Correction Layer 并采样 source；选中 Layer 后用 `+ Constraint` 将额外颜色加入同一共享 correction regime。
3. 右侧 **Source → target** 颜色选择器设置目标颜色；“Current color is correct”会建立 source=target 的 preserve constraint。
4. 调整 Layer strength、Activation、Transform、正则化和 compositor。include / exclude hint 可用一次点击微调作用范围。
5. 用预览菜单检查 Original、Corrected、Difference、Activation、Seed、Dominant layer、Contribution 和 out-of-gamut 视图；启用 **Compare** 横向比较算法 presets。
6. 保存 `.prism.json` 项目（保存用户意图和配置，不嵌入照片），或导出 PNG。

拖动 constraint marker 会从**原图**重新采样 source，并使对应 source/context activation 失效。修改 target 只改变 shared transform。`Ctrl/Cmd+Z` 撤销，`Ctrl/Cmd+Shift+Z` 或 `Ctrl/Cmd+Y` 重做。

## 算法概要

- encoded sRGB → linear sRGB 工作空间；Activation、色彩预览和 ΔE 使用 OKLab。
- 在默认 max dimension 512（可选 256/1024）提取 OKLab、normalized XY、三尺度均值/方差、local contrast、亮度/色度梯度及 edge/texture 特征。
- 每个 constraint 单独计算 Gaussian Activation Seed；公式不读取 target。Layer 聚合默认 probabilistic OR，也支持 smooth max 与空间 include/exclude hints。
- 每个 Layer 独立求一个 shared residual transform：constant、affine、centered second-order root-polynomial 或根据 spread / conditioning 自适应容量；weighted ridge 使用 Cholesky 求解。
- 默认 residual-add 在相同 input 上求所有 Layer residual，因而与图层顺序无关。还提供 sequential、normalized-mixture 和 hard-clip gamut 对照。
- Activation Field 低分辨率生成，再使用 bilinear 或 joint-bilateral upsampling；最终以 OKLCH chroma compression 映射到 sRGB gamut。

完整模块边界、公式、Pipeline 参数及当前实验假设见：

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/algorithm.md`](docs/algorithm.md)
- [`docs/pipeline-config.md`](docs/pipeline-config.md)
- [`docs/experiments.md`](docs/experiments.md)

实验 presets、synthetic fixture 生成器和 metrics hook 位于 `experiments/` 及 `src/experiments/`。研究定位以仓库中的 v0.3/v0.4 设计文档为准；当前 Gaussian context affinity 是可替换的 baseline，不宣称已经解决 transform-regime 推断。
