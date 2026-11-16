//go:build ignore

// shuijing-gen.go — 生成手串宣传视频的 IR JSON（run: go run shuijing-gen.go）。
// 手串渲染 = 现有 IR 能力内：每个珠子是一个 image 元素（水晶圆珠透明 webp），
// 坐标按圆周分布手工计算（复刻 shuijing computeLayout 的圆形绳圈视觉）。
package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
)

const (
	W     = 1080
	HH    = 1920
	FPS   = 30
	DurSec = 30.0
	Frames = 900 // ceil(30*30)
)

type El struct {
	ID           string `json:"id"`
	Type         string `json:"type"`
	Src          string `json:"src,omitempty"`
	Text         string `json:"text,omitempty"`
	X            int    `json:"x"`
	Y            int    `json:"y"`
	W            int    `json:"w"`
	H            int    `json:"h"`
	Z            int    `json:"z"`
	Color        string `json:"color,omitempty"`
	FontSize     int    `json:"fontSize,omitempty"`
	StartFrame   int    `json:"startFrame"`
	EndFrame     int    `json:"endFrame"`
	Animations   []Anim `json:"animations,omitempty"`
}

type Anim struct {
	ID             string  `json:"id"`
	Type           string  `json:"type"`
	From           *Point  `json:"from,omitempty"`
	To             *Point  `json:"to,omitempty"`
	FromValue      *float64 `json:"fromValue,omitempty"`
	ToValue        *float64 `json:"toValue,omitempty"`
	DurationFrames int     `json:"durationFrames"`
	Easing         string  `json:"easing"`
	StartAnchor    *Anchor `json:"startAnchor,omitempty"`
}

type Point struct{ X, Y int }
type Anchor struct{ Text string; Occurrence int }

type Effect struct {
	ID              string          `json:"id"`
	Anchor          Anchor          `json:"anchor"`
	Type            string          `json:"type"`
	Params          json.RawMessage `json:"params,omitempty"`
	TargetElementID string          `json:"targetElementId,omitempty"`
}

type Word struct {
	Index  int     `json:"index"`
	Text   string  `json:"text"`
	Start  float64 `json:"start"`
	End    float64 `json:"end"`
	Source string  `json:"source"`
}

type IR struct {
	SchemaVersion int      `json:"schemaVersion"`
	Meta          Meta     `json:"meta"`
	Script        string   `json:"script"`
	Words         []Word   `json:"words"`
	Effects       []Effect `json:"effects"`
	Elements      []El     `json:"elements"`
}

type Meta struct {
	FPS         int     `json:"fps"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`
	DurationSec float64 `json:"durationSec"`
}

// estimate splits script into space-separated words with proportional timing
func estimate(script string, dur float64) []Word {
	// split by rune groups at spaces (mirror EstimateWords' chunking loosely);
	// for anchors we define words explicitly below instead — words[] here is
	// the anchor substrate, hand-authored for precise word timing.
	return nil
}

func main() {
	// ---- 手串圆周布局（镜 2 起可见）：圆心 (540,880)，半径 260，珠径 150 ----
	cx, cy, R, bead := 540.0, 880.0, 260.0, 170
	beads := []struct{ id, src string }{
		{"sj_bead_rose", "video/ws-shuijing/bead-peach.webp"},
		{"sj_bead_amethyst", "video/ws-shuijing/bead-amethyst.webp"},
		{"sj_bead_moon", "video/ws-shuijing/bead-moon.webp"},
		{"sj_bead_obsidian", "video/ws-shuijing/bead-obsidian.webp"},
		{"sj_bead_peach2", "video/ws-shuijing/bead-rose.webp"},
	}
	var els []El

	// 背景深色（全程）
	els = append(els, El{ID: "bg", Type: "shape", X: 0, Y: 0, W: W, H: HH, Z: 0,
		Color: "#1A1423", StartFrame: 0, EndFrame: Frames})

	// 镜 1：hero 大珠（桃花水晶 400px 居中偏上）+ 标题
	els = append(els, El{ID: "hero_bead", Type: "image", Src: "video/ws-shuijing/bead-peach.webp",
		X: 340, Y: 560, W: 400, H: 400, Z: 2, StartFrame: 0, EndFrame: 120,
		Animations: []Anim{{ID: "hero_in", Type: "scaleIn", FromValue: f64(0.6), ToValue: f64(1.0),
			DurationFrames: 20, Easing: "power2.out"}}})
	els = append(els, El{ID: "title", Type: "text", Text: "一颗水晶\n五种心情", X: 240, Y: 1080,
		W: 600, H: 260, Z: 2, Color: "#F5EED8", FontSize: 76, StartFrame: 0, EndFrame: 120})

	// 镜 2：五珠手串（startFrame=120）——圆周排布
	for i, b := range beads {
		ang := -math.Pi/2 + float64(i)*2*math.Pi/float64(len(beads))
		x := int(cx + R*math.Cos(ang)) - bead/2
		y := int(cy + R*math.Sin(ang)) - bead/2
		els = append(els, El{ID: b.id, Type: "image", Src: b.src,
			X: x, Y: y, W: bead, H: bead, Z: 3 + i, StartFrame: 120, EndFrame: Frames,
			Animations: []Anim{{ID: fmt.Sprintf("bead_in_%d", i), Type: "scaleIn",
				FromValue: f64(0), ToValue: f64(1.0), DurationFrames: 14, Easing: "back.out"}}})
	}
	// 手串标签
	els = append(els, El{ID: "bracelet_label", Type: "text", Text: "五珠成串 · 一见倾心",
		X: 290, Y: 1450, W: 500, H: 100, Z: 5, Color: "#F5EED8", FontSize: 52,
		StartFrame: 150, EndFrame: 330})

	// 镜 3：卖点文案（39 种水晶）
	els = append(els, El{ID: "sell1", Type: "text", Text: "39 种天然水晶", X: 290, Y: 820,
		W: 500, H: 100, Z: 6, Color: "#FFD166", FontSize: 60, StartFrame: 330, EndFrame: 480})
	els = append(els, El{ID: "sell2", Type: "text", Text: "在线圆形编辑器\n拖拽即成串", X: 240, Y: 960,
		W: 600, H: 200, Z: 6, Color: "#F5EED8", FontSize: 48, StartFrame: 360, EndFrame: 480})

	// 镜 4：价格 counter（100 → 79）
	els = append(els, El{ID: "price", Type: "text", Text: "到手价 79", X: 340, Y: 880,
		W: 400, H: 120, Z: 7, Color: "#FF6A3D", FontSize: 88, StartFrame: 480, EndFrame: 720})

	// 镜 5：CTA
	els = append(els, El{ID: "cta", Type: "text", Text: "打开在线编辑器\n定制你的水晶手串", X: 240, Y: 860,
		W: 600, H: 200, Z: 8, Color: "#F5EED8", FontSize: 56, StartFrame: 720, EndFrame: Frames})
	els = append(els, El{ID: "cta_sub", Type: "text", Text: "shuijing · Online Bracelet Maker",
		X: 290, Y: 1100, W: 500, H: 80, Z: 8, Color: "#8A8098", FontSize: 32,
		StartFrame: 750, EndFrame: Frames})

	// ---- 词锚（words[] 驱动 counter/highlight）----
	words := []Word{
		{0, "水晶", 1.0, 1.5, "manual"}, {1, "心情", 1.6, 2.4, "manual"},
		{2, "成串", 5.2, 6.0, "manual"}, {3, "三十九种", 10.2, 11.2, "manual"},
		{4, "水晶", 11.3, 11.9, "manual"}, {5, "拖拽", 12.1, 12.8, "manual"},
		{6, "到手价", 16.2, 17.0, "manual"}, {7, "七十九", 17.1, 18.4, "manual"},
		{8, "编辑器", 24.2, 25.2, "manual"}, {9, "手串", 25.4, 26.2, "manual"},
	}

	effects := []Effect{
		{ID: "fx_counter", Anchor: Anchor{"到手价", 0}, Type: "counter",
			TargetElementID: "price",
			Params: mustJSON(map[string]any{"from": 100, "to": 79, "color": "#FF6A3D"})},
		{ID: "fx_hl_title", Anchor: Anchor{"水晶", 0}, Type: "highlight",
			TargetElementID: "title", Params: mustJSON(map[string]any{"color": "#FFD166"})},
		{ID: "fx_pulse_bead", Anchor: Anchor{"成串", 0}, Type: "pulse",
			TargetElementID: "sj_bead_rose", Params: mustJSON(map[string]any{"scale": 1.08})},
	}

	ir := IR{
		SchemaVersion: 1,
		Meta:          Meta{FPS: FPS, Width: W, Height: HH, DurationSec: DurSec},
		Script:        "一颗水晶五种心情。五珠成串一见倾心。三十九种天然水晶，在线圆形编辑器拖拽即成串。到手价七十九。打开在线编辑器，定制你的水晶手串。",
		Words:         words,
		Effects:       effects,
		Elements:      els,
	}
	b, _ := json.MarshalIndent(ir, "", " ")
	os.WriteFile("ir/shuijing/promo.json", b, 0o644)
	fmt.Println("elements:", len(els), "words:", len(words), "written")
}

func f64(v float64) *float64 { return &v }

func mustJSON(m map[string]any) json.RawMessage {
	b, _ := json.Marshal(m)
	return json.RawMessage(b)
}
