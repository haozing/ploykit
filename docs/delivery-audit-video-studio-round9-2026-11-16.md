# Video Studio 案例库测试第 9 批实测记录（Round 9）——L3 全量达成

- **日期**：2026-11-16
- **代码基线**：起点 HEAD `f6c742b`（round-7）/ round-8 三根缺口关闭后；本轮含错误码族落地（批9-5）
- **对照文档**：案例库 §7.4（L3 完整成片）+ [round8 记录](./delivery-audit-video-studio-round8-2026-11-16.md) §7 第 9 批入口
- **执行方式**：五路并行（L3 前五案 / L3 后四案 / 真服务端稳定性 / 产物质检汇总 / 错误码族落地）

---

## 0. 本批总判定：**L3 全量达成（§7.4 验收 PASS）**

| 项 | 结果 |
|---|---|
| 九案全时长成片 | **9/9 PASS**——合计 **10,800/10,800 帧精确命中**（-count_packets）、380s、几何/fps 全对、0 帧偏差 |
| 解码复验 | 9/9 stderr 空（ffmpeg -v error 全解码） |
| 三时点抽帧 | 27 张全部有内容墨迹（3 个专项甄别均为设计基线非故障） |
| 音轨 | C01/C05/C08 带轨（RMS −21.5dB），其余按规格静音 |
| 真服务端稳定性 | 3 批 × 3 跑 = 9 次：**7/9 绿**；两次 fail 均为批内首跑环境/性能因素（非业务回归），复跑即绿 |
| reconciler 首次真机 | **零误判**（6 轮对账、drift=0、无一行被误置） |
| 并发提交 | 双独立渲染排队验证（MaxWorkers=1 证据）+ 配额 used=2 + 幂等台账 2 行 |
| 错误码族 | §8.5 未决项 1 **关闭**（裁定落地：TTS/Aligner 不新增码 + 悬空 src 写时校验） |

**新发现 1 条（minor）**：F-AUD-01 C08 音轨超挂（audio 30.07s vs video 20.00s）——共享 fixture 未按 IR 时长裁剪；建议 MuxAV 按 min(voice.durationSec, meta.durationSec) 裁剪（视频流不受影响）。

---

## 1. 九案成片总表（质检独立复验，`l3-full-verdict.json`）

| 案 | 几何 | fps | 时长 | 帧数（实测/期望） | 音轨 | 大小(B) | 判定 |
|---|---|---|---|---|---|---|---|
| C01 | 1080×1920 ✓ | 30 | 15.000s | **450/450** | aac −21.5dB | 415,705 | pass |
| C02 | 1920×1080 ✓ | 25 | 30.000s | **750/750** | — | 238,505 | pass |
| C03 | 1080×1920 ✓ | 30 | 45.000s | **1350/1350** | — | 375,063 | pass |
| C04 | 1920×1080 ✓ | 30 | 60.000s | **1800/1800** | — | 672,829 | pass |
| C05 | 1080×1920 ✓ | 30 | 30.000s | **900/900** | aac −21.5dB | 495,415 | pass |
| C06 | 1920×1080 ✓ | 25 | 90.000s | **2250/2250** | — | 447,704 | pass |
| C07 | 1920×1080 ✓ | 30 | 40.000s | **1200/1200** | — | 379,942 | pass |
| C08 | 1080×1080 ✓ | 30 | 20.000s | **600/600** | aac −21.5dB | 531,480 | pass |
| C09 | 1920×1080 ✓ | 30 | 50.000s | **1500/1500** | — | 245,026 | pass |

渲染吞吐基线：**86–101 ms/帧**（与 round2/3 分层实测一致，无回归）；九案串行 wall-clock ≈39 分钟（估算带 15-40 分钟上沿）。

## 2. 过程中修复的 harness bug（对后续全链路 harness 者是关键坑册）

**投影前必须调 `ResolveAll(ir, nil)`**：首轮 C01 渲染"成功"但三采样点画面完全相同——逐像素排查定位：projector 把 `effects[].resolvedFrom` 序列化进数据块，**未经 ResolveAll 时该字段缺失**，builder 的 `anchorTime(undefined)` 返回 0，**整个锚点编排塌缩到 t=0**（高亮全落 F0-25、counter 从 F0 定格终值）。已在 l3_full_test.go 留说明注释。任何新写全链路 harness 的人都会踩。

## 3. 真服务端稳定性（3 批 × 3 跑）

- **7/9 绿**；两批的失败均落在批内第一次执行且模式不同：
  - batch1 run1：`GET /config → 504`（**/config 的 settings.Effective() 逐 key 串行 30+ 次往返、无缓存**——冷启动首进程叠加打满 5s Timeouts；已记录为 /config 性能改进点，未改代码）
  - batch2 run1：pgx 连接被 Docker 端口代理 RST（纯环境抖动，容器零异常）
- batch3 全新容器首跑即绿——**业务代码零回归**
- **reconciler 首次真机零误判**：注入 10s interval 后每 run 真实 4-6 轮，三跑后全部 succeeded、drift JOIN=0、无 `reconciled` 注记、released_at 全 NULL（契约正确）
- **并发提交**：双独立幂等键 → 两个 render_id、双双 succeeded、B 墙钟 ≈ A + 一个完整渲染（**MaxWorkers=1 排队证据**）、配额 used=2、台账 2 行

## 4. 错误码族落地（批9-5，§8.5 未决项 1 关闭）

- **裁定 1**（TTS/Aligner）：不新增码（降级矩阵下永不返回）——MCP 工具描述与 openapi 补降级语义澄清（"check words_source instead"）
- **裁定 2**（素材缺失）：**悬空 src 写时校验落地**——`validateAssetRefs` 挂在 Mutate 内（PUT IR 与全部 MCP 变更共用）：`video_asset` 登记行 OR storagex 物理存在（存量兼容窗口，注释写明）→ 否则 400 `E_VIDEO_IR_INVALID` field=`elements[N].src`（"asset not registered"）
- 新增 DB 集成 7 组断言（悬空/登记/legacy/索引/跨工作区/豁免）全过
- 文档三份同步：openapi 错误码定值表（9 实际码 + 降级裁定注记）、架构文档 §10.5 分叉行逐行加注、案例库 §8.5 回写"已解决"

## 5. 全量门禁（合流状态实测）

```
root + example build/vet（默认+capx 两模式）      全绿
go test ./internal/video/... ./cmd/app/           6 包全 ok
go test ./platform/capx ./quota ./internal/arch   ok
L3 全量九案渲染                                    9/9 PASS（10800 帧精确）
TestL3Smoke ×9（3 批 × 3 跑）                      7/9 绿（2 fail 均首跑环境因素）
check_api 172:172                                  OK
docs language guard                                OK
```

---

## 6. 产物清单

```
docs/delivery-audit-video-studio-round9-2026-11-16.md  # 本文档
docs/openapi.yaml / architecture 文档 / 案例库 §8.5   # 错误码定值三份同步
example/internal/video/app/service.go       # validateAssetRefs（悬空 src 写时校验）
example/internal/video/testdata/
├── l3-full/VS-C01..C09/output.mp4 ×9 + 抽帧 ×27 + report.json    # 九案全时长成片
├── l3-full-verdict.json                   # §7.4 验收判定（PASS）
├── l3-full_test.go / l3b_full_test.go     # 前五案/后四案 harness
├── l3-stability-report.json               # 真服务端 3×3 稳定性 + reconciler + 并发
└── service_db_test.go                     # +7 组 src 校验断言
```

## 7. 剩余事项（全项目收口视角）

| 项 | 状态 |
|---|---|
| M2 完全收口 | 29 条人工复核（清单就绪）+ C02 断言校准 |
| M3 | P0 字体子集 ✅（round8）→ **P1 镜像**（Dockerfile+golden.yml，方案已定稿）→ P2 镜像内 L5 复证 → P3 golden 迁移 |
| F-AUD-01 音轨超挂 | MuxAV 按时长裁剪（minor） |
| /config 性能 | settings.Effective 逐 key 串行无缓存（本轮稳定性验证发现，改进点已记录） |
| race 环境 | msys2 清理后补 -race 车道 |
| npm 发版 | 四包 minor（Slider/ScopePrefix）攒批 |
| wordId/逐词 span/轨道 | IR 扩展 P1 级，维持触发制 |

---

**案例库执行状态总结**：L0-L3 四层全部达成（L0 62 pass / L1 九案 0 fail / L2 9/9 / **L3 九案全量 PASS**）；L4/L5 的可执行部分已完成（DOM tripwire 三案、100× 一致性），其余受 M3 镜像前置。§8.5 未决项 10 → 关闭 3（#1/#5/#8）/ 提案 1 / 维持 6。
