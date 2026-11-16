package scriptgen

import (
	"math"

	videoapp "myproduct/internal/video/app"
	"myproduct/internal/video/app/template"
)

// minCardSeconds 是每张卡的时间窗保底（秒）。末卡 CTA、纯标题短卡在
// 字符占比/词表映射下可能被压到个位数帧（真调抓出：endcard [299,300]
// 仅 1 帧），视觉上不可读。1.5s 与案例库淡入淡出（12 帧 ≈0.4s）叠加
// 仍有 ≥20 帧的稳定阅读期。
const minCardSeconds = 1.5

// computeWindows 计算每张卡的元素时间窗口（GLOBAL-TIMELINE 帧钟，§7.0：
// frame = ceil(t × fps)）。窗口为含首含尾 [startFrame, endFrame]
// （template.Apply 把每个元素的 StartFrame/EndFrame 都设成该窗口）。
//
// 词表非空：卡片文本的字符权重在词表 token 总权重上做占比映射，端点换算
// 为帧（与 EstimateWords 的字数比例口径一致）；
// 词表为空：按字数比例在帧轴 [0, durationFrames] 上均匀切分。
//
// 保证：窗口单调、相邻共享交界帧（前窗 end = 后窗 start——同一帧属于两卡
// 边界，配合 builder 的半帧 ε hide set 构成无缝硬切：交界帧归前卡含尾、
// 下一帧起归后卡，任何 seek 上不会出现两卡同显或同隐）、首窗起 0、末窗终
// durationFrames、每窗宽度 ≥ minCardSeconds 对应帧数（帧轴总量不足时按
// 现有帧数尽力而为）。
func computeWindows(cards []template.Card, weights []int, words []videoapp.Word, fps, durationFrames int) [][2]int {
	n := len(cards)
	out := make([][2]int, n)
	if n == 0 {
		return out
	}
	total := 0
	for _, w := range weights {
		total += w
	}
	if total <= 0 {
		total = n
		for i := range weights {
			weights[i] = 1
		}
	}
	if len(words) > 0 {
		// 词表时间轴：卡片累计字符占比 → 词表 token 下标 → ceil 帧转换。
		tokenCount := len(words)
		tokenSum := 0
		for _, w := range words {
			c := runeWeight(w.Text)
			if c <= 0 {
				c = 1
			}
			tokenSum += c
		}
		if tokenSum <= 0 {
			tokenSum = tokenCount
		}
		acc := 0
		for i, cw := range weights {
			startChar := acc
			acc += cw
			endChar := acc
			si := charToTokenIndex(startChar, tokenSum, tokenCount)
			ei := charToTokenIndex(endChar-1, tokenSum, tokenCount)
			sf := int(math.Ceil(words[si].Start * float64(fps)))
			ef := int(math.Ceil(words[ei].End * float64(fps)))
			if ef <= sf {
				ef = sf + 1
			}
			out[i] = [2]int{sf, ef}
		}
	} else {
		// 无词表：字数比例均匀切分帧轴。
		acc := 0
		for i, cw := range weights {
			sf := durationFrames * acc / total
			acc += cw
			ef := durationFrames * acc / total
			if i == n-1 {
				ef = durationFrames
			}
			if ef <= sf {
				ef = sf + 1
			}
			out[i] = [2]int{sf, ef}
		}
	}
	floor := minCardFrames(fps)
	return normalizeWindows(out, durationFrames, floor)
}

// minCardFrames 把每卡保底秒数换算为帧数（ceil 口径，§7.0 时钟）。
func minCardFrames(fps int) int {
	if fps <= 0 {
		fps = 30
	}
	n := int(math.Ceil(minCardSeconds * float64(fps)))
	if n < 1 {
		n = 1
	}
	return n
}

// charToTokenIndex 把卡片累计字符量映射到词表 token 下标：占比 × 词表长度，
// 收敛到合法区间。比例映射（而非逐 token 累计游标）在卡片文本与词表 token
// 略有出入（标点折叠、bullet 重排）时仍给出单调、在界内的端点。
func charToTokenIndex(char, tokenSum, tokenCount int) int {
	if tokenCount <= 0 {
		return 0
	}
	if tokenSum <= 0 {
		return tokenCount - 1
	}
	idx := char * tokenCount / tokenSum
	if idx >= tokenCount {
		idx = tokenCount - 1
	}
	if idx < 0 {
		idx = 0
	}
	return idx
}

// normalizeWindows 收敛窗口序列：首窗起点归 0、末窗终点归 durationFrames、
// 相邻窗口共享交界帧（前窗 end = 后窗 start）、每窗宽度保底 floorFrames
// （末卡向前的短窗从紧邻前卡借帧；前卡本身过短再向前借，链条递推）、
// 顺序钳制保证 start ≤ end 且全部落在 [0, durationFrames]（IR Validate
// 的窗口边界；endFrame == durationFrames 合法——窗口含尾，末帧可见）。
//
// 交界帧共享（而非"后窗 = 前窗 end + 1"错帧）是刻意的：builder 的 visible
// set 落在 startFrame 帧内半帧处（seek(startFrame+1) 起可见）、hide set 落
// 在 endFrame 帧后半帧处（seek(endFrame+1) 起隐藏）——交界帧 F 上前卡可见
// （含尾）、后卡未开，F+1 上前卡已隐、后卡可见：每个 seek 落点恰有一张卡
// 在场，无缝硬切零黑隙。若改为错帧衔接，交界处会出现一帧两卡同隐（批6a
// 在 hide-at-tEnd 精确落位下实测的"切换帧双零"1 帧空隙，案例库 §7.0）。
func normalizeWindows(ws [][2]int, durationFrames, floorFrames int) [][2]int {
	n := len(ws)
	if n == 0 {
		return ws
	}
	// 单调递增化：每个窗口的下界不小于前一窗口的上界（共享交界帧）。
	prevEnd := 0
	for i := range ws {
		s, e := ws[i][0], ws[i][1]
		if s < prevEnd {
			s = prevEnd
		}
		if e <= s {
			e = s + 1
		}
		ws[i] = [2]int{s, e}
		prevEnd = e
	}
	// 每窗宽度保底：短窗向紧邻前卡借帧（backward），首卡过短向次卡借
	// （forward）。借帧只移动共享交界帧，不改变各窗终点（末窗终点保持
	// durationFrames）。前卡自身只剩 1 帧时停止借让（退化场景尽力而为）。
	if floorFrames > 1 {
		for i := n - 1; i >= 1; i-- {
			if ws[i][1]-ws[i][0] >= floorFrames {
				continue
			}
			newStart := ws[i][1] - floorFrames
			if newStart < ws[i-1][0]+1 {
				newStart = ws[i-1][0] + 1
			}
			if newStart >= ws[i][1] {
				continue
			}
			ws[i][0] = newStart
			ws[i-1][1] = newStart
		}
		if ws[0][1]-ws[0][0] < floorFrames && n > 1 {
			newEnd := ws[0][0] + floorFrames
			if newEnd > ws[1][1]-1 {
				newEnd = ws[1][1] - 1
			}
			if newEnd > ws[0][1] {
				ws[0][1] = newEnd
				ws[1][0] = newEnd
			}
		}
	}
	// 总长钳制：末窗终点必须落在 durationFrames；超出则整体按比例收缩。
	if prevEnd > durationFrames {
		scale := float64(durationFrames) / float64(prevEnd)
		for i := range ws {
			s := int(math.Floor(float64(ws[i][0]) * scale))
			e := int(math.Floor(float64(ws[i][1]) * scale))
			if e <= s {
				e = s + 1
			}
			ws[i] = [2]int{s, e}
		}
	}
	ws[n-1][1] = durationFrames
	if ws[n-1][0] >= durationFrames {
		ws[n-1][0] = durationFrames - 1
	}
	if ws[0][0] > 0 {
		ws[0][0] = 0
	}
	// 最终一致性扫尾（收缩可能重新制造相邻越界；保底借帧后交界仍共享）。
	for i := 1; i < n; i++ {
		if ws[i][0] < ws[i-1][1] {
			ws[i][0] = ws[i-1][1]
		}
		if ws[i][1] <= ws[i][0] {
			ws[i][1] = ws[i][0] + 1
		}
	}
	if ws[n-1][1] < durationFrames {
		ws[n-1][1] = durationFrames
	}
	if ws[n-1][0] >= ws[n-1][1] {
		ws[n-1][0] = ws[n-1][1] - 1
	}
	return ws
}

// fadeFrames 是窗口切换的淡入淡出时长（帧）。约 0.4s @30fps，
// 与 P0-2 案例库的入场淡入时长一致（10-12 帧量级）。
const fadeFrames = 12

// windowFades 为一张卡的元素追加 fadeIn/fadeOut 动画（seq 使动画 id 确定
// 性唯一——同一 Compose 内不重号，Compose 输出可复现）。
//
// 锚定语义（builder 侧规则：无 startAnchor 的 fadeIn/fadeOut 挂在所属元素
// 自己的窗口上）：fadeIn 锚在窗口开帧、fadeOut 结束在窗口关帧——淡入淡出
// 跟卡走而不是全落 t=0。此前无锚版本双双落在 t=0，是两处真调症状的根因：
// fadeOut fromTo 的 immediateRender 在构建期把全部元素写回可见（f0 叠印），
// 其完成态 autoAlpha=0 在 0.4s 后压制一切后续帧（f60 全黑）。
//
// 窗口开在 0 帧（首卡）时不发 fadeIn：锚在 0 的 fromTo 在 seek(0) 渲染
// progress 0（autoAlpha=0），会把 F0 压黑（batch-6 F0 黑帧同类病灶）。
// StartAnchor 留空：可见性由元素窗口持有（Apply 已写 StartFrame/EndFrame），
// 淡入淡出只负责不透明度轴——两轴正交（timeline-builder §"ORTHOGONAL
// AXES BY DESIGN"）；resolvedFrom 由 Mutate 的 ResolveAll 全量重解析补齐
// （无锚动画不受影响）。sf/ef 为该卡窗口（含首含尾）；窗口宽 ≤1 帧时
// 两个方向都不发（没有可读的渐变空间）。
func windowFades(seq, sf, ef int) []videoapp.ElementAnimation {
	var out []videoapp.ElementAnimation
	if ef-sf <= 1 {
		// 折叠/单帧窗口：没有可读的渐变空间，双向都不发（元素只在
		// 一帧内在场，淡入淡出都来不及呈现）。
		return out
	}
	if sf > 0 {
		out = append(out, videoapp.ElementAnimation{
			ID: "an_fadein_" + itoa(seq), Type: "fadeIn", DurationFrames: fadeFrames, Easing: "power2.out",
		})
	}
	out = append(out, videoapp.ElementAnimation{
		ID: "an_fadeout_" + itoa(seq), Type: "fadeOut", DurationFrames: fadeFrames, Easing: "power2.out",
	})
	return out
}
