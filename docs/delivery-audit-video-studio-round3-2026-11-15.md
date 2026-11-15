# Video Studio 案例库测试第 3 批实测记录（Round 3）

- **日期**：2026-11-15
- **代码基线**：起点 HEAD `f1b6cf4`（round-2）；本轮含 soft 字幕实现 + CJK 断行修复
- **对照文档**：案例库 §7.6/§7.8/§5.14 + [round2 实测记录](./delivery-audit-video-studio-round2-2026-11-15.md) §8 第 3 批入口
- **执行方式**：五路并行（soft+降级链 / 词保护禁则 / 锚点口径统一 / counter L2 / L5 一致性）

---

## 0. 本批总判定

| 入口项（round2 §8） | 结果 |
|---|---|
| 1. soft 字幕实现 | ✅ `SoftSubtitles`（mov_text 封装、视频流复制）落地；**soft 断言 fail→pass** |
| 2. ErrNoLibass 降级链 | ✅ burn→soft 自动降级闭环（无 libass 部署机从"渲染必失败"变"软字幕交付"） |
| 3. BuildCues 词保护兜底 | ✅ 超限词按 rune 硬切 + 时间线性插值 + 禁则字符集；**5/5 实证样本全部转绿** |
| 4. 锚点口径统一 | ✅ 裁定条款写入 §7.0（词锚为唯一时钟）；三案帧表回填（27 行中 19 行有差异，最大 ±111 帧）；三条校准锚点全部复现 |
| 5. L2 counter 回归 | ✅ 数字滚动首次在编码产物验证：t=1s 帧 "12478 件" 与缓动公式**精确吻合**、终值定格无漂移、params.color 色度偏差 ≤2 |
| 6. race 环境 | ❌ 未动（msys2，环境项） |

**额外成果**：PNG 压缩比实测回填（§7.8 原估算高估 20-25 倍，已修正）；worker 状态机语义查证（成功行 error 列可携带非致命注记，无需迁移）。

---

## 1. soft 字幕 + 降级链（新能力落地）

- **capx `SoftSubtitles`**：ffmpeg `-c:v copy -c:s mov_text` 封装（视频不重编码），ffprobe 实证产物含 `h264,video` + `mov_text,subtitle` 双流
- **管线 `finishSubtitles` 三态**：soft 成功 / burn 成功 / burn→soft 降级（ErrNoLibass 时，注记 `"subtitle degraded: burn→soft (no libass)"`）→ 都失败才 fail
- **worker 状态机查证**：`succeeded` 判定只看 status（守卫 UPDATE），非空 error 不影响成功态；前端只在 failed/interrupted 行渲染 error——降级注记写成功行 error 列**无需迁移、无需改状态机**
- **harness bug 顺带修复**：测试抓出第一版"输出文件在 Store.Put 前被删"（删除 defer 位置错）——测试保护了实现
- 旧 `buildNoLibassStub` 是纯打印 stub（产空文件），改 pass-through stub（`-filters` 假装无 libass、其余转发真 ffmpeg）
- 复测：soft e2e fail→pass；burn/none 不回归；`TestFinishSubtitles_*` 5/5

## 2. CJK 断行修复（5/5 实证样本转绿）

修复三件套：`expandUnits`（超限词 ≤16 rune 均匀硬切 + 时间线性插值铺满原区间）→ `layoutUnits`（换行点只在词边界，禁则残余>居中>靠前评分）→ `kinsokuShift`（行首标点拉回上一行容差 +2、行尾开括号推下）。

| 实证样本 | 修复前 | 修复后 |
|---|---|---|
| "十五杯" | 切成 十\|五杯 | `防水杯身一次冲净快 / 十五杯奶泡多不用擦也干净`（词完整） |
| 行首"，" | 第二行以逗号开头 | 逗号拉回上一行尾 |
| 46 rune 单词 | 双行各 23 rune 双双超限 | 16\|15 硬切 + 时间 0→3.976→5.9 精确铺满 |
| E2E "怎么做" | 怎么\|做 | 词完整 |

禁则字符集成为常量（行首禁则 `，。、；：！？」』）】〉》"'.,!?;:)]`；行尾 `「『（【〈《'"([{`）；容差边界测试覆盖（≥4 连标点 16-rune 硬上限胜出、全标点句合单行）；既有合法输出零改变（TestSRT_Basic / BuildCues_Limits 等原样通过）。app 包 43 测试全绿。

## 3. 锚点口径统一（M2 前置闭环）

裁定条款写入 §7.0：**词锚 `frame = ceil(word.start × fps)` 是全案例库唯一时钟**（JS Math.ceil 同源）；startFrame 只有 IR 扩展落地后才能做第一时钟；词锚 miss 现状（动画落 0 帧 / effect skip）照实标注不判 fail。

三案回填：C01 10 行中 5 差异（最大 +38）；C04 10 行中 7（最大 **±111**：216→327、720→609）；C06 10 行中 7（2025→**2130** +105，二选一标注收口为定稿：词锚胜出，回 2025 的正路是改词表）。

三条校准锚点全部复现：C04 三柱全可见 F327（末柱锚 F303+24）✓、C06 切换 F230（探针 onset 232 为采样步长解释）✓、C06 结论句 F2130 ✓。推导逐条 Python+Node 双重复核（含 229.999…→230 浮点边界）。

## 4. counter L2 编码验证（D-01 闭环最后一环）

数字滚动**首次在编码产物中验证**：抽帧解码（MP4 层证据，非渲染侧截屏）——t=1s 帧 "12478 件" 与 power1.out 公式计算值**精确吻合**；滚动像素差 5274px（>300 阈值）；终值定格 147 次连续 seek 漂移仅 8px（编码噪声）；params.color 色度偏差 ≤2（H.264 色度抽样下）；缩略图提取 1080×1920 jpg 正常。**D-01 三层修复在 still 层（L1）与编码层（L2）双双闭环。**

## 5. L5 一致性：100× 全等（确定性最终验证）

**100 次独立渲染 × 30 帧 = 3000 帧，逐帧 SHA-256 与第 1 组全部相等**（7m24s，未触发降级）。这是 capx 层确定性的最终验证——D-01 的 pause 双参改动未破坏确定性。

**性能基线回填**：稳态单帧 median **103ms** / p95 124ms（落在文档估算带 50-150ms 内）；每轮首帧含 warmup 开销（max 2.5s）；平均吞吐 6.76 帧/s——全量 L1 一轮 ≈47s（与 l1-report 实测 53.7s 相符）。

**PNG 压缩比实测回填**（§7.8 原估算高估 20-25 倍）：真案例 golden 帧 130-180×（C01 178.3× / C04 132.0× / C06 178.6×）；HD 帧实际 ~35-47KB；L1 golden 90 帧 ≈3-4MB（非 68-182MB）；L3 临时帧 ≈430MB（非 8.2-21.8GB）——**文档 §7.8 已修正存证**。

**运维注意事项（新发现）**：timeout 截断后的残留浏览器进程需 taskkill 才能重启（首个探测跑被截断后紧接一次 0.89s 内 FAIL，清理后全新启动 100× 全等）——不构成缺陷，已记录。

## 6. 全量门禁（本轮收口实测）

```
go build/vet ./... (root)                          PASS
go test ./platform/capx ./internal/arch             ok（17.2s 真实 ffmpeg / 6.2s）
go -C example vet（默认+capx 两模式）                PASS
go test ./internal/video/...                        5 包全 ok
go test -tags capx -run "TestSubtitleL2|TestFinishSubtitles|TestCounterL2"  ok 41.2s
check_api 172:172 零漂移                            OK
docs language guard                                 OK
```

## 7. 产物清单（全部留存）

```
docs/plan-...-case-library-...md          # §7.0 口径条款 + 三案帧表回填 + §7.8 压缩比修正
docs/delivery-audit-video-studio-round3-2026-11-15.md  # 本文档
platform/capx/encode.go                   # SoftSubtitles
example/internal/video/render/render_pipeline.go  # finishSubtitles 三态降级链
example/internal/video/render/worker.go / stub.go # pipeline 接口扩 note
example/internal/video/app/subtitle.go    # expandUnits/layoutUnits/kinsoku
example/internal/video/app/subtitle_kinsoku_test.go  # 9 组新测试
example/internal/video/render/render_pipeline_subtitle_test.go  # 5/5 三态测试
example/internal/video/testdata/
├── counter_l2_test.go / counter-l2-report.json / counter/VS-C01-COUNTER/（产物+抽帧+缩略图）
├── consistency_l5_test.go / consistency-l5-report.json / consistency/digests-100.txt
├── subtitle_l2_test.go（soft 断言更新）/ subtitle-report.json（三模式全 pass 刷新）
└── l0_case_library_test.go（skip 用例转实测断言）
```

## 8. 第 4 批入口建议

1. **L3 端到端**：缺口清单对照（F-WKR-01 reconciler 仍未做）——但 soft/counter/字幕修复后，**L3 的渲染子路径已具备全绿条件**，可先跑真实管道（-tags capx + DB + worker 全链）单案例冒烟；
2. **C04/C06 用修正后帧表重跑 L1 断言**（锚点口径统一后的首次全绿机会）；
3. **counter 元素级定位**（§5.10 缺口：宿主固定原点）——IR 扩展提案 P0 项，M2 前置；
4. **highlight/el_bg 遮挡**（X-4）修复决策：effect 目标层或渲染 z 序；
5. race 环境（msys2 清理）后补 `-race` 车道。
