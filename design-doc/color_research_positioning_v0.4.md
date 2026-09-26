# 稀疏上下文激活颜色校正：研究定位 v0.4

> 日期：2026-09-26  
> 项目主定位仍是照片颜色校正。  
> 本版本根据最终 Correction Layer / Activation Field 架构修订研究表述。

## 1. 当前研究对象

用户在单张照片中建立若干 Correction Layer。

每个 Layer \(l\) 包含：

\[
Q_l=\{(p_k,s_k,t_k)\}
\]

系统从这些稀疏约束得到：

1. 一个连续的、target-independent Activation Field：

\[
A_l(x,y)
\]

2. 一个由该 Layer 内 constraints 共同估计的共享颜色变换：

\[
T_l(c)
\]

最终多个 Layer 组合成照片校正结果。

因此当前方法不再是“所有点一起参与每个像素的 local regression”，而是：

\[
\boxed{
\text{Correction Layer}
=
\text{Activation Field}
+
\text{Shared Transform}
}
\]

---

## 2. 与传统 adjustment layer / mask 的差别

表面上 Correction Layer 很像 adjustment layer：

- 有独立变换；
- 有作用范围；
- 有强度；
- 可以开关。

但传统 adjustment layer 的作用范围主要来自：

- 人工 mask；
- range selection；
- luminance/color keys；
- segmentation。

这里的核心目标是：

> 从少量 source/context constraints 自动推断一个连续、上下文相关的 Activation Field。

Activation Field 可以显示成 mask 风格 heatmap，但它的数学语义不是二值区域，而是：

\[
P(\text{same transform regime}\mid I)
\]

用户只在需要时用 include/exclude hints 修正，而不是承担精确绘制区域的主要工作。

这个方向与历史上的 point/stroke propagation 有明显前例，因此“自动软 mask”本身不能单独作为 novelty。

---

## 3. 与 Edit Propagation 的差别

传统 edit propagation 常以：

> similar appearance + spatial proximity → similar edit

为基本假设。

当前架构更明确地区分：

### Activation

判断：

> 当前 Correction Layer 所代表的 transform regime 在这里是否成立？

### Transform

判断：

> 这个 regime 下颜色应该怎样变？

因此我们希望处理两类普通 appearance affinity 容易失败的情况：

- 同色但不同光照/失真 → Activation 低；
- 不同颜色但同一光照/失真 → Activation 高。

真正的研究价值必须通过这些 case 的实验体现，而不是仅靠结构命名。

---

## 4. 与 User-Controllable Color Transfer 2010 的关系

这是非常接近的前驱。

已有工作已经使用用户 strokes 建立局部 nonlinear transfer model，并把 transfer model 参数传播到空间接近、外观相似的位置。

当前方案可能不同的点：

1. 单图 absolute source→target calibration，而不是 source/reference paired strokes；
2. 用户可见的 Correction Layer / Activation Field 是持续可编辑对象；
3. 一个 Layer 可以积累多个不同颜色 constraints，共同估计同一个 transform regime；
4. Activation 的目标是 transform-regime applicability，而不只 similar appearance；
5. Transform 自由度按 layer 内 evidence 自适应；
6. correction 是主任务，而 creative grading 只是自然扩展。

这些必须通过 baseline 实验验证，不能仅靠概念区分宣称 novelty。

---

## 5. 与 Mixed-Light White Balance 2012 的关系

相关工作已经让用户：

- 标记 neutral color；
- 标记 same-color regions；
- 标记当前颜色正确的区域；

然后插值得到 spatially varying white balance。

因此：

> “用户知道局部正确颜色 + 自动恢复混合光照”

不是新问题。

本项目更一般：

\[
T_l(c)
\]

不被限制成 illuminant gain / white-balance model。

它可以描述：

- mixed illumination；
- ISP color bias；
- nonlinear post-processing error；
- 不同颜色响应不同；
- 一定程度的创意 target。

Correction Layer 还能把不同 transform regime 明确拆成用户可见层。

---

## 6. 与 PMLS / sparse correspondence mapping 的关系

PMLS 已经支持：

- scattered source→target correspondences；
- nonlinear color mapping；
- spatially varying mapping；
- one-to-many correspondence。

因此如果我们的最终方法只是：

\[
RGB+XY+context
\rightarrow weight
\rightarrow MLS
\]

研究差异很弱。

当前架构改为：

> 每个 Correction Layer 的 Activation 与 Transform 是两个可独立观察、独立编辑和独立比较的对象。

同时同一 Layer 的多颜色 constraints 用于估计一个共享 transform，而不是在每个像素处将全局所有 constraint 混为一个 regression problem。

这带来更强的用户可解释性，但是否在恢复质量上更好，需要实验。

---

## 7. 与 HDRNet / spatial-aware LUT / context-aware enhancement 的关系

这些方法已经证明：

- context-dependent local transforms；
- soft spatial weights；
- low-resolution prediction + high-resolution application；

都是成熟方向。

当前系统的主要不同数据来源是：

\[
\text{current-image sparse user constraints}
\]

而不是：

\[
\text{offline training prior}
\]

用户显式定义 source→target 事实，系统估计这些事实的作用域。

因此它更接近交互式 inverse problem，而不是自动 enhancement。

---

## 8. Correction Layer 模型带来的产品优势

与“每像素联合 regression”相比，Layer 架构有明确优势：

- Activation Field 可以直接显示；
- 每条 correction 可开关；
- 每条 correction 有独立 strength；
- target 微调不会改变 Activation；
- 用户可以只修 Activation 或只修 Transform；
- 多个 constraint 可以共同改善同一 transform；
- 可以保存、复制和比较 correction；
- Creative grading 可以作为同一 Layer 的 target 扩展，而不改变作用范围。

这些是很强的系统/交互优势，但其中很多具有历史相邻工作，不应自动等同于算法 novelty。

---

## 9. Creative Grading 的正确定位

项目不改名、不改主定位。

应表述为：

> 由于 Transform 只依赖 source→target constraints，而 Activation 与 target 解耦，同一 Correction Layer 不仅能表达轻微颜色校正，也允许用户将 target 推向较夸张的风格化颜色。这是底层表示的自然通用性，也是产品上的重要优势。

不要表述为：

> 项目从颜色校正转型为通用 creative color editing。

研究 benchmark 仍优先做 correction，因为它有 ground truth 和客观指标。

Creative grading 更适合放在：

- qualitative examples；
- user study；
- system capability section。

---

## 10. 当前最值得验证的研究假设

### H1 — Transform-regime Activation

在相同用户输入数量下，context-aware Activation 是否比：

- RGB only
- RGB+XY
- appearance affinity
- edge-aware affinity

更准确地恢复 correction applicability？

### H2 — Shared Layer Transform

多个不同颜色 constraints 属于同一 correction regime 时，共同估计共享 Transform 是否比：

- per-point independent transform
- fixed global WB
- simple per-color offset

更稳定？

### H3 — Evidence-adaptive capacity

constraint 很少时限制 Transform 自由度，是否比固定 affine / nonlinear model 更少 artifact？

### H4 — User-visible Activation

自动 field + 少量 include/exclude hints，是否能比：

- manual mask
- lasso
- brush

用更低交互成本达到同等质量？

### H5 — Composition

多个 correction regime 重叠时：

- residual add
- sequential
- normalized mixture

哪一种最稳定、最符合用户预期？

---

## 11. 论文贡献只能在实验成立后这样表述

潜在贡献可以组织为：

1. 一种面向单张照片 sparse source→target calibration 的 Correction Layer 表示；
2. target-independent、面向 transform-regime 的 Activation Field；
3. 同一 correction regime 下多颜色约束共同估计的 evidence-adaptive Transform；
4. 无需精确 mask 的可视化、可修正 Activation workflow；
5. 实时浏览器研究原型。

其中 1–4 都必须通过与相关工作和 baseline 的结果差异证明，不应预先宣称“首次”。

---

## 12. 需要长期保留的 baseline

### Architecture

- per-point independent Activation+Transform
- shared Correction Layer
- joint per-pixel regression

### Activation

- spatial only
- color only
- RGB/OKLab + XY
- context
- context + edge

### Transform

- constant
- affine
- root-polynomial
- adaptive

### Composition

- residual add
- sequential
- normalized mixture

这些 baseline 不只是论文实验，也应该直接进入原型 Compare Mode。

---

## 13. 当前最准确的一句话定位

> **一个从单张照片的稀疏用户颜色约束中，自动估计可视化上下文作用场，并在每个 correction regime 内恢复共享颜色变换的交互式照片颜色校正系统。**

Creative grading 是这个表示的自然扩展优势，但 correction 仍是系统和研究主线。
