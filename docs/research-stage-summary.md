# Prism 阶段性研究与原型总结

> 阶段：核心架构落地与 baseline 实验平台建立
> 用途：记录当前方法、原型实现、初步 synthetic 结果及尚未验证的问题。本文按研究论文常见的“摘要—问题—方法—实验—讨论”结构整理，结果属于工程阶段的初步观察，不是经统计检验的研究结论。

## 摘要

Prism 是一个面向单张照片的稀疏 source→target 颜色校正原型。用户在图像中添加少量颜色约束，系统为每个 Correction Layer 分别推导作用场和共享颜色变换，再合成多个图层并处理输出色域。本阶段完成了这套架构的浏览器原型，并集中修复会影响算法对比可信度的基础问题：分析图缩放、root-polynomial 特征中心化、Transform 的数值安全与回退诊断。原型现提供可解释的 Activation 距离视图、像素/seed 特征检查器、synthetic fixture 和 Compare 结果面板。

当前 Activation 是 AppearanceGaussianActivation：颜色、位置、多尺度上下文和边缘特征距离组成的高斯相似度基线。它不估计物理光照，也不直接判断两个像素是否共享同一颜色变换 regime。初步 synthetic 结果显示，外观、位置、context 与 edge cues 在不同场景中存在明显权衡；少量约束下的 adaptive Transform 也可能保守地退化为 constant。当前阶段的主要产出是可观察、可测试的研究平台，尚未证明最终研究假设成立。

本阶段代码检查记录：`pnpm test -- --run` 通过 39 项测试，`pnpm build` 通过。这些检查验证原型实现与打包状态，不代表算法质量的科学验证。

## 1. 问题定义与研究目标

现实照片中，不同空间区域可能受到不同光照或相机 ISP 偏色；相同颜色在不同环境下可能需要不同修正，而不同颜色也可能共享同一修正机制。传统全局白平衡或单一颜色映射未必能描述这些差异；手工 mask 又增加交互成本。

Prism 将用户意图表示为每层一组稀疏约束：

\[
q_k=(p_k,s_k,t_k,c_k)
\]

其中 \(p_k\) 是归一化图像位置，\(s_k\) 是原图 source 颜色，\(t_k\) 是用户给出的 target，\(c_k\) 是置信度。一个 Correction Layer 对应用户认为应作为整体处理的一组约束，并拥有一个共享 Transform、Activation Field、strength/enabled 状态及可选 hints。

本项目的长远研究目标是：从原图证据与稀疏校准点推断 **transform-regime applicability**，使 Activation 更接近“该像素是否与约束属于同一变换机制”，而不只是“该像素与约束看起来是否相似”。当前实现是用于比较的 appearance-similarity baseline。

## 2. 方法与系统架构

### 2.1 总体流程

```text
Original image
  → area/box analysis resize
  → OKLab / multiscale context / edge features
  → per-constraint Activation Seeds
  → Layer aggregation + sparse hints
  → one shared Transform per Layer
  → residual-add / sequential / normalized-mixture
  → gamut mapping
  → preview / PNG
```

架构保持三个职责分离：Activation 决定作用位置及强度；Transform 决定颜色变化；Compositor 决定多个 Correction Layer 如何组合。所有约束仍属于一个或多个可见 Correction Layer，不采用 joint per-pixel regression 作为主架构。

### 2.2 图像特征与分析分辨率

encoded sRGB 输入解码为 linear sRGB，用于 Transform 拟合及合成；感知颜色特征转换为 OKLab。Activation 分析图默认最长边 512，可选 256 或 1024。当前默认 area/box resize 通过源像素与目标像素覆盖面积计算加权平均；nearest 和 bilinear 留作对照。

每个分析像素记录 OKLab、RGB、多尺度局部均值/方差、中尺度 local contrast、亮度梯度、色度梯度和合成 edge strength。局部统计使用积分图计算，默认 context radii 为 `[3, 12, 32]`（按 512 像素分析尺度定义）。

### 2.3 当前 Activation baseline

对查询像素特征 \(q\) 和约束 seed 特征 \(s\)，当前模型计算：

\[
D=w_cD_{color}+w_sD_{xy}+w_mD_{context}+w_eD_{edge}
\]
\[
A_{seed}=c\exp(-0.5\cdot sharpness\cdot D)
\]

颜色项为按尺度归一化的平方 OKLab 距离；空间项为归一化 XY 距离；context 比较三种尺度的局部均值、标准差及局部对比度；edge 比较纹理幅度、亮度梯度和色度梯度。支持 spatial-only、color-only、color+xy、color+context、color+context+edge 等 preset。Activation 只依赖原图证据、source、位置、confidence 和 Activation 配置，不读取 target。

多个 seed 默认以 probabilistic OR 聚合：

\[
A_{layer}=1-\prod_k(1-A_{seed,k})
\]

也可选择 smooth max。Include/exclude hints 是空间高斯影响，不是二值 mask；分别以 probabilistic include/exclude 规则修正 layer field。

### 2.4 Shared Transform、合成与色域

每层从其 `(source, target, confidence)` 约束拟合一个共享 residual transform：

\[
T(c)=c+\Delta(c)
\]

支持 constant residual、affine residual、centered root-polynomial residual 和 adaptive 模式。求解器使用 confidence 加权 ridge regression 和 Cholesky 分解。root-polynomial 的线性及交叉特征统一中心化；对可能为负的 linear RGB，交叉项使用连续的 signed-root product。自适应求解依据颜色 spread、约束数和条件数选择模型；Cholesky 失败或系数安全界限触发时向低阶模型回退，并记录诊断。非有限或极端像素输出采取 identity fallback 并计数。

默认 residual-add 对相同输入分别计算每层变换的 residual 后相加；同时支持 sequential 和 normalized-mixture。合成前保留有限的 gamut 外 linear RGB，默认在最后使用 OKLCH chroma compression 映射到 sRGB gamut。正常路径不提前逐通道 clamp 到 `[0,1]`。

### 2.5 原型与可观察性

Vue/TypeScript 前端通过 Web Worker 执行分析、Activation、合成及调试视图处理；WebGL2 预览组件展示生成的图像。管线缓存 feature maps、seed、聚合 field 和上采样结果；target 不进入 Activation cache key。target 修改只重求 Transform 与输出，source/位置或 Activation 设置变化才会更新相应 Activation 数据。

调试能力包括：每条约束的 seed field；selected constraint 的 color/spatial/context/edge/weighted-total distance heatmap；aggregated field、dominant seed、hint contribution；以及像素位置上的 Linear RGB、OKLab、多尺度均值/方差、local contrast、梯度、edge strength 和 query/seed 距离对比。Transform inspector 显示实际模型、条件数、残差、系数安全界限和数值回退诊断。

## 3. 实验平台与评估方法

### 3.1 Synthetic fixtures

当前 fixture 均由代码确定性生成，不依赖网络或运行时随机数，并提供 observed image、ground truth、约束及 regime mask：

| Fixture | 主要压力点 |
|---|---|
| Same color / different context | 观察颜色相近但上下文/校正区域不同的传播；只在左侧放一个 calibration point |
| Different colors / same regime | 以 white/red 约束测试 green/blue 等 held-out 颜色的作用场覆盖 |
| Object boundary leakage | 观察边界附近约束的跨物体传播 |
| Smooth warm-to-cool gradient | 观察连续空间变化与 layer 表达能力 |
| Two spatial illumination regions | 观察相邻区域使用不同变换的情形 |
| Nonlinear ISP-like bias | 比较 constant、affine、root-polynomial、adaptive Transform |
| Identity / preserve | 在有非零修正约束时加入 source=target 保持约束 |

Compare dock 的 benchmark runner 默认在 48×32 图像上运行。A/B/C 比较五种 Activation cue presets；nonlinear ISP fixture 比较四种 Transform 模型；其余场景运行默认组合。合成 runner 固定使用默认 compositor 和 resize 配置。UI 的 Compare presets 另可在用户照片上比较 resize、upsampling、compositor 和模型选项，但这些选项尚未全部纳入 synthetic runner 的交叉实验。

### 3.2 指标

- **颜色误差**：将输出及 ground truth 编码 RGB 解码至 linear RGB，计算 OKLab Euclidean error；报告 mean、median、p95。
- **Activation 区域统计**：按已知 regime mask 分别计算 inside/outside 平均 Activation；两侧区域都存在时计算 `outside / inside` leakage ratio。
- **运行与安全统计**：输出 out-of-gamut rate、约束数、有效 Transform 模型及 runtime。Pipeline runtime 分解为 feature extraction、seed generation、aggregation、Transform solve、render preparation 和 render。

这些数值是像素级 synthetic 评估，不是用户研究；benchmark 测试检查可执行性及指标有限值，不将某个质量阈值设为测试通过条件。

## 4. 初步结果

下表是一次 48×32 本地 CPU 运行的 baseline 快照。结果受实现参数、像素量及运行环境影响；当前没有重复试验或显著性检验。

### 4.1 Activation cue ablation

| Fixture | preset | inside activation | outside activation | leakage ratio |
|---|---|---:|---:|---:|
| Same color / different context | spatial-only | 0.627 | 0.227 | 0.363 |
|  | color-only | 0.925 | 0.916 | 0.991 |
|  | color+xy | 0.581 | 0.208 | 0.357 |
|  | color+context | 0.854 | 0.660 | 0.773 |
|  | color+context+edge | 0.635 | 0.278 | 0.438 |
| Object boundary leakage | spatial-only | 0.766 | 0.570 | 0.743 |
|  | color-only | 1.000 | 0.876 | 0.876 |
|  | color+xy | 0.766 | 0.408 | 0.533 |
|  | color+context | 0.979 | 0.818 | 0.835 |
|  | color+context+edge | 0.833 | 0.454 | 0.545 |

在 different-colors/same-regime fixture 中，整个图像均属于正确 regime，因此报告 inside mean，不报告 leakage ratio：spatial-only `0.607`、color-only `0.891`、color+xy `0.501`、color+context `0.825`、color+context+edge `0.545`。这些结果显示，仅凭外观或空间 affinity 的 cue 组合行为差异很大；更高的 Activation 均值本身不能证明正确识别了共享变换机制。

### 4.2 Transform 模型对照

| Nonlinear ISP fixture model | mean OKLab error | 实际模型 |
|---|---:|---|
| Constant | 0.004810 | constant |
| Affine | 0.004233 | affine |
| Root-polynomial | 0.004216 | root-polynomial |
| Adaptive | 0.004859 | constant |

fixture 只有三个 calibration constraints。adaptive 根据当前 evidence 规则选择 constant；该模型在这次 synthetic 样例上误差略高于更高自由度模型。此结果既不是证明自适应策略失败，也说明当前阈值与约束预算需要系统性评估。

其他默认配置快照：warm-to-cool-gradient mean error `0.01984`；two-spatial-regions `0.01867`；identity-preserve `0.02205`。这些值包含各自 fixture 的整体误差，不宜单独用于推断某个 compositor 或 Activation cue 的优劣。

## 5. 讨论与当前结论

1. **实现可信度有所提高**：分析图默认不再采用 nearest；resize 策略可比较；Transform 特征中心化和数值回退变得明确可测；gamut 外输出延后到 gamut mapper 处理。
2. **Activation 可解释性增加**：可以将 propagation 错误分解到颜色、位置、context、edge 和 hint 等组成项，避免只观察最终 heatmap。
3. **cue 存在场景权衡**：color-only 在同色异 context 案例中严重泄漏；context/edge 对边界案例有帮助但仍会泄漏。结果支持继续做结构化对比，不支持把当前 Gaussian affinity 当作 regime estimator。
4. **Transform 容量需要与证据预算共同评估**：本轮 synthetic nonlinear fixture 中 adaptive 在三个约束时选择 constant；不同模型的差异虽小，但暴露了阈值选择的实验问题。
5. **系统功能和算法新颖性需要区分**：Correction Layer、soft propagation、上下文特征、局部变换及低分辨率分析都有相关工作。本阶段建立的是可编辑、可诊断、可比较的系统原型和 baseline，而不是已经验证的新 Activation 算法。

## 6. 局限与有效性边界

- synthetic 场景由简化的线性/非线性扰动及程序化色块构成，不代表真实相机 ISP、复杂材料反射或自然场景统计。
- 48×32 快照用于快速评估方法行为；未报告不同分辨率、多个随机种子、不同机器上的方差。
- regime mask 是 fixture 中预先指定的粗粒度区域；其定义会影响 inside/outside 指标。不同 fixture 的 activation 统计不可直接当成统一质量分数。
- runner 当前没有对所有 fixture 穷举 compositor、resize 和 upsampling 组合；normalized-mixture 等比较需要补齐同一 synthetic ground truth 下的统一指标实验。
- 当前结果不包含真实照片 ground-truth benchmark、对照论文方法的完整复现、用户交互成本评估或 user study。
- coefficient/output safety、gamut compression 减少常见异常，但不构成全局单调性或无 fold 的理论保证。

## 7. 下一阶段建议

1. **冻结 benchmark 协议**：明确每个 fixture 的 regime mask、held-out 颜色、约束点数和随机/纹理种子；报告重复运行与分辨率对照。
2. **完成因子化 ablation**：分别控制 resize、upsampler、cue preset、aggregator、compositor 和 Transform，避免一次变更多个因素。
3. **强化 Transform 评估**：扩大 nonlinear fixture 的颜色覆盖和约束预算，分析 adaptive 何时开启 affine/root-polynomial 以及泛化误差，而非仅拟合约束点。
4. **加入更真实的数据**：使用有已知校正目标的图像或可控拍摄数据，重点测同色异光照、异色同变换和边界泄漏。
5. **再研究新 Activation**：以当前 AppearanceGaussianActivation 为固定 baseline，定义针对 transform-regime applicability 的目标/监督和评估协议；现阶段结果不应提前宣称已解决该问题。
6. **评估交互价值**：比较自动 Activation + hints 与人工 mask/brush 的耗时、操作数量、可预测性和校正质量。

## 8. 当前阶段总结

当前阶段完成了 Prism 核心数据流、稳定性修复、Activation/Transform 诊断和 synthetic Compare 实验平台。当前能够回答“基线在这些人为构造场景中如何响应、误差和泄漏是多少”；尚不能回答“方法在真实照片上是否优于既有方法”或“transform-regime Activation 是否可靠”。下一阶段应先扩大并规范实验，再根据实验结果决定 Activation 研究方向。

## 相关文档与实现

- 架构：[`architecture.md`](architecture.md)
- 算法细节：[`algorithm.md`](algorithm.md)
- 实验说明：[`experiments.md`](experiments.md)
- 可配置参数：[`pipeline-config.md`](pipeline-config.md)
- 设计与研究定位：[`../design-doc/color_activation_design_v0.3.md`](../design-doc/color_activation_design_v0.3.md)、[`../design-doc/color_research_positioning_v0.4.md`](../design-doc/color_research_positioning_v0.4.md)
- Synthetic runner：`src/experiments/fixtures/benchmark.ts`
