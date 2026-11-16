# Video Studio 案例库测试第 8 批实测记录（Round 8）——三个根缺口关闭

- **日期**：2026-11-16
- **代码基线**：起点 HEAD `66fc19c`（round-6 补录）/ round7 之后；本轮含迁移 1011、字体子集、reconciler 三大落地
- **对照文档**：[round7 记录](./delivery-audit-video-studio-round7-2026-11-16.md) §5 第 8 批入口
- **执行方式**：五路并行（资产登记表 / 字体子集 / reconciler+跨月 / 附录 A 回填+错误码提案 / 跨月配额测试）

---

## 0. 本批总判定：三个根缺口全部关闭

| 根缺口 | 结果 |
|---|---|
| F-AUTH-01/F-TRA-01（资产登记+引用+归属授权） | ✅ 迁移 1011 `video_asset` 表 + UploadAsset 登记 + CanAccessKey 三层授权 + 删除联动清扫 + 缓存降级（max-age 31536000→300） |
| F-WKR-01 后半（reconciler） | ✅ river_job↔video_render 对账器（kind 钉死防跨队列误判、released_at CAS 单 winner、跨月按行上固化 period、legacy 行回退创建月；DB 集成验证含控制行与幂等二轮） |
| F-FNT-01（字体子集 + @font-face 内嵌） | ✅ Noto Sans SC VF 子集 217KB/948 码位（OFL 许可、本机 Windows 自带 VF 免下载、**超出方案：一份 VF 覆盖全字重**）；@font-face data URI 投影内嵌 + 预览 CSP 补 `font-src data:`（方案文档没提的必要改动） |

附加：跨月配额时钟推进测试（quota 层纯单元 5 + DB 集成 1，SQL 参数对照直接证明显式 period 修复跨月错账）；附录 A.1 二十行全回填（三处 ⛔→✅）；§8.5a 错误码定值提案（两方案利弊，待拍板）。

---

## 1. 资产登记表（批8-1）

授权矩阵变化（全部 DB 集成验证）：

| 调用方 | key | 前 | 后 |
|---|---|---|---|
| 工作区成员 | 未登记素材 key | 200（洞） | **404** |
| 工作区成员 | 其他项目素材 | 200（洞） | **404** |
| 工作区成员 | 已删项目产物 | 200（孤儿永久可读） | **404**（CASCADE+清扫） |
| 全部 200 缓存 | — | immutable 一年 | **private, max-age=300** |

实现要点：UploadAsset 在 Store.Put 后插登记行（ON CONFLICT 幂等）；CanAccessKey fail-closed；删除顺序 = 收集 key → 删行 → DeleteMulti（失败仅 warn）。**集成测试抓出第一版 defer 位置 bug 一次**（同 round3 模式）。报告备注：S3 后端 sha256 落空串（Presign 语义）可后续自算；ListAssets 未暴露 REST 路由（boundary clause 已声明）。

## 2. 字体子集（批8-2）

- 来源：Windows 自带 `NotoSansSC-VF.ttf`（SIL OFL 1.1，name 表实读确认）——**可变字体一份覆盖 400-900 全字重**（超出 M3 文档的三档静态方案）
- 948 码位子集（九案 IR 并集 + 禁则表全量 + 安全余量）→ **217KB woff2**（工具 `tools/fontsubset.py`，FONTS-README 记录来源/许可/再生成）
- 接入：@font-face data URI 内嵌（零网络不变量）+ CSS 链首 + **预览 CSP 补 `font-src data:`**（方案文档没提的必要改动——default-src 'none' 会拦 data: 字体）
- **像素级证明**：fontload 探针实测 `FontFace loaded`、`fonts.check(400/700)=true`——字体真加载而非碰巧命中系统字体
- C08 复跑 PASS；14 帧 golden 字节级未变（本机恰好装有同源 Noto——收益在没有 Noto 的机器与 M3 镜像上兑现）
- golden 策略维持 round7 定稿：全部九案 golden 在 M3 镜像内一次性整批重生成

## 3. reconciler + 跨月（批8-3 + 批8-5）

- **Reconciler**：JOIN river_job（kind 钉死 'video_render'）→ CAS 置 failed → claim winner 释放（行上 quota_period，legacy 回退创建月）→ 审计+WS；三层幂等；`CAPX_RECONCILE_INTERVAL` 可调；DB 集成含控制行（job 仍 running / 跨 kind discarded 保持）与幂等二轮
- **跨月证明**（quota 层 SQL 参数对照）：旧 API `Release(now=11月)` 参数落 "2026-11" → 10 月行永不动；修复 `ReleaseTx(period="2026-10")` → 10 月行 3→0（GREATEST 钳 0）。单元 5 + 集成 1（四阶段）全绿；quota 包 48 PASS 三连跑
- 批8-2/8-3 协作注记：批8-2 顺手修复了批8-1 留下的两处编译错误（并行批次间互相兜底的工作区现实）

## 4. 文档（批8-4）

- 附录 A.1：20 行全部回填（三处 ⛔→✅ + words[].source 升格 ✅；words[].id/tracks/assets/render 等 grep 复核后维持 ⛔ 并补行号；assets[] 标 in-flight round8）
- §8.5 十条新状态：**解决 2**（禁则字符集/sha256）/ **提案 1**（错误码族 → §8.5a）/ 维持 7
- §8.5a 新节：错误码两方案利弊（复用 E_NOT_CONFIGURED vs 新码 502；悬空 src 走写时校验 vs E_VIDEO_ASSET_NOT_FOUND）——**提案待架构侧拍板，拍板前相关故障用例维持人工核验**

---

## 5. 全量门禁（本轮收口实测）

```
go build/vet ./... (root + example 两模式)        全绿
go test ./platform/capx ./quota ./internal/arch    ok（9.6s/0.15s/3.8s）
go test ./internal/video/... ./cmd/app/            6 包全 ok
go test ./internal/video/testdata/（默认+capx）    431.9s / 479.1s 全 ok（0 SKIP）
check_api 172:172 零漂移                           OK
docs language guard                                OK: 33 docs
资产登记 DB 集成 2 测试                             PASS
reconciler DB 集成 1 测试                           PASS
跨月配额集成 1 测试                                 PASS（四阶段）
```

---

## 6. 产物清单

```
example/cmd/app/migrations/1011_video_asset.{up,down}.sql
example/cmd/app/main.go                     # reconciler 注册
example/internal/video/app/service.go       # 登记/CanAccessKey/删除清扫（+236 行）
example/internal/video/adapters/http/routes.go  # 三层授权 + 缓存降级
example/internal/video/render/reconciler.go + reconciler_test.go
example/internal/video/app/assets/fonts/    # notosanssc-vf-subset.woff2 + chars.txt + FONTS-README
example/internal/video/app/projector.go     # @font-face 内嵌
example/internal/video/adapters/http/routes.go  # CSP font-src data:
tools/fontsubset.py
quota/release_crossmonth_test.go
docs/plan-agent-video-studio-case-library-...md  # 附录 A 回填 + §8.5a 提案
docs/openapi.yaml                           # files 授权语义 + max-age 300
docs/delivery-audit-video-studio-round8-2026-11-16.md  # 本文档
（各路判定表/报告 JSON 随测试落 testdata/）
```

---

## 7. 第 9 批入口建议

1. **L3 全量九案**：三个根缺口关闭后，§7.9 依赖图中 L3 的阻塞项全部解除——九案全时长成片（10800 帧）可进入；
2. **§8.5a 错误码拍板**（架构侧）后落地实施批；
3. **M3 P0 字体已落地** → P1 镜像（Dockerfile + golden.yml workflow）可开工；
4. **counter 元素级定位的前端消费**（Studio 页右栏 counter 定位可视化）与 ListAssets REST 暴露（批8-1 boundary 声明的小改动）；
5. 29 条人工复核（清单就绪）。
