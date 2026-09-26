# 稀疏交互式空间颜色校正：深入相关研究调研 v0.3

> 调研日期：2026-09-26  
> 研究对象：Correction Layer + target-independent Activation Field + shared Evidence-adaptive Transformation。  
> 目标：不仅列论文，而是判断每条研究线已经解决了什么、与当前方案重合到什么程度、真正还需要证明什么。

## 1. Executive Summary

更深入检索后，可以明确：当前方案的几乎每个“局部组件”都有成熟前人工作，因此若未来投稿，不能把以下任何单点作为主要 novelty：

- 稀疏 point / scribble 代替 mask；
- RGB/XY/texture/context affinity；
- edge-aware propagation；
- source→target sparse correspondence；
- nonlinear color mapping；
- spatially varying transform；
- context-aware local enhancement；
- low-resolution transform field + full-resolution edge-aware apply。

最接近当前方案的几组工作是：

1. **An & Pellacini 2010, User-Controllable Color Transfer**：局部 nonlinear transfer model + 向空间接近、外观相似区域传播模型参数；这是“Activation + Transform”概念上最危险的前驱之一。
2. **Boyadzhiev et al. 2012, User-guided White Balance for Mixed Lighting Conditions**：用户 sparse guidance、correct-color scribble、spatially varying correction；这是“交互式校色”最接近的前驱。
3. **Hwang et al. 2014/2019, PMLS**：从 sparse RGB correspondences 做 nonlinear/nonparametric 3D mapping，并在 2019 版本加入 spatial constraints 支持 one-to-many mapping 和 spatially varying illumination；这是 Transformation 最直接的技术邻居。
4. **AppProp / DeepProp / texture-aware EP**：说明“颜色、空间、纹理甚至 learned features 决定传播权重”已有成熟谱系。
5. **HDRNet / spatial-aware LUT / BPAM / INRetouch**：说明“context-dependent local transform”已经是成熟图像增强范式。

因此当前最值得验证的研究命题应该收敛到：

> **在单张照片的稀疏颜色校准问题中，显式估计 calibration observation 与像素是否属于同一 transform regime 的 Activation，并让当前局部 calibration evidence 决定 Transformation 的自由度，是否能比 appearance-based propagation、spatial PMLS、固定局部 transform 更少串色、更少过拟合、并减少用户输入。**

“创意调色”是这个表示的自然扩展优势，但项目的主要 research task 仍是 color correction / calibration。

---


# 1.1 最终 Correction Layer 架构对文献定位的影响

本项目最终不采用“所有 calibration points 在每个像素位置共同参与 local regression”作为唯一核心，而将一个用户可见的 **Correction Layer** 定义为：

\[
\text{Correction Layer}
=
\text{Activation Field}
+
\text{Shared Transform}
\]

一个 Layer 内可以包含多个 source→target constraints。

每个 constraint 先依据原图产生独立 Activation Seed；多个 Seed 再聚合为该 Layer 的共享 Activation Field。Layer 内全部颜色 constraints 共同估计一个共享 Transform。

这种结构带来很强的可解释性：

- Activation 可以直接显示成连续 heatmap；
- Transform 可以独立微调；
- 修改 target 不需要重新计算 Activation；
- 多颜色 constraints 可以共同刻画一个光照/ISP transform；
- 不同 correction regime 可以拆成多个独立 Layer。

但需要特别注意：**“局部 transform + spatial/appearance applicability + 用户 strokes/points”本身已有明确前人工作。**

An & Pellacini 2010 已经在每组 paired strokes 上建立 nonlinear transfer model，并将模型参数传播到空间接近且外观相似的位置。因此 Correction Layer 的表面结构不能单独作为 novelty。

Boyadzhiev et al. 2012 也已经从用户 sparse scribbles 得到 spatially varying white-balance correction，所以“可视化空间变化校正场”也并非新的问题形态。

当前架构真正需要验证的是：

1. **Activation 的目标是否真的能够从 appearance similarity 提升为 transform-regime similarity；**
2. **多个不同颜色 constraint 对同一 Layer 的共享 Transform 是否能有效描述 mixed illumination / ISP bias；**
3. **Layer 模型是否比 per-point independent transform 和 joint per-pixel regression 更容易控制、同时保持或提高恢复质量；**
4. **自动 Activation Field + 少量 include/exclude hints 是否能显著降低传统 mask/lasso 的交互成本。**

因此新的 Compare Mode 应长期保留三种架构 baseline：

```text
A. Per-point independent layer
B. Shared Correction Layer（当前主方案）
C. Joint per-pixel regression
```

这样可以避免在还没有实验结果时过早把某一种架构当成理论最优。


# 2. 文献地图：五条主要谱系

```text
Sparse interaction / edit propagation
  2004 Colorization using Optimization
  2006 Local Tonal Adjustment
  2008 AppProp
  2009 KD-tree EP
  2012 Edge-aware EP
  2015 Texture-aware EP
  2016 DeepProp
  2024 Palette EP
  2025 Point + Lasso Colorization

Local / controllable color transfer
  2001 Reinhard global transfer
  2005 Tai local probabilistic transfer
  2007 Pitié distribution transfer
  2008 Stroke-based multiple local transfer
  2010 User-Controllable Color Transfer
  2012 Sparse correspondence color balancing
  2014/2019 PMLS

Mixed illumination / white balance
  2012 User-guided Mixed WB
  2019 Post-process sRGB WB correction
  2022 MixedWB
  2024 Attentive Illumination Decomposition
  2025 Transformer multi-WB fusion

Content-aware photo adjustment
  2011 MIT-Adobe FiveK
  2016 Automatic Photo Adjustment
  2017 Deep Semantics-Aware Adjustment
  2017 HDRNet
  2020/22 Image-adaptive 3D LUT
  2021 Spatial-aware LUT
  2025 Pixel-adaptive MLP / BPAM
  2026 INRetouch

Color correction basis / mapping
  linear matrix
  polynomial / root-polynomial 2015
  nonlinear scattered correspondence / MLS
  LUT / local MLP
```

---

# 3. Sparse Interaction 与 Edit Propagation

## 3.1 Levin, Lischinski, Weiss — Colorization Using Optimization (SIGGRAPH/TOG 2004)

**来源**：https://doi.org/10.1145/1015706.1015780  
**PDF**：https://people.csail.mit.edu/alevin/papers/colorization-siggraph04.pdf

核心思想：用户只提供少量颜色 scribbles，不做精确 segmentation；基于“空间上相邻且灰度相似的像素应具有相似颜色”的假设，用全局二次优化传播颜色。

对本项目的意义：

- “少量点/笔画 → 自动传播”不是新交互范式；
- “不显式 segment / mask”从 2004 年就已有经典先例；
- 后续任何“point-only 比 mask 更自然”的论述都必须强调我们解决的是**颜色校准对应关系的作用域与 transform inference**，不是首次避免 segmentation。

---

## 3.2 Lischinski et al. — Interactive Local Adjustment of Tonal Values (TOG 2006)

**DOI**：https://doi.org/10.1145/1141911.1141936

用户用粗略 strokes 提供局部亮度/对比度约束，通过 edge-aware 优化传播局部 adjustment，而无需精确 mask。

与当前方案相似：稀疏交互、边缘敏感、局部参数场。

差异：它传播的是 tonal adjustment parameter，而不是 source→target calibration observations 所共同定义的颜色映射。

---

## 3.3 An & Pellacini — AppProp (TOG / SIGGRAPH 2008)

**DOI**：https://doi.org/10.1145/1360612.1360639  
**摘要页**：https://iris.unimo.it/handle/11380/1299615

核心 policy：

> similar edits are applied to spatially-close regions of similar appearance.

AppProp 在高维 appearance-space 中对所有点建立 affinity，用优化把粗糙用户编辑传播到相似区域。

这是 Activation Layer 最直接的经典前驱之一。

### 对当前方案的挑战

若我们的 Activation 最终只是：

\[
A=\exp(-\lambda_cD_{color}-\lambda_sD_{xy}-\lambda_tD_{texture})
\]

然后传播一个 edit residual，那么与 AppProp 的实质差异很弱。

因此需要证明 Activation 不是普通“same appearance” affinity，而更接近：

\[
P(\text{same transform regime}\mid I)
\]

并能处理：

- same color + different illumination → 分开；
- different color + same illumination → 共享部分 transform evidence。

---

## 3.4 Xu et al. — Efficient Affinity-based Edit Propagation using K-D Tree (TOG / SIGGRAPH Asia 2009)

**DOI**：https://doi.org/10.1145/1618452.1618464  
**PDF**：https://cg.cs.tsinghua.edu.cn/papers/SiggraphAsia_2009_editing.pdf

贡献是对 affinity-space 进行 adaptive clustering，使 AppProp 类优化能够在大图像/视频上交互运行。

意义：如果我们最终遇到 Activation map 计算成本问题，高维 feature space 的压缩/聚类已有成熟思路，性能优化本身不太可能成为算法 novelty。

---

## 3.5 Edge-aware Edit Propagation (JCST 2012)

**DOI**：https://doi.org/10.1007/s11390-012-1267-3

用 edge-aware filtering 替代昂贵全局求解传播 sparse edits。

意义：Activation/transform field 的边缘保护可借鉴 guided/bilateral 类方法，但“edge-aware propagation”本身已有大量工作。

---

## 3.6 Texture-aware Edit Propagation (2015)

**论文**：Patrikeev & Lewis, *Texture-aware edit propagation using nonparametric regression*.  
**DOI**：https://doi.org/10.1109/IVCNZ.2015.7761537

研究明确指出：基于颜色相似度的 edit propagation 会同时修改颜色相近但纹理不同的物体，因此加入 texture feature。

意义：不能把“加入纹理/上下文避免串色”作为独立 novelty；我们的 context 必须进一步针对 **transform regime / illumination regime**。

---

## 3.7 DeepProp — Endo et al. (Computer Graphics Forum 2016)

**DOI**：https://doi.org/10.1111/cgf.12822  
**项目页**：https://iizuka.cs.tsukuba.ac.jp/projects/deepprop/deepprop_eng.html

DeepProp 直接从当前单张图片和用户 strokes 学习适合该编辑任务的 visual/spatial feature representation，而不是手调 RGB、位置、纹理权重。

### 重要警告

“learned context features for edit propagation”也不是空白。若我们以后把 Activation 换成神经 embedding，必须解释训练/学习目标为什么针对 color-distortion regime，而不是普通 edit label propagation。

---

## 3.8 Edit Propagation via Color Palettes — Xia et al. (Computers & Graphics 2024)

**DOI**：https://doi.org/10.1016/j.cag.2024.01.002

将图像表示为 palette color 混合，优化 palette 来传播 sparse pixel edits，目标是降低计算与用户交互数量。

与本项目差异：palette 表示主要从颜色维度低维化，并没有直接解决同色不同 context 的不同 correction。

---

## 3.9 Point-Based Colorization + Lasso — Lee et al. (AAAI 2025)

**DOI**：https://doi.org/10.1609/aaai.v39i5.32479

论文指出 point hint 本身无法明确区域边界，容易出现 color intermingling / color collapse，因此引入 lasso。实验报告单个 lasso 相当于多个 point hints，并减少操作时间。

### 对我们的关键意义

这是“只用点、不画 mask”路线的直接风险证据。

我们的 Activation 必须用实验回答：

- 是否能在不增加 lasso 的情况下减少 boundary leakage；
- 如果不能，是否需要轻量 negative point / scope hint，而不是坚持纯 point dogma。

---

# 4. Local / User-Controllable Color Transfer

## 4.1 Reinhard et al. — Color Transfer between Images (IEEE CG&A 2001)

**DOI**：https://doi.org/10.1109/38.946629

经典 global statistical color transfer，通过颜色统计把一个参考图的整体色彩特征迁移到另一张图。

意义：奠定“reference-driven global color mapping”，但无法处理空间变化。

---

## 4.2 Tai, Jia, Tang — Local Color Transfer via Probabilistic Segmentation (CVPR 2005)

**DOI**：https://doi.org/10.1109/CVPR.2005.215

用 EM 同时施加 spatial + color smoothness，对图像做软区域分解；一个像素可属于多个区域，通过软 compositing 获得平滑局部 color transfer。

意义：soft region / soft weight 的思想远早于现代 mixture-of-experts；“软 mask 比硬 mask 更自然”不是新点。

---

## 4.3 Pitié, Kokaram, Dahyot — Automated Colour Grading using Colour Distribution Transfer (CVIU 2007)

**DOI**：https://doi.org/10.1016/j.cviu.2006.11.011

迭代地把一个 N 维颜色分布映射到另一个分布，是经典 nonlinear global grading 方法。

意义：创意调色/风格 transfer 已有成熟 global baseline；我们的优势若延伸到创意领域，应来自 context-local interaction，而不是“能非线性改颜色”。

---

## 4.4 Wen et al. — Example-based Multiple Local Color Transfer by Strokes (Computer Graphics Forum 2008)

**DOI**：https://doi.org/10.1111/j.1467-8659.2008.01321.x

用户在 source 与一个或多个 target reference image 上画对应 strokes，还可画 preserve regions；系统用 graph cuts / local transfer function 完成多个区域的局部 color transfer。

相似：局部、多组 correspondence、用户控制。

差异：依赖 reference images 与 stroke-region correspondence；当前项目在单张图片里直接给绝对 target color。

---

## 4.5 An & Pellacini — User-Controllable Color Transfer (Computer Graphics Forum 2010)

**DOI**：https://doi.org/10.1111/j.1467-8659.2009.01595.x

这是本调研中**概念上最接近当前两层设计的工作之一**。

流程：

1. 用户在 original/reference 两张图中画成对 strokes；
2. 每对 stroke 内估计 nonlinear constrained parametric transfer model；
3. 将这些局部 transfer model 的参数传播到 spatially-close regions of similar appearance。

### 与当前方案的高度重合

这实际上已经有：

```text
local transfer model
+
appearance/spatial propagation
```

因此“把作用域与 transform 拆成两个组件”本身不能安全地声称新颖。

### 当前方案仍可能不同的地方

- 不需要 reference image；用户直接提供 source→target absolute calibration；
- primary task 是当前照片的 color correction，而不是跨图 style transfer；
- Activation 目标希望是 same transform/distortion regime，而不是一般 similar appearance；
- Transformation complexity 希望由当前局部 evidence 自适应，而不是每个 stroke pair 预先拟合固定模型；
- source=target 作为自然零偏移 measurement；
- 希望以 point 而非 paired strokes/regions 达到足够稳定作用域。

这些差异必须用实验表现出来，而不仅是术语变化。

---

## 4.6 Oskam et al. — Fast and Stable Color Balancing for Images and Augmented Reality (3DV 2012)

**项目页**：https://studios.disneyresearch.com/2012/10/13/fast-and-stable-color-balancing-for-images-and-augmented-reality/

输入就是一组 sparse desired color correspondences between source and target，利用平滑颜色映射进行全局 color balancing。

意义：

- “少量 source→target colors → continuous color field”已有明确先例；
- 如果忽略空间/context，本项目会退化到这一类问题；
- 因此核心必须体现在 spatial/context-dependent applicability，而非 sparse correspondence 本身。

---

# 5. Moving Least Squares / Nonlinear Color Mapping

## 5.1 Hwang et al. — Color Transfer using PMLS (CVPR 2014)

**PDF**：https://openaccess.thecvf.com/content_cvpr_2014/papers/Hwang_Color_Transfer_Using_2014_CVPR_paper.pdf

使用 Moving Least Squares 从 RGB 对应点恢复 full nonlinear, nonparametric 3D color mapping，并加入概率模型抵抗 mismatch/noise。

这是 Transformation Layer 的直接数学先例。

---

## 5.2 Hwang et al. — PMLS with Spatial Constraints (CVIU 2019)

**DOI**：https://doi.org/10.1016/j.cviu.2018.11.001  
**PDF**：https://joonyoung-cv.github.io/assets/paper/19_cviu_probabilistic_moving.pdf

2019 版本加入 control point 的空间距离，明确为了支持：

- spatially varying illumination；
- local color transfer；
- one-to-many color mapping。

### 这是当前方案最强的技术 baseline 之一

PMLS 已经做到：

\[
\text{sparse correspondences}
+\text{color distance}
+\text{spatial constraints}
\rightarrow
\text{local nonlinear mapping}
\]

如果当前项目最终只是把空间距离换成“context distance”，而 Transformation 仍为普通 MLS，那么贡献会比较有限。

更有价值的方向是验证：

1. 独立的 transform-regime Activation 是否比直接 RGB+XY spatial PMLS 更能处理复杂同色/异色 context；
2. evidence-adaptive model capacity 是否比固定高自由度 MLS 在 sparse points 下更稳定；
3. 单图用户 calibration 交互是否显著减少 correspondence 数量。

---

# 6. Color Correction Basis

## 6.1 Finlayson, Mackiewicz, Hurlbert — Root-Polynomial Regression (TIP 2015)

**DOI**：https://doi.org/10.1109/TIP.2015.2405336

相机 RGB 到标准颜色空间常用 3×3 matrix，但线性模型能力有限；普通 polynomial 增强非线性表达时又容易引入 exposure dependence。Root-polynomial regression 用根多项式项增强表达能力，同时保留更好的曝光缩放性质。

对项目意义：适合作为可解释、低参数的 Transformation basis baseline，但它不是我们的核心创新。

---

# 7. Mixed-Illuminant / White Balance

## 7.1 Boyadzhiev et al. — User-guided White Balance for Mixed Lighting Conditions (TOG / SIGGRAPH Asia 2012)

**DOI**：https://doi.org/10.1145/2366145.2366219  
**项目页**：https://www.cs.cornell.edu/projects/white_balance/

用户可以画：

- neutral-color scribbles；
- same-color scribbles；
- correct-color scribbles。

系统先通过 pixel similarity 和 robust voting 扩展 scribbles，再将 spatially varying WB 写成 sparse interpolation / optimization 问题。

### 高度重合

- sparse user guidance；
- “这里已经正确”的零偏移含义；
- mixed illumination；
- 不需要用户直接估计灯光参数；
- spatially varying correction。

### 当前方案必须超出的地方

- 不局限于 chromaticity / WB gain；
- 能处理 camera/ISP 后处理造成的 nonlinear sRGB color error；
- 更轻的 point source→target calibration；
- context-based activation，而不仅是 scribble expansion；
- 与更一般 local Transformation 联合工作。

---

## 7.2 Afifi et al. — When Color Constancy Goes Wrong (CVPR 2019)

**论文页**：https://openaccess.thecvf.com/content_CVPR_2019/html/Afifi_When_Color_Constancy_Goes_Wrong_Correcting_Improperly_White-Balanced_Images_CVPR_2019_paper.html

关键观察：错误 WB 之后，相机会继续做 camera-specific nonlinear color manipulations，因此 post-processing 中无法简单靠逆 RGB gain 恢复；论文使用大量 incorrect/correct WB image pairs 和 kNN 估计 nonlinear color mapping。

这直接支持本项目早期动机：真实手机成像中的“偏色”不一定能用简单 WB 模型解释。

---

## 7.3 Afifi, Brubaker, Brown — MixedWB (WACV 2022)

**论文页**：https://openaccess.thecvf.com/content/WACV2022/html/Afifi_Auto_White-Balance_Correction_for_Mixed-Illuminant_Scenes_WACV_2022_paper.html

把图像渲染成若干预设 WB 版本，网络预测每个 preset 的 pixel-wise weight map，再融合得到结果。

结构上很像：

```text
transform experts
+
spatial activation weights
```

但其 expert 固定为 WB presets，Activation 来自离线训练；我们从当前图片的用户 calibration 在线推导。

---

## 7.4 Kim et al. — Attentive Illumination Decomposition (CVPR 2024)

**论文页**：https://openaccess.thecvf.com/content/CVPR2024/html/Kim_Attentive_Illumination_Decomposition_Model_for_Multi-Illuminant_White_Balancing_CVPR_2024_paper.html

用 slot attention 表示不同 illuminant，每个 slot 输出 chromaticity 与 weight map，再融合得到 illumination map。

意义：最新 multi-illuminant 研究越来越强调“场景中存在若干潜在 illumination regimes”，与我们将 Activation 解释成 transform-regime probability 很契合；但它是自动 WB，不是用户稀疏 calibration。

---

## 7.5 Serrano-Lozano et al. — Revisiting Image Fusion for Multi-Illuminant WB (ICCV 2025)

**论文页**：https://openaccess.thecvf.com/content/ICCV2025/html/Serrano-Lozano_Revisiting_Image_Fusion_for_Multi-Illuminant_White-Balance_Correction_ICCV_2025_paper.html

指出简单线性 blending 多个 WB preset 对复杂 mixed illumination 不够，使用 Transformer 捕获更强 spatial dependencies，并建立超过 16,000 张图像的 multi-illuminant 数据集。

意义：对 Activation 的空间/context 建模仍有现实研究空间；同时这类数据可用于后续 correction benchmark。

---

# 8. Content/Semantics-Aware Photo Adjustment

## 8.1 MIT-Adobe FiveK — Bychkovsky et al. (CVPR 2011)

**论文**：https://people.csail.mit.edu/vladb/photoadjust/db_imageadjust.pdf  
**DOI**：https://doi.org/10.1109/CVPR.2011.5995413

5,000 张原片，由 5 位摄影师分别 retouch，成为 learned photo enhancement 经典基准。

意义：适合 photo retouching / creative enhancement，但并不提供“真实颜色 ground truth”，因此不能作为本项目 correction 主 benchmark 的唯一依据。

---

## 8.2 Yan et al. — Automatic Photo Adjustment Using Deep Neural Networks (TOG 2016)

**DOI**：https://doi.org/10.1145/2790296

明确提出 photographic style adjustment 会依赖 image content、semantics，并且 spatially varying；使用 local semantic descriptors 学习局部调整。

意义：“context-aware color transform”已经有成熟研究历史，不能把 context 一词本身包装成 novelty。

---

## 8.3 Nam & Kim — Deep Semantics-Aware Photo Adjustment (2017)

**arXiv**：https://arxiv.org/abs/1706.08260

进一步用 deep semantics-aware contextual features 和 adjustment map 建模内容相关局部 retouch。

意义：语义/高层 context 与颜色 transform 交互已有先例；我们的区别必须回到**用户当前 calibration evidence**，而非自动模仿训练风格。

---

# 9. Runtime Representation：Bilateral / LUT / Local Neural Transform

## 9.1 Chen, Paris, Durand — Bilateral Grid (TOG 2007)

**DOI**：https://doi.org/10.1145/1276377.1276506

提供高效 edge-aware 高维网格表示，是后续低分辨率参数场 + 高分辨率 edge-aware slicing 的基础。

本项目可借鉴其 runtime，但 bilateral grid 不是研究核心。

---

## 9.2 Gharbi et al. — HDRNet / Deep Bilateral Learning (SIGGRAPH 2017)

**项目页**：https://research.google/pubs/deep-bilateral-learning-for-real-time-image-enhancement/

低分辨率网络预测 bilateral space 的 local affine coefficients，再通过 guidance slicing edge-aware 地应用到全分辨率图像。

与实现方案高度相似：

```text
low-res analysis
→ transform coefficients
→ edge-aware high-res apply
```

区别：HDRNet 的 transform 来自离线训练 input/output pairs；本项目来自当前图片的 sparse calibration evidence。

---

## 9.3 Zeng et al. — Image-Adaptive 3D LUT (TPAMI 2020/2022)

**DOI**：https://doi.org/10.1109/TPAMI.2020.3026740

低分辨率 CNN 预测多个 basis 3D LUT 的 image-level 权重，得到高效 image-adaptive global LUT。

意义：LUT 是极高效 execution representation，但 global LUT 本身不能解决相同颜色在不同空间位置需要不同结果的问题。

---

## 9.4 Wang et al. — Spatial-Aware 3D LUT (ICCV 2021)

**论文页**：https://openaccess.thecvf.com/content/ICCV2021/html/Wang_Real-Time_Image_Enhancer_via_Learnable_Spatial-Aware_3D_Lookup_Tables_ICCV_2021_paper.html

同时预测 image-level weights 与 pixel-wise spatial fusion map，融合多个 LUT，实现局部空间自适应。

意义：Mixture-of-transform + spatial weights 已经是成熟结构。我们的差异来自 online sparse user evidence，而不是结构本身。

---

## 9.5 Lou et al. — BPAM / Pixel-Adaptive MLP (ICCV 2025)

**论文页**：https://openaccess.thecvf.com/content/ICCV2025/html/Lou_Learning_Pixel-adaptive_Multi-layer_Perceptrons_for_Real-time_Image_Enhancement_ICCV_2025_paper.html

论文直接指出 bilateral-grid local affine transform 表达复杂 nonlinear color relationship 的能力有限，因此把每个位置的 transform 升级为 pixel-adaptive MLP，同时保持实时性能。

意义：如果未来我们的 root-polynomial / affine basis 不够，local nonlinear model 并不是不存在的方向；真正问题是如何用 sparse calibration evidence 稳定地估计它，而不是发明一个更强 local mapper。

---

## 9.6 INRetouch — Elezabi et al. (WACV 2026)

**论文页**：https://openaccess.thecvf.com/content/WACV2026/html/Elezabi_INRetouch_Context_Aware_Implicit_Neural_Representation_for_Photography_Retouching_WACV_2026_paper.html

从单个 before/after reference pair 学习 context-aware implicit transformation，再迁移到新图像；可以复现复杂局部 retouch。

意义：“context-aware implicit nonlinear retouch transform”本身已非常先进。我们的区别仍是：单图当前用户提供**稀疏绝对校准点**，而不是完整 before/after pair。

---

# 10. HCI：Control Point Selective Editing

## Binder et al. — Selective Editing on Touchscreen Devices (SPIE 2013)

**页面**：https://research.google/pubs/design-of-user-interfaces-for-selective-editing-of-digital-photos-on-touchscreen-devices/

论文指出 gradient/lasso/brush 创建 spatially varying mask 麻烦，因此让用户放 control points，并根据空间、亮度、颜色距离插值 filter strength。

### 与我们非常接近的地方

- point control；
- soft influence；
- spatial + luminance + color distance；
- 不显式画 mask。

### 区别

它传播的是已有 filter 的**强度**；我们的 Calibration Point 试图同时提供 source→target correspondence，让局部 Transformation 本身由多个 evidence 推断。

这篇意味着：

> “Activation function 根据颜色和空间决定作用强度”作为 UI/传播思想本身已经非常明确地存在。

所以我们的贡献必须进一步体现 Transformation inference 和 transform-regime context。

---

# 11. 最近邻工作对比表

| 工作 | 用户输入 | 传播/Activation | Transform | 空间变化 | Context | 与当前方案最主要差别 |
|---|---|---|---|---|---|---|
| Levin 2004 | color scribbles | intensity/local adjacency | color hint propagation | ✓ | 低层 | 不是 source→target correction model |
| AppProp 2008 | rough edits | appearance + space | 用户 edit | ✓ | appearance | 不估计 calibration-driven local transform |
| User-Controllable CT 2010 | source/ref paired strokes | similar appearance + space | local nonlinear parametric transfer | ✓ | appearance | 依赖 reference/strokes；固定局部 transfer model |
| Boyadzhiev 2012 | WB scribbles | pixel similarity + interpolation | spatial WB gains | ✓✓ | reflectance cues | 只解决 WB/chromaticity model |
| Oskam 2012 | sparse color correspondences | color-space interpolation | global smooth color balance | ✕/弱 | ✕ | 无 context-dependent spatial transform |
| PMLS 2019 | color correspondences | color + spatial weighting | nonlinear nonparametric MLS | ✓✓ | 空间 | context/illumination regime 不独立建模 |
| Binder 2013 | control points | space + luminance + color | filter strength | ✓ | 低层 | transform 预先给定，不从 correspondence 求解 |
| DeepProp 2016 | strokes | learned single-image features | edit label propagation | ✓ | learned | 学的是 edit features，不是 color calibration regime |
| HDRNet 2017 | 无用户点 | learned guidance | local affine | ✓✓ | learned | 离线训练，不是 online sparse calibration |
| Spatial LUT 2021 | 无用户点 | learned pixel weights | multiple LUTs | ✓✓ | learned | transform/weights 来自训练 |
| MixedWB 2022 | 无用户点 | learned WB blend maps | fixed WB presets | ✓✓ | learned | WB-only, automatic |
| AID 2024 | 无用户点 | illuminant slots + weight maps | WB illuminants | ✓✓ | illumination | WB-only, automatic |
| Lasso colorization 2025 | point + lasso | attention scope | colorization | ✓ | semantic | 需要显式 lasso 控范围 |
| BPAM 2025 | 无用户点 | bilateral guidance | local MLP | ✓✓ | learned | 离线训练，不是 user evidence |
| INRetouch 2026 | full before/after pair | context-aware implicit | nonlinear local retouch | ✓✓ | learned | dense reference pair，不是 sparse calibration |
| **当前方案** | point source→target | **transform-regime Activation** | **evidence-adaptive local transform** | ✓✓ | multi-scale / illumination-oriented | 单图在线稀疏校色；是否更有效需实验验证 |

---

# 12. 当前最可能成立的差异点

## 12.1 单图 absolute calibration，而不是 edit、reference style 或 paired image

用户直接提供：

\[
(position, source, target)
\]

不需要：

- full reference image；
- paired source/reference strokes；
- before/after dense pair；
- illumination 参数；
- 预定义滤镜。

这一点在交互上有清晰差异，但仍需要和 Boyadzhiev 2012 / control-point UI 比用户成本。

## 12.2 Activation 目标是 same transform regime

若真正实现为：

\[
A_i(p)\approx P(z_p=z_i\mid I)
\]

并能跨不同 source colors 共享 transformation evidence，同时分离颜色相似但失真机制不同的区域，这比经典 RGB+XY appearance affinity 更有针对性。

这是目前最值得投入研究的部分。

## 12.3 Transformation capacity 由 local evidence 决定

单点只做保守 residual；多个独立颜色才允许 affine；数据更丰富才开放 nonlinear terms。

这种 **evidence-adaptive capacity** 如果能显著减少 sparse setting 的过拟合/overshoot，会比“用了某个 nonlinear basis”更有价值。

## 12.4 Correction-first，但自然支持夸张 grading

项目主目标保持 correction。额外优势是：因为 target-independent Activation，用户可以把 target 故意移动很远而不改变作用域，从而得到创意效果。

这是产品/系统优势，不建议目前单独包装成主要算法 novelty。

---

# 13. Novelty 风险重新评估

## 高风险：不能单独声称新颖

- point/scribble 取代 mask；
- soft activation field；
- RGB/XY/texture/context affinity；
- local nonlinear transfer model；
- appearance-based propagation of transform parameters；
- spatially varying WB；
- nonlinear post-WB correction；
- context-aware local enhancement；
- local affine/bilateral grid；
- spatial mixture of LUTs；
- point interaction 支持创意 recoloring。

## 中等潜力：需要实证才能成立

- target-independent Activation 作为显式模块 invariant；
- same-transform-regime 而不是 same-appearance 的 Activation objective；
- 跨颜色共享 transform evidence；
- evidence-adaptive Transformation complexity；
- 单图 absolute target calibration 比 reference/stroke/mask 更低交互成本。

## 最值得实验验证的组合命题

> **Context-aware transform-regime Activation + evidence-adaptive local Transformation，能否在固定 calibration-point budget 下，比 RGB/XY propagation、User-Controllable Color Transfer 式 appearance propagation 和 spatial PMLS 更准确恢复 spatially varying nonlinear color errors。**

---

# 14. 建议 Baselines

如果真按论文标准做，baseline 不应只选现代深度模型，而应覆盖最近邻经典方法。

### Edit propagation

- Color+XY Gaussian/RBF baseline；
- AppProp-style affinity baseline；
- edge-aware propagation；
- texture-aware / learned feature propagation（至少思想级复现）。

### Local transfer

- User-Controllable Color Transfer 2010（如无法完整复现，至少实现其 appearance + local-model propagation 近似）；
- PMLS 2014；
- spatial PMLS 2019。

### Mixed WB

- Boyadzhiev 2012（可用作者数据/公开 scribbles）；
- MixedWB 2022；
- AID 2024 / transformer WB 2025 作为自动方法参考。

### Runtime/model capacity

- constant residual；
- local affine；
- fixed nonlinear basis；
- evidence-adaptive basis。

---

# 15. 建议 Benchmark Case

仅测普通照片平均 ΔE 不足以证明 Activation 的价值，应专门构造“反传统 affinity”场景。

### Case A：Same color, different transform regime

两块颜色近似的灰墙，一块受暖光，一块受冷光。

目标：校准左边不能污染右边。

### Case B：Different colors, same transform regime

红/绿/白三个物体在同一偏色灯光下。

目标：不同颜色 calibration points 能共同拟合同一个 local transform。

### Case C：Same object, different illumination

同一长物体横跨窗边与室内灯。

目标：不能因为“同物体”就共享完整 correction。

### Case D：Boundary-near point

Calibration Point 紧靠人物/背景边缘。

目标：测 boundary leakage。

### Case E：Sparse nonlinear ISP distortion

对不同颜色施加非线性映射 + 空间变化。

目标：验证 affine/WB baseline 不够，而 evidence-adaptive nonlinear mapping 有收益。

### Case F：Large target shift（次级创意能力）

把 target 故意大幅移色。

目标：Activation map 保持不变，Transformation 稳定，无明显 folding/gamut artifact。

---

# 16. 用户研究建议

如果最终效果足够稳定，可以比较三种 workflow：

1. Calibration Points（本项目）；
2. mask/brush + conventional color controls；
3. point + optional lasso / scope control。

任务包括：

- mixed-light neutralization；
- 手机偏色恢复；
- 保持肤色同时校正背景；
- 次级：制作暖主体/冷背景的夸张对比。

指标：

- 完成时间；
- 操作次数；
- calibration point / stroke / mask 数；
- correction ΔE（有 ground truth 时）；
- 用户主观控制感与可预测性。

---

# 17. 深入文献后的研究定位

目前最稳妥的表述不是：

> “我们发明了 Activation Layer。”

也不是：

> “第一次用 point 做局部调色。”

而是：

> **我们研究单张照片的稀疏交互式颜色校准：把每个用户 source→target calibration observation 的空间适用性建模为与 target 解耦的 transform-regime Activation，并根据当前局部有效 calibration evidence 自适应估计颜色变换，从而恢复 spatially varying nonlinear color correction field。**

这个定位与经典工作有清楚联系，同时留下可被实验验证的具体差异。

---

# 18. 核心参考文献（按时间）

1. Reinhard, E., Ashikhmin, M., Gooch, B., Shirley, P. **Color Transfer between Images.** IEEE CG&A, 2001. https://doi.org/10.1109/38.946629
2. Levin, A., Lischinski, D., Weiss, Y. **Colorization using Optimization.** ACM TOG, 2004. https://doi.org/10.1145/1015706.1015780
3. Tai, Y.-W., Jia, J., Tang, C.-K. **Local Color Transfer via Probabilistic Segmentation by Expectation-Maximization.** CVPR, 2005. https://doi.org/10.1109/CVPR.2005.215
4. Lischinski, D., Farbman, Z., Uyttendaele, M., Szeliski, R. **Interactive Local Adjustment of Tonal Values.** ACM TOG, 2006. https://doi.org/10.1145/1141911.1141936
5. Pitié, F., Kokaram, A., Dahyot, R. **Automated Colour Grading using Colour Distribution Transfer.** CVIU, 2007. https://doi.org/10.1016/j.cviu.2006.11.011
6. Chen, J., Paris, S., Durand, F. **Real-Time Edge-Aware Image Processing with the Bilateral Grid.** ACM TOG, 2007. https://doi.org/10.1145/1276377.1276506
7. An, X., Pellacini, F. **AppProp: All-Pairs Appearance-Space Edit Propagation.** ACM TOG, 2008. https://doi.org/10.1145/1360612.1360639
8. Wen, C.-L., Hsieh, C.-H., Chen, B.-Y., Ouhyoung, M. **Example-based Multiple Local Color Transfer by Strokes.** Computer Graphics Forum, 2008. https://doi.org/10.1111/j.1467-8659.2008.01321.x
9. Xu, K., Li, Y., Ju, T., Hu, S.-M., Liu, T.-Q. **Efficient Affinity-based Edit Propagation using K-D Tree.** ACM TOG, 2009. https://doi.org/10.1145/1618452.1618464
10. An, X., Pellacini, F. **User-Controllable Color Transfer.** Computer Graphics Forum, 2010. https://doi.org/10.1111/j.1467-8659.2009.01595.x
11. Bychkovsky, V., Paris, S., Chan, E., Durand, F. **Learning Photographic Global Tonal Adjustment with a Database of Input/Output Image Pairs.** CVPR, 2011. https://doi.org/10.1109/CVPR.2011.5995413
12. Boyadzhiev, I., Bala, K., Paris, S., Durand, F. **User-guided White Balance for Mixed Lighting Conditions.** ACM TOG, 2012. https://doi.org/10.1145/2366145.2366219
13. Oskam, T., Sorkine-Hornung, A., Sumner, R. W., Gross, M. **Fast and Stable Color Balancing for Images and Augmented Reality.** 3DV, 2012. https://studios.disneyresearch.com/2012/10/13/fast-and-stable-color-balancing-for-images-and-augmented-reality/
14. Binder, T., Steiding, M., Wille, M., Kokemohr, N. **Design of User Interfaces for Selective Editing of Digital Photos on Touchscreen Devices.** SPIE, 2013. https://research.google/pubs/design-of-user-interfaces-for-selective-editing-of-digital-photos-on-touchscreen-devices/
15. Hwang, Y., Lee, J.-Y., Kweon, I. S., Kim, S. J. **Color Transfer using Probabilistic Moving Least Squares.** CVPR, 2014. https://openaccess.thecvf.com/content_cvpr_2014/papers/Hwang_Color_Transfer_Using_2014_CVPR_paper.pdf
16. Finlayson, G. D., Mackiewicz, M., Hurlbert, A. **Color Correction using Root-Polynomial Regression.** IEEE TIP, 2015. https://doi.org/10.1109/TIP.2015.2405336
17. Patrikeev, E., Lewis, J. **Texture-aware Edit Propagation using Nonparametric Regression.** IVCNZ, 2015. https://doi.org/10.1109/IVCNZ.2015.7761537
18. Yan, Z., Zhang, H., Wang, B., Paris, S., Yu, Y. **Automatic Photo Adjustment Using Deep Neural Networks.** ACM TOG, 2016. https://doi.org/10.1145/2790296
19. Endo, Y., Iizuka, S., Kanamori, Y., Mitani, J. **DeepProp: Extracting Deep Features from a Single Image for Edit Propagation.** Computer Graphics Forum, 2016. https://doi.org/10.1111/cgf.12822
20. Gharbi, M., Chen, J., Barron, J. T., Hasinoff, S. W., Durand, F. **Deep Bilateral Learning for Real-Time Image Enhancement.** ACM TOG, 2017. https://research.google/pubs/deep-bilateral-learning-for-real-time-image-enhancement/
21. Nam, S., Kim, S. J. **Deep Semantics-Aware Photo Adjustment.** 2017. https://arxiv.org/abs/1706.08260
22. Afifi, M., Price, B., Cohen, S., Brown, M. S. **When Color Constancy Goes Wrong: Correcting Improperly White-Balanced Images.** CVPR, 2019. https://openaccess.thecvf.com/content_CVPR_2019/html/Afifi_When_Color_Constancy_Goes_Wrong_Correcting_Improperly_White-Balanced_Images_CVPR_2019_paper.html
23. Hwang, Y., Lee, J.-Y., Kweon, I. S., Kim, S. J. **Probabilistic Moving Least Squares with Spatial Constraints for Nonlinear Color Transfer Between Images.** CVIU, 2019. https://doi.org/10.1016/j.cviu.2018.11.001
24. Zeng, H., Cai, J., Li, L., Cao, Z., Zhang, L. **Learning Image-Adaptive 3D Lookup Tables for High Performance Photo Enhancement in Real-Time.** IEEE TPAMI, 2020/2022. https://doi.org/10.1109/TPAMI.2020.3026740
25. Wang, T. et al. **Real-Time Image Enhancer via Learnable Spatial-Aware 3D Lookup Tables.** ICCV, 2021. https://openaccess.thecvf.com/content/ICCV2021/html/Wang_Real-Time_Image_Enhancer_via_Learnable_Spatial-Aware_3D_Lookup_Tables_ICCV_2021_paper.html
26. Afifi, M., Brubaker, M. A., Brown, M. S. **Auto White-Balance Correction for Mixed-Illuminant Scenes.** WACV, 2022. https://openaccess.thecvf.com/content/WACV2022/html/Afifi_Auto_White-Balance_Correction_for_Mixed-Illuminant_Scenes_WACV_2022_paper.html
27. Xia, Z.-X. et al. **Edit Propagation via Color Palettes.** Computers & Graphics, 2024. https://doi.org/10.1016/j.cag.2024.01.002
28. Kim, D., Kim, J., Yu, J., Kim, S. J. **Attentive Illumination Decomposition Model for Multi-Illuminant White Balancing.** CVPR, 2024. https://openaccess.thecvf.com/content/CVPR2024/html/Kim_Attentive_Illumination_Decomposition_Model_for_Multi-Illuminant_White_Balancing_CVPR_2024_paper.html
29. Lee, S., Yun, J., Choo, J. **Enabling Region-Specific Control via Lassos in Point-Based Colorization.** AAAI, 2025. https://doi.org/10.1609/aaai.v39i5.32479
30. Serrano-Lozano, D. et al. **Revisiting Image Fusion for Multi-Illuminant White-Balance Correction.** ICCV, 2025. https://openaccess.thecvf.com/content/ICCV2025/html/Serrano-Lozano_Revisiting_Image_Fusion_for_Multi-Illuminant_White-Balance_Correction_ICCV_2025_paper.html
31. Lou, J., Zhao, X., Shi, K., Gu, S. **Learning Pixel-adaptive Multi-layer Perceptrons for Real-time Image Enhancement.** ICCV, 2025. https://openaccess.thecvf.com/content/ICCV2025/html/Lou_Learning_Pixel-adaptive_Multi-layer_Perceptrons_for_Real-time_Image_Enhancement_ICCV_2025_paper.html
32. Elezabi, O., Conde, M. V., Wu, Z., Timofte, R. **INRetouch: Context Aware Implicit Neural Representation for Photography Retouching.** WACV, 2026. https://openaccess.thecvf.com/content/WACV2026/html/Elezabi_INRetouch_Context_Aware_Implicit_Neural_Representation_for_Photography_Retouching_WACV_2026_paper.html
