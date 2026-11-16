# Video Studio 案例库测试第 7 批实测记录（Round 7）——收口固化批

- **日期**：2026-11-16
- **代码基线**：起点 HEAD `66fc19c`（round-6 补录）；本轮零业务代码改动（纯测试/文档/产物）
- **对照文档**：[round6 实测记录](./delivery-audit-video-studio-round6-2026-11-16.md) §6 第 7 批入口
- **执行方式**：五路并行（窗口口径统一 / 人验清单成册 / M3 镜像调研 / L3 CI 化补强 / 案例库终检）——批7-1 中途超时，主会话接手完成核心校准（25 条）

---

## 0. 本批总判定

| 入口项（round6 §6） | 结果 |
|---|---|
| 1. C03/C05 报告补齐 | ✅（批6a agent 恢复后补齐——三案全绿 26ok/10mm/0fail，见 round6 §0.1 补录） |
| 2. C02 断言校准 | ⏸ 断言校准归入人工复核清单（画面经实拍确认健康，区域/颜色校准为机械工作） |
| 3. **M2 宣告前置全部就绪**：窗口口径统一（25 条校准+报告）✓、人工验收清单成册（42 条，101 处产物路径 0 missing）✓ | |
| 4. M3 起步：固定渲染镜像方案 | ✅ 调研文档落地（推荐混合档+字体 @font-face 先行+Windows 基线降 B） |
| 5. L3 CI 化前置 | ✅ 断言补强（9 处）+ 真跑两连绿 + CI 前置清单成册 |
| 6. race 环境 | ❌ 未动（环境项） |

---

## 1. 各路成果

### 1.1 窗口口径统一（批7-1，主会话接手收尾）

- 九案 frames.json 中**恰等于裸 startFrame 值的帧号 +1**（round6 §0.1 边界规则 [startFrame+1, endFrame]）：c02 6 / c03 3 / c05 3 / c07 3 / c08 6 / c09 4 = **25 条校准**；c04/c06 零调整（关键帧为词锚推导或已重审定）
- 词锚推导帧号（ceil(word.start×fps)）一律不动（口径条款：词锚是第一时钟）
- 每条改动帧加 `"window_adjusted": true` 标注；校准报告 `testdata/ir/window-calibration-report.json`
- 案例库 10 条 mismatch（批6a）中窗口差 1 类的收口判定依据就绪

### 1.2 人工验收清单成册（批7-2）

`example/internal/video/testdata/MANUAL-ACCEPTANCE.md`：**42 条**（九案组织；✅ 像素断言覆盖 5 条预勾、◐ 机制层已验 9 条、☐ 真人必验 28 条），每条带帧级/秒级操作指引；**101 处产物路径核对 0 missing**。关键状态更新：六案 L1 报告已于 2026-11-16 落盘（晚于 m2-verdict 的 pending 判定，据实更新）；C07/C08/C09 的 L1 样本多数未落机器判定（走读为主）；C09 F370 菜单灰度疑点列为必看项。

### 1.3 M3 固定镜像方案（批7-3）

`docs/plan-video-studio-m3-image-2026-11-16.md`：**推荐混合档**——日常 CI 走现有 runner 快车道（verify.yml 不改），golden 生成/复验专用 workflow 走固定镜像（ghcr 按 digest）。关键发现：九案 golden 实际出生浏览器是 **Edge 157.0.8103.51**（探测序第 4 胜出）+ ffmpeg 2024-11 nightly——零版本固化；**字体是唯一不改代码补不上的洞**（仓库零 vendored 中文字体）。关键取舍：字体接入点推荐 **@font-face 投影侧内嵌**（三环境同字节 + fonts.ready 门真实语义 + 不破坏零网络不变量）；**Windows 基线降 B、镜像基线另起**（@font-face 落地后像素必变，先重生成=白做；顺序=字体子集→镜像→镜像内重生成）；Chromium 用 Chrome for Testing、ffmpeg 退役 nightly 用 release static。分阶段 P0 字体→P1 镜像→P2 镜像内 L5 复证→P3 golden 迁移→P4 CI 收口，~4 人日。

### 1.4 L3 CI 化补强（批7-4）

- **断言补强 9 处**：ftyp major brand 家族校验+≥4KB 下限、Content-Range 精确等式+206 body 逐字节一致、quota_consume_idem 恰 1 行+submission_key 唯一行、quota_period 精确等式（错格式=补偿静默零行）、审计逐 action 断言（防 created×2/completed=0 假绿）+resource_type、**新增状态机完整性断言**（DB frames 与 API 交叉一致+succeeded 行 finished_at 非空）
- **关键发现**：`go test ./...` **不扫 testdata 目录**（go list 跳过）——L3 从未在 CI 编译运行过；且三前提缺失时是 **SKIP 不是 FAIL**（CI 只配 DB 不装 Chrome 会假绿）。前置清单：`testdata/L3-CI-PREREQUISITES.md`（9 项+最小 workflow 片段）
- 真跑两连绿（28.67s/28.49s，断言补强后）；冷 DB 注意项已记录

### 1.5 案例库全量对齐终检（批7-5）

45 处 `[修正 2026-11-16 round6]` 标注（+171/−33 行，原文划线存证）：
- §1 基线 4 处（新字段/差异矩阵/字幕缺陷 7 条中 3 条关闭）
- 九案"当前可实现性小结"全部补 round6 更新框
- §5 技术专题 6 处（T-09/T-10/T-12/T-14/T-15/P0 清单状态）
- **§8.9 新节：15 项两列定稿判定表**——双格变 3（T-09 ⚠️/⛔→✅/✅、T-10 ⚠️/⛔→✅/✅、T-14 ⚠️/⚠️→✅/✅）、单格变 1（T-12 结构 ✅）、无格变 11；**两列双 ✅ 从 0 → 3 项**
- 待人工裁定 4 项（schemaVersion fail-closed 半边/T-12 视觉粒度/T-15 挂账/错误码族）

---

## 2. 全量门禁（本轮收口实测）

```
go vet -tags capx ./internal/video/testdata/     PASS
go test ./internal/video/testdata/ -count=1       ok 406.5s（含批6a/6b 全量渲染复跑 + L3Smoke 补强后）
go test -tags capx TestL3Smoke                    两连绿（28.67s/28.49s）
check_api 172:172 零漂移                          OK（批7-5 复跑）
docs language guard                               OK: 33 docs
默认构建（无 tag）go test ./internal/video/...      6 包全绿（批7-4 绿证）
```

---

## 3. 产物清单（本轮新增）

```
docs/plan-video-studio-m3-image-2026-11-16.md           # M3 镜像方案调研
docs/plan-agent-video-studio-case-library-...md          # 45 处 round6 修正 + §8.9 定稿表
docs/delivery-audit-video-studio-round7-2026-11-16.md   # 本文档
example/internal/video/testdata/MANUAL-ACCEPTANCE.md    # 42 条人工验收清单
example/internal/video/testdata/L3-CI-PREREQUISITES.md  # L3 进 CI 前置清单
example/internal/video/testdata/l3_smoke_test.go        # 断言补强 9 处
example/internal/video/testdata/ir/*.frames.json ×8     # 25 条窗口帧号校准
example/internal/video/testdata/ir/window-calibration-report.json
```

---

## 4. M2/M3 状态收口

**M2**：渲染验证层达成（九案 L1/L2 双全绿 0 fail）。完全收口余项 = ① 窗口口径已统一（本批）② 29 条人工复核（清单已成册，等真人）③ C02 断言校准（机械工作）。
**M3 起步条件已明确**：字体子集（P0）是第一优先——一切基线语义的前提；镜像方案与实施顺序已定稿（M3 文档）。
**L3**：正式化测试断言补强后两连绿，进 CI 的前置清单就绪（决策：是否加渲染 job 归 CI 维护者）。

## 5. 第 8 批入口建议

1. **P0 字体子集落地**（pyftsubset 九案字符集 → woff2 → 投影 @font-face 内嵌）——M3 第一优先且解除 F-FNT-01 缺口；
2. C02 断言校准 + golden_sanity 对 C04/C06 tripwire 的 CI 显式点名（testdata 包不进 ./... 的发现同样适用）；
3. 29 条人工复核执行（清单已可勾选）；
4. 错误码族四项定值（§8.5 未决项）；
5. race 环境（msys2 清理）后补 `-race` 车道。
