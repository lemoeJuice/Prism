# 基于 Correction Layer / Activation Field 的交互式颜色校正系统
## 最终核心设计 v0.3

> 日期：2026-09-26  
> 主定位：纯前端、交互式照片颜色校正工具。  
> 状态：核心架构冻结；后续允许替换 Activation、Transform、Compositor 等策略，但不再改变用户数据模型和顶层处理流程。

---

# 1. 项目目标

现实照片中的颜色误差往往不是一个全局白平衡、HSL、曲线或 LUT 就能完整描述的：

- 不同空间区域可能处于不同光照；
- 不同颜色经过手机/相机 ISP 后可能有不同幅度、不同方向的偏移；
- 相同输入颜色在不同上下文中可能需要不同修正；
- 同一个光照区域中的不同物体又可能共享同一种颜色变换；
- 用户通常知道“这里应该是什么颜色”，但不希望精确画 mask。

项目的核心交互因此定义为：

> 用户在照片中给出少量 source→target 颜色约束；系统自动推断每一条“校正”的作用强度场，并由一个或多个颜色约束推导该校正对应的颜色变换。

项目仍以**颜色校正**为主定位。由于 source→target 约束并不要求 target 必须是“真实颜色”，同一机制也自然支持较夸张的创意调色；这是一项重要扩展能力，但不改变项目主定位。

---

# 2. 核心对象

顶层一级对象不是单个 Calibration Point，而是：

\[
\boxed{\text{Correction Layer}}
\]

一个 Correction Layer 表示：

> 一种用户认为应该作为整体处理的颜色失真 / 校正意图。

每个 Layer 包含：

1. **Constraints**：一个或多个 source→target 颜色约束；
2. **Activation Field**：该 Layer 在整张图上的连续作用强度；
3. **Transform**：该 Layer 对颜色本身执行的共享变换；
4. **Strength / Enabled**：用户可见的图层级控制；
5. **Activation Hints（可选）**：轻量的“这里应该更强 / 这里不要影响”修正；
6. **Composition settings**：该 Layer 与其它 Layer 如何组合。

概念上：

```text
Correction Layer
├─ Constraints
│  ├─ q1: source → target
│  ├─ q2: source → target
│  └─ ...
├─ Activation Seeds
│  ├─ seed(q1)
│  ├─ seed(q2)
│  └─ ...
├─ Activation Field
├─ Shared Transform
├─ Strength
└─ Optional Activation Hints
```

---

# 3. Color Constraint

单个用户颜色约束：

\[
q_k=(p_k,s_k,t_k,c_k)
\]

其中：

- \(p_k\)：原图归一化位置；
- \(s_k\)：原图 source color；
- \(t_k\)：用户指定的 target color；
- \(c_k\)：constraint confidence。

如果用户认为颜色原本正确：

\[
t_k=s_k
\]

则它仍是普通约束，只是 residual 为 0。

这类约束可以用于告诉一个共享 Transform：

> 这种颜色在这个 correction regime 下应尽量保持不变。

---

# 4. 总体处理流程

```text
Original Image
      │
      ▼
Feature Extraction
      │
      ├────────────────────────────────────┐
      │                                    │
      ▼                                    ▼
Correction Layer 1                  Correction Layer N
      │                                    │
      ├─ Constraints                       ├─ Constraints
      │                                    │
      ├─ Per-Constraint                    ├─ Per-Constraint
      │  Activation Seeds                  │  Activation Seeds
      │                                    │
      ▼                                    ▼
 Activation Aggregator                Activation Aggregator
      │                                    │
      ▼                                    ▼
 Activation Field A1(x,y)             Activation Field AN(x,y)
      │                                    │
      ├──────────────┐                     ├──────────────┐
      │              │                     │              │
      ▼              ▼                     ▼              ▼
  Shared          Strength             Shared          Strength
 Transform T1                         Transform TN
      │                                    │
      └──────────────┬─────────────────────┘
                     ▼
               Layer Compositor
                     │
                     ▼
                Gamut Handling
                     │
                     ▼
                   Output
```

核心职责固定：

- **Activation** 回答“这个 Layer 在哪里、以多大强度作用？”
- **Transformation** 回答“这个 Layer 作用时，颜色应该怎么变？”
- **Compositor** 回答“多个 Layer 重叠时怎样组合？”

这三个问题必须保持解耦。

---

# 5. Activation：每个 Constraint 先生成 Seed

用户最初的直觉保留为核心设计：

> 每一个用户添加的约束，都独立生成一个全图连续 Activation Seed。

对于 Layer \(l\) 中第 \(k\) 个 constraint：

\[
a_{lk}(p)
=
A(I_{original},p,q_{lk})
\in[0,1]
\]

它表示：

> 仅根据这个约束在原图中的 source/context 信息，它所代表的 transform regime 对像素 \(p\) 有多可信？

必须满足：

\[
\frac{\partial a_{lk}}{\partial t_{lk}}=0
\]

也就是说：

**Activation 严禁读取 target color。**

用户把 target 从轻微修正改成极端风格化颜色时，Activation Seed 不应改变。

---

# 6. Activation 估计的不是普通“颜色相似”

Activation 的目标不是：

\[
P(\text{same color})
\]

也不是：

\[
P(\text{same object})
\]

而更接近：

\[
\boxed{
P(\text{same transform regime}\mid I_{original})
}
\]

因此应允许：

### 同色但不同 regime

两个浅灰像素，一个在暖光下、一个在冷光下：

\[
Activation\rightarrow low
\]

### 不同颜色但同 regime

白墙、红杯子、绿植物都受同一盏暖灯：

\[
Activation\rightarrow high
\]

这意味着 raw color distance 只能是 Activation 的一项 cue，而不能成为唯一决定因素。

---

# 7. Activation Feature

第一版 feature vector 应至少包含：

## 7.1 原始颜色特征

使用 OKLab / OKLCH，例如：

- \(L\)
- \(a,b\)
- chroma
- hue
- 相对局部均值的颜色 residual

## 7.2 空间特征

归一化 \(x,y\)。

空间距离是先验，而不是硬限制。

## 7.3 多尺度 Context

建议 small / medium / large 三个尺度：

- mean OKLab
- variance
- local contrast
- chroma statistics
- 可选低维 color moments / histogram

## 7.4 Edge / Structure

- luminance gradient
- chroma gradient
- local texture strength
- edge density / direction

## 7.5 后续可扩展

- geodesic connectivity
- illumination descriptor
- semantic embedding
- depth
- learned feature embedding

所有特征都必须来自 original image。

---

# 8. Activation Seed 默认模型

第一版默认：

\[
D_{lk}(p)=
w_cD_c+
w_sD_s+
w_mD_{multi-scale-context}+
w_eD_{edge}
\]

\[
a_{lk}(p)=
r_{lk}\exp\left(-\frac12D_{lk}(p)\right)
\]

其中全部权重、scale、sharpness 都必须配置化。

ActivationModel 是可替换策略，不得写死在 UI 或 renderer 中。

---

# 9. 从 Activation Seeds 得到 Layer Activation Field

一个 Layer 可以只有一个 constraint，此时：

\[
A_l(p)=a_{l1}(p)
\]

多个 constraint 共同描述同一种 correction regime 时，需要一个 Layer-level ActivationAggregator：

\[
A_l(p)
=
Agg(a_{l1}(p),...,a_{ln}(p),Hints_l)
\]

默认实现建议提供至少：

### 9.1 Probabilistic OR

\[
A_l
=
1-\prod_k(1-a_{lk})
\]

优点：

- 保持 \([0,1]\)；
- 任一强 seed 都可以激活区域；
- 多个 seed 能扩充同一 Layer 的覆盖区域；
- 单 constraint 自然退化。

### 9.2 Smooth Max

用于实验：

\[
A_l\approx smoothmax(a_{l1},...,a_{ln})
\]

避免多个相似 seed 因简单求和而过度增益。

Aggregator 必须是策略接口，以便比较：

- max
- smoothmax
- probabilistic OR
- learned/prototype-based aggregation

Layer Activation Field 是一个**用户可见的一等对象**。

---

# 10. Activation Hints

Activation 不要求用户画精确 mask，但允许可选的轻量修正：

```text
Include here  (+)
Exclude here  (-)
```

数据结构：

```ts
interface ActivationHint {
  position: Vec2
  type: "include" | "exclude"
  strength: number
  radius?: number
}
```

Hint 不直接变成硬 mask，而是修正自动推导的连续 Activation Field。

这允许系统在 Activation 推断不准时接受极低成本反馈，同时保持“无需精确画区域”的主交互。

---

# 11. Shared Transform：一个 Layer 一个变换

每个 Correction Layer 拥有一个共享 Transform：

\[
T_l(c)
\]

它由该 Layer 内全部 constraints：

\[
(s_k,t_k,c_k)
\]

共同求解。

注意：

**Activation Field 不参与 Transform 的颜色拟合。**

原因是 Layer 已经由用户明确表示“这些 constraints 属于同一种 correction regime”。

因此：

- Activation 决定这个共享 Transform 在哪里作用；
- Constraints 决定这个共享 Transform 长什么样。

这比“对每个像素重新联合所有 Layer 的 evidence 求一个 Transform”更符合用户可见图层模型，也允许用户独立开关、调强度和修改每条校正。

---

# 12. Transform 的统一 Residual 表示

统一使用：

\[
T_l(c)=c+\Delta_l(c)
\]

没有 correction：

\[
\Delta=0
\]

单个 Layer 的最终作用：

\[
E_l(p,c)
=
c+
g_l(p)\Delta_l(c)
\]

其中：

\[
g_l(p)=
clamp(strength_l\cdot A_l(p),0,1)
\]

---

# 13. Evidence-Adaptive Transform

Transform 的自由度由 Layer 内颜色约束数量和颜色覆盖决定。

## 13.1 Constant residual

只有一个独立颜色约束或 evidence 很弱：

\[
T(c)=c+\delta
\]

## 13.2 Linear / affine residual

多个独立颜色约束：

\[
T(c)=c+Bc+b
\]

## 13.3 Centered root-polynomial residual

约束颜色覆盖足够：

\[
T(c)=c+B\phi(c;\mu)
\]

可使用：

\[
\phi=
[
1,
r-\mu_r,
g-\mu_g,
b-\mu_b,
\sqrt{rg}-\sqrt{\mu_r\mu_g},
\sqrt{rb}-\sqrt{\mu_r\mu_b},
\sqrt{gb}-\sqrt{\mu_g\mu_b}
]
\]

TransformModel 必须允许三种模式：

- 明确固定 constant；
- 明确固定 affine；
- 明确固定 root-polynomial；
- `adaptive` 自动按 evidence 控制高阶 regularization。

---

# 14. Transform Solver

由约束：

\[
s_k\rightarrow t_k
\]

令：

\[
d_k=t_k-s_k
\]

做 weighted ridge regression：

\[
B^*
=
\arg\min_B
\sum_k c_k
\|B\phi(s_k)-d_k\|^2
+
B\Lambda B^T
\]

使用稳定的 Cholesky 求解。

需要计算：

- constraint count
- effective independent color coverage
- design matrix condition estimate
- solver stability

证据不足或 ill-conditioned 时必须自动增强高阶 regularization，而不是输出不稳定高自由度 transform。

---

# 15. 用户如何微调 Transform

用户不应该只看到不可解释的矩阵。

第一版至少提供：

1. 编辑每个 constraint 的 target；
2. Layer Strength；
3. Transform model 模式；
4. advanced inspector 中查看/调 regularization。

架构预留：

```ts
interface TransformModifier {
  apply(base: Transform): Transform
}
```

未来可以加入：

- exposure
- temperature/tint
- saturation
- hue bias
- curve
- direct coefficient fine-tuning

因此 Layer 的共享 Transform 可以在自动拟合之后继续被用户微调，而不需要重算 Activation Field。

---

# 16. 多 Layer Composition

多个 Correction Layer 可以重叠。

这不是 Activation 内部的问题，而由独立的 LayerCompositor 处理。

必须从一开始做成策略接口。

## 16.1 默认：Order-independent Residual Add

对共同输入颜色 \(c\)：

\[
\Delta_l(c)=T_l(c)-c
\]

\[
c'
=
c+
G\left(
\sum_l
strength_l A_l(p)\Delta_l(c)
\right)
\]

其中 \(G\) 是稳定性 / gamut limiter。

优点：

- 默认不依赖图层顺序；
- 适合研究比较；
- 每个 Layer 的 contribution 可直接可视化。

## 16.2 Sequential Adjustment Layers

实验模式：

\[
c_{l+1}
=
mix(c_l,T_l(c_l),g_l)
\]

优点：

- 更接近传统 adjustment layer 心智模型；
- 可表达前后依赖。

缺点：

- 顺序敏感。

## 16.3 Normalized Mixture

作为 mixed-illumination baseline：

\[
c'
=
w_0c+
\sum_lw_lT_l(c)
\]

其中包含 identity expert。

适合测试多个互斥/竞争 transform regime 的混合。

Compare Mode 应允许横向比较不同 compositor。

---

# 17. Creative Grading 的定位

项目仍以 correction 为主。

但系统数学上只要求：

\[
source\rightarrow target
\]

因此 target 可以是：

- 用户现实中看到的颜色；
- 用户希望的创意颜色。

这带来一个重要产品优势：

> 同一个 Correction Layer 可以从轻微校正逐步调整为较夸张效果，而 Activation Field 保持不变。

强烈创意变换时，需要额外关注：

- gamut overflow
- transform folding
- extreme extrapolation
- overlapping Layer composition

但不需要改变核心数据模型。

---

# 18. Working Color Spaces

## Transform

使用 linear sRGB 作为第一版工作空间。

## Activation / UI

使用 OKLab / OKLCH：

- perceptual distance
- color picker / visualization
- context feature
- gamut handling

Pipeline：

```text
encoded sRGB
→ linear sRGB ──────────────→ Transform
        │
        └→ OKLab/OKLCH → Activation/UI
```

后续可扩展 Display-P3，不改变算法接口。

---

# 19. Gamut Handling

禁止简单逐通道 hard clip 作为最终策略。

第一版建议：

```text
linear RGB
→ OKLab/OKLCH
→ 保持 lightness / hue
→ 压缩 chroma 到目标 gamut
→ output RGB
```

GamutMapper 必须是独立策略接口。

---

# 20. 数据结构

```ts
interface ColorConstraint {
  id: string
  position: Vec2
  source: LinearRGB
  target: LinearRGB
  confidence: number
}

interface ActivationHint {
  id: string
  position: Vec2
  type: "include" | "exclude"
  strength: number
  radius?: number
}

interface CorrectionLayer {
  id: string
  name: string
  enabled: boolean
  strength: number

  constraints: ColorConstraint[]
  activationHints: ActivationHint[]

  activationConfig: ActivationConfig
  activationAggregator: ActivationAggregatorConfig

  transformConfig: TransformConfig
  transformModifiers: TransformModifierConfig[]

  metadata?: Record<string, unknown>
}

interface Project {
  version: number
  image: ImageReference
  layers: CorrectionLayer[]
  pipeline: PipelineConfig
}
```

只保存用户意图和配置。

不保存：

- feature maps
- activation textures
- solved transform cache
- GPU textures

这些都是可重建 cache。

---

# 21. 策略接口

```ts
interface FeatureExtractor {
  analyze(image: AnalysisImage, config: FeatureConfig): Promise<FeatureMap>
}

interface ActivationModel {
  evaluate(
    query: PixelFeature,
    seed: ConstraintFeature,
    config: ActivationConfig
  ): number
}

interface ActivationAggregator {
  aggregate(
    seeds: readonly number[],
    hints: ActivationHintSample[],
    config: ActivationAggregatorConfig
  ): number
}

interface TransformModel {
  solve(
    constraints: readonly ColorConstraint[],
    config: TransformConfig
  ): SolvedTransform
}

interface SolvedTransform {
  apply(color: LinearRGB): LinearRGB
}

interface LayerCompositor {
  compose(
    input: LinearRGB,
    contributions: readonly LayerContribution[],
    config: CompositorConfig
  ): LinearRGB
}

interface GamutMapper {
  map(color: LinearRGB, config: GamutConfig): LinearRGB
}
```

核心 UI 不得依赖某个具体实现。

---

# 22. 浏览器实现

推荐：

- Vue 3
- TypeScript
- Vite
- WebGL2
- Web Worker

可选后续：

- WASM
- WebGPU
- ONNX Runtime Web

目录建议：

```text
src/
├─ app/
├─ core/
│  ├─ color/
│  ├─ features/
│  ├─ constraints/
│  ├─ activation/
│  ├─ transform/
│  ├─ compositor/
│  ├─ gamut/
│  ├─ pipeline/
│  └─ project/
├─ renderer/
│  └─ webgl2/
├─ workers/
├─ experiments/
└─ tests/
```

---

# 23. Analysis / GPU Pipeline

```text
Input Image
   ↓
Decode / orientation
   ↓
Original full-resolution texture
   ↓
Analysis image (max dimension ~512)
   ↓
Feature pyramid
   ↓
Per-layer per-constraint Activation Seeds
   ↓
Layer Activation Aggregation
   ↓
Activation textures
   ↓
Per-layer Transform solve
   ↓
Transform parameter cache
   ↓
Full-resolution WebGL2 shader
   ↓
Layer composition
   ↓
Gamut mapping
   ↓
Preview / Export
```

和旧方案相比：

**不再需要给每个 transform-field grid node 做一遍 local regression。**

Transform 是 Layer 级共享参数，空间变化主要来自 Activation Field。

这使第一版更容易实时运行，也更符合用户可见 Layer 模型。

未来如果实验发现单个 Layer 内部仍需要空间变化的 transform 参数，可以添加 `SpatialTransformModel`，但不得破坏 CorrectionLayer 数据模型。

---

# 24. Activation Field 分辨率

Activation analysis 可以在低分辨率完成：

- 256
- 512
- 1024 max dimension 可配置

然后使用：

- bilinear
- joint bilateral
- edge-aware guided upsampling

将 Activation Field 应用到 full-resolution。

Upsampler 同样作为策略接口。

---

# 25. UI

整体采用“编辑器 + 图层面板 + 算法检查器”的结构。

## 25.1 Main Canvas

支持：

- image import
- zoom / pan
- before/after
- split view
- constraint markers
- Activation Field heatmap overlay
- difference view

## 25.2 Correction Layer Panel

类似 adjustment layers：

```text
[eye] Warm Light Correction
      Strength  80%
      [Activation thumbnail]

      Constraints
      ● White wall    warm → neutral
      ● Red cup       current → corrected
      ● Plant         current → corrected

[eye] Blue Bias
      Strength 55%
      [Activation thumbnail]
```

操作：

- 新建 Layer；
- 点击图片添加 constraint 到当前 Layer；
- 默认也允许“一次点击 = 新 Layer”模式；
- 改名；
- 开关；
- 调强度；
- 删除；
- duplicate；
- 查看 Activation；
- 编辑 target；
- “当前颜色正确”；
- include/exclude activation hint。

## 25.3 Activation Inspector

显示：

- 当前 Layer Activation Field
- 每个 constraint 的 Seed Field
- aggregated field
- feature-distance breakdown
- include/exclude hints

参数：

- color weight
- spatial weight
- context weight
- edge weight
- scale
- sharpness
- aggregator

## 25.4 Transform Inspector

显示：

- transform type
- constraints used
- residual magnitude
- condition/stability
- coefficient visualization
- model complexity
- regularization

允许切换：

- constant
- affine
- root-polynomial
- adaptive

---

# 26. Compare Mode

必须是一等功能。

同一张图、同一组 Layer / constraints 下可以创建多个 Pipeline Variant：

### Activation 比较

- color only
- color + XY
- color + context
- color + context + edge
- different kernels
- different seed aggregators

### Transform 比较

- constant
- affine
- root-polynomial
- adaptive

### Architecture baseline

至少预留比较：

1. **Per-point independent layer**
2. **Shared Correction Layer**
3. **Joint per-pixel regression baseline**

第三项可以后续实现，但接口必须允许加入。

### Compositor 比较

- residual add
- sequential
- normalized mixture

Variant 同步共享用户 constraints，不复制编辑操作。

---

# 27. 关键 Invariants / Tests

必须自动测试：

### Target-independent Activation

只改 target：

\[
Activation\ Field
\]

完全不变。

### Single-constraint reduction

一个 constraint 的 Layer：

\[
LayerActivation=SeedActivation
\]

### Identity constraint

source = target 时 Transform 应接近 identity。

### Layer strength

strength = 0 时该 Layer 无任何影响。

### Disabled layer

enabled = false 时结果与不存在该 Layer 相同。

### Constraint order independence

同一 Layer 内 constraints 顺序不改变 Transform 与 Activation aggregation。

### Layer order independence

在 residual-add compositor 下，Layer 顺序不改变结果。

### Numerical stability

不能出现 NaN / Inf / runaway coefficient。

### Serialization

保存/加载后用户意图完全一致。

### Target edit

修改 target 只重新求 Transform，不重新计算 Activation Seed / Field。

### Source/context change

移动 constraint 位置则应重新采样 source/context，并重新计算 Activation。

---

# 28. 第一版真正需要实现的算法

不是 placeholder，而是可工作的最小完整算法：

## Feature
- linear sRGB
- OKLab
- XY
- 3-scale mean / variance
- luminance/chroma gradient

## Activation
- Gaussian feature-distance model
- per-constraint Seed Field
- probabilistic-OR aggregator
- optional smoothmax
- include/exclude hints
- field heatmap

## Transform
- constant residual
- affine residual
- centered root-polynomial residual
- adaptive mode
- weighted ridge / Cholesky

## Composition
- residual-add
- sequential
- normalized mixture（可作为实验实现）

## Rendering
- WebGL2
- low-resolution Activation texture
- bilinear + joint-bilateral upsampling
- gamut compression

---

# 29. 当前仍未确定、但必须配置化的参数

这些不是开工阻塞项：

- feature 各项权重；
- context scale；
- edge metric；
- Activation kernel；
- Activation aggregator；
- hint 传播方式；
- identity / background prior；
- transform regularization；
- adaptive model threshold；
- activation texture resolution；
- upsampling 参数；
- compositor 默认策略；
- gamut compression curve；
- creative extreme-transform limiter。

这些都应该由 Compare Mode 和实验来确定。

---

# 30. 研究定位上的谨慎结论

Correction Layer / Activation Field 的可见图层式结构本身不能直接宣称新颖：

- sparse strokes / points；
- propagation；
- local transform；
- soft applicability；
- spatially varying correction

都有大量先例。

当前真正值得实验验证的研究命题是：

1. 能否从少量单图 source→target constraints 可靠估计**transform-regime Activation Field**；
2. 这种 field 是否能比普通 RGB/XY/appearance affinity 更少跨错误 context 传播；
3. 一个 Layer 内多个颜色 constraints 共同拟合共享 Transform，是否能显著改善 mixed illumination / ISP color bias；
4. evidence-adaptive Transform 是否在少量 constraints 下更稳定；
5. 用户可见的 Activation Field + 轻量 hints 是否能减少传统 mask/lasso 成本。

---

# 31. 最终冻结的核心定义

\[
\boxed{
\text{Photo Color Correction}
=
\sum
\text{Correction Layers}
}
\]

每个 Layer：

\[
\boxed{
\text{Constraints}
\rightarrow
\begin{cases}
\text{Activation Seeds}
\rightarrow
\text{Activation Field}
\\
\text{Shared Transform}
\end{cases}
}
\]

最终：

\[
\boxed{
C'(p)
=
Compositor
\left(
C(p),
\{
A_l(p),T_l,strength_l
\}
\right)
}
\]

其中：

- **Activation 决定哪里、多少；**
- **Transform 决定怎么变；**
- **Constraints 是用户意图；**
- **Correction Layer 是用户可见的一等对象。**

后续算法优化必须围绕这些接口进行，而不是推翻这一数据模型。
