// Package videoapp holds the pure application core of the example agent
// video studio domain: the IR (intermediate representation) contract, the
// single mutation entry point (ProjectService), the IR-to-HTML projector and
// the subtitle builder. All of it is side-effect free except the service,
// which persists through the injected ports only.
package videoapp

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

// EffectType enumerates the v1 motion-effect registry. New effects join by
// adding a type here, a builder in timeline-builder.js, and a params check in
// validateEffectParams (one extension point per layer).
const (
	EffectPulse     = "pulse"
	EffectCounter   = "counter"
	EffectHighlight = "highlight"
	EffectShake     = "shake"
	EffectFade      = "fade"
	// EffectGlow（2026-11-18，设计批 2）：文本辉光的呼吸循环。text-shadow
	// 的 blur+alpha 在 blurMin..blurMax 之间 yoyo 往复——静态 textShadow 已有，
	// 但"活着"的辉光需要时间维度；GSAP 的 yoyo/repeat 在 seek 下确定性成立
	// （无回调），配一个 t=0 的 set 兜底回弱光态。
	EffectGlow = "glow"
)

// ElementType enumerates the composable element kinds (read-time tolerance in
// the projector: unknown types are skipped with a warning, forward compat).
const (
	ElementImage = "image"
	ElementText  = "text"
	ElementShape = "shape"
)

// WordSource records where a word timestamp came from (tts = vendor direct,
// aligner = forced alignment, manual = agent-supplied, estimated = fallback).
const (
	WordSourceTTS       = "tts"
	WordSourceAligner   = "aligner"
	WordSourceManual    = "manual"
	WordSourceEstimated = "estimated"
)

// AnchorReason is why an anchor resolved to the word index it did (see
// ResolveAnchors: exact > same_text > nearest > missing).
const (
	AnchorExact    = "exact"
	AnchorSameText = "same_text"
	AnchorNearest  = "nearest"
	AnchorMissing  = "missing"
)

// Meta carries the canvas/timeline geometry of one composition.
type Meta struct {
	FPS         int     `json:"fps"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`
	DurationSec float64 `json:"durationSec"`
}

// Word is one timestamped unit of the script.
type Word struct {
	Index  int     `json:"index"`
	Text   string  `json:"text"`
	Start  float64 `json:"start"`
	End    float64 `json:"end"`
	Source string  `json:"source"`
}

// Anchor points at a word by its text plus an occurrence index (0-based) so
// agents can survive script edits without knowing numeric word indexes.
type Anchor struct {
	Text       string `json:"text"`
	Occurrence int    `json:"occurrence"`
}

// ResolvedFrom is the audit trail of one anchor resolution, written back onto
// the effect/animation at mutation time so inspect can show drift.
type ResolvedFrom struct {
	WordIndex int    `json:"wordIndex"`
	Reason    string `json:"reason"`
}

// Effect is a word-anchored motion effect (pulse/counter/highlight/shake/fade).
// TargetElementID is an optional element-level target (IR extension, T-10
// P0): the counter effect self-hosts a div at the canvas origin by default;
// when TargetElementID names an existing element the counter host is
// positioned at that element's bbox instead. Write-time validated (must
// reference an existing element id); absent = origin behavior (back-compat).
//
// AtFrame (2026-11-17, 11-clip replication friction — speedrun's timer
// counter needed a timeline anchor with ZERO words in the composition) is
// the effect-side twin of ElementAnimation.AtFrame: an explicit frame anchor
// on the GLOBAL timeline (same clock, frame = ceil(t × fps)) so a counter can
// start at frame N without a word there. Mutually exclusive with Anchor
// (both set = 400; anchor.text is only required when AtFrame is nil); when
// set, anchor resolution is skipped entirely (ResolveAll leaves ResolvedFrom
// nil — the builder keys off atFrame and never reads word resolution).
type Effect struct {
	ID              string          `json:"id"`
	Anchor          Anchor          `json:"anchor"`
	Type            string          `json:"type"`
	Params          json.RawMessage `json:"params,omitempty"`
	TargetElementID string          `json:"targetElementId,omitempty"`
	AtFrame         *int            `json:"atFrame,omitempty"`
	AtBeat          *BeatRef        `json:"atBeat,omitempty"` // 音乐网格锚，见 BeatRef
	ResolvedFrom    *ResolvedFrom   `json:"resolvedFrom,omitempty"`
}

// FontAsset registers one brand font the composition depends on (2026-11-17,
// 11-clip replication friction: every clip bakes its brand typography into
// PNGs because the IR could not carry a font). Key is a storagex
// video/<workspace>/ storage key (same prefix rule as image src — fonts ride
// the same upload/registry lane); Family is the CSS font-family name authors
// reference in their own tooling (and the projector emits in @font-face);
// Weight is an optional CSS font-weight value ("800" or a "400 900" range).
type FontAsset struct {
	Key    string `json:"key"`
	Family string `json:"family"`
	Weight string `json:"weight,omitempty"`
}

// validFontFamilyRe is the Family charset: alphanumerics, spaces,
// underscores and hyphens — enough for "My Brand Bold"/"Noto_Sans" style
// names while excluding quotes/semicolons/braces (the projector splices
// Family into a <style> @font-face rule, so CSS metacharacters are a
// injection vector, same reasoning as the element src URL gate).
var validFontFamilyRe = regexp.MustCompile(`^[A-Za-z0-9 _-]+$`)

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// ElementAnimation moves/scales/rotates/fades/resizes one element, anchored
// at a word or an explicit frame.
type ElementAnimation struct {
	ID        string   `json:"id"`
	Type      string   `json:"type"` // move|scaleIn|rotate|fadeIn|fadeOut|resize
	From      *Point   `json:"from,omitempty"`
	To        *Point   `json:"to,omitempty"`
	FromValue *float64 `json:"fromValue,omitempty"` // scale/rotate scalar
	ToValue   *float64 `json:"toValue,omitempty"`
	// Pivot is the CANVAS-space scale pivot for groupScale (2026-11-18, design
	// batch 2). One element per animation, but a GROUP of elements sharing the
	// same pivot + timing reads as one camera push: each element's local
	// transform-origin is recomputed at the tween start so the whole
	// composition scales about the same canvas point (the flat v1 form of the
	// "no group transform" gap the 11-clip replication reported). Origin is
	// rewritten from AtFrame onward; put a camera push last, or make sure any
	// later animation supplies its own origin expectation.
	Pivot *Point `json:"pivot,omitempty"`
	// StartAnchor is the word-text anchor (v1 primary anchoring).
	StartAnchor *Anchor `json:"startAnchor,omitempty"`
	// AtFrame is an explicit frame anchor on the GLOBAL timeline — the same
	// clock as the element window (§7.0: frame = ceil(t × fps)) — and the flat
	// v1 bridge to the v2 `at:{frame}` object (spec §2.8.1): versus-pilot
	// authors had no way to say "start this animation at frame N" without a
	// word there, so they minted fake "manual" anchor words as a timeline
	// (37 in one project). Mutually exclusive with StartAnchor (both set =
	// 400). BOTH absent = the v1 fallbacks stay (unanchored animations
	// resolve to t=0; fadeIn/fadeOut fall back to the owning element's
	// window); v2 tightens this to "at is required, exactly one flavor".
	AtFrame *int `json:"atFrame,omitempty"`
	// AtBeat 是不久前新增的音乐网格锚（与 AtFrame 同语义：解析成 AtFrame 后
	// 走既有路径）。与 StartAnchor 互斥；同时给 AtFrame 时两者必须一致
	// （ResolveBeats 幂等写回，重复 Validate 不会误报）。
	AtBeat         *BeatRef        `json:"atBeat,omitempty"`
	DurationFrames int             `json:"durationFrames"`
	Easing         string          `json:"easing,omitempty"`
	ResolvedFrom   *ResolvedFrom   `json:"resolvedFrom,omitempty"`
	Extra          json.RawMessage `json:"extra,omitempty"`
}

// Clip is a FIXED camera window in CANVAS coordinates (round-rect) — the
// flat v1 form of "卡框内房间相机" (spotdiff hunt-drift promotion, rain-pilot
// 运镜缓推): the element's content scales/moves/rotates INSIDE the window
// while the window stays put on the canvas. The builder realizes this with
// an untransformed wrapper node — a clip-path on the element node itself
// would ride the element's own transform (browser-verified 2026-11-17: at
// scale=2 a local clip [100,200]×[100,300] rendered as [0,200]×[0,400]).
type Clip struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	W      float64 `json:"w"`
	H      float64 `json:"h"`
	Radius float64 `json:"radius"` // corner rounding; 0 = square window
}

// validMixBlendModes is the CSS compositing whitelist (safe set). This is
// the day-pilot 色温 system's groundwork: a color-grade overlay element with
// multiply/screen expresses morning→noon→dusk→night without baking 5-state
// cards, and #canvas gets isolation:isolate so blends never leak past the
// stage (projector CSS).
var validMixBlendModes = map[string]bool{
	"multiply": true, "screen": true, "overlay": true, "soft-light": true,
	"hard-light": true, "color-dodge": true, "color-burn": true, "darken": true,
	"lighten": true, "difference": true, "exclusion": true, "hue": true,
	"saturation": true, "color": true, "luminosity": true,
}

// transformOriginRe accepts the CSS transform-origin forms this domain
// allows: "X Y" pairs and the bare "center" shorthand. Axis values are
// keywords (top|center|bottom first slot; top|center|bottom|left|right|
// center second slot) or finite numbers with % / px unit. Empty = 50% 50%
// (the v1 behavior before the field existed — GSAP inherits the node's
// style transform-origin, browser-verified 2026-11-17).
var transformOriginRe = regexp.MustCompile(
	`^(?:(top|center|bottom|\d+(\.\d+)?(%|px)?) (top|center|bottom|left|right|center|\d+(\.\d+)?(%|px)?)|center)$`)

// Element is one composable layer on the canvas.
//
// Element time window (P0-1, case library §5.16 / T-09): StartFrame/EndFrame
// are an optional visibility window in GLOBAL-TIMELINE frame numbers — the
// same clock as word anchors (§7.0 ruling: frame = ceil(t × fps); valid range
// [0, DurationFrames-1]). A windowed element is hidden before StartFrame,
// visible inside the window, and hidden again from EndFrame on; without a
// window the element is visible for the whole composition exactly as before
// (back-compat: pointers distinguish unset from 0, so an endFrame=0 without
// startFrame expresses "never visible").
//
// VISIBLE FRAMES: [StartFrame+1, EndFrame] — the END IS INCLUSIVE. The builder
// shows the element at tStart+1/(2·fps) and hides it at tEnd+1/(2·fps), so the
// boundary frame belongs to the earlier card (case library §7.0, verified by
// three independent probes). An earlier revision of this comment described a
// half-open [start, end) window, which cost agents a frame on hard cuts.
type Element struct {
	ID       string  `json:"id"`
	Type     string  `json:"type"` // image|text|shape
	Src      string  `json:"src,omitempty"`
	Text     string  `json:"text,omitempty"`
	Color    string  `json:"color,omitempty"`
	FontSize float64 `json:"fontSize,omitempty"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	W        float64 `json:"w"`
	H        float64 `json:"h"`
	Z        int     `json:"z"`

	// Element time window (P0-1): optional, pointer-typed so JSON omission
	// stays distinct from explicit 0. Validated non-negative, startFrame ≤
	// endFrame, and bounded by DurationFrames (the single-source formula,
	// meta extended by voice duration — not meta-only).
	StartFrame *int `json:"startFrame,omitempty"`
	EndFrame   *int `json:"endFrame,omitempty"`

	// TransformOrigin (2026-11-17, camera/group-transform gap): a CSS
	// transform-origin value ("top center" / "50% 0" / "top left"…) the
	// builder writes onto the element node's style. GSAP tweens inherit the
	// node's transform-origin when their vars don't carry one, so
	// scaleIn/rotate/pulse follow the element's own origin without touching
	// animBuilders. Empty = 50% 50% (v1 behavior unchanged).
	TransformOrigin string `json:"transformOrigin,omitempty"`
	// Clip is the fixed camera window (see the Clip struct). Nil = no
	// wrapper, the element mounts bare exactly as before (byte-identical
	// projection for legacy IRs).
	Clip *Clip `json:"clip,omitempty"`
	// MixBlendMode is a whitelisted CSS mix-blend-mode (see
	// validMixBlendModes). Blending is element-vs-below semantics and stays
	// on the element node even when a clip wrapper exists (clip and blend
	// are orthogonal axes).
	MixBlendMode string `json:"mixBlendMode,omitempty"`

	// ---- Visual styling layer (2026-11-18, design-pass batch) ----
	// The fields below carry the styling knobs the 11-clip replication and
	// the gallery showcase batch kept baking into PNGs because the IR could
	// not express them (typography treatments, gradient backdrops, rounded
	// pills). All are omitempty and the builder only writes a style when a
	// value is present, so legacy IRs project byte-identically.
	//
	// Text styling (text elements; ignored elsewhere):
	//   FontFamily    — must match a registered fontAssets Family (or the
	//                   builtin "Noto Sans SC Sub"). Validated at write time:
	//                   an unregistered family would silently fall back.
	//   FontWeight    — CSS weight 100–900. Meaningful only when the
	//                   registered face covers the axis (variable woff2 or a
	//                   weight-scoped fontAssets entry).
	//   LetterSpacing — px (negative tightens).
	//   LineHeight    — unitless multiplier (e.g. 1.05 for display lines).
	//   TextAlign     — left|center|right (default left).
	//   StrokeColor/StrokeWidth — outline painted OUTSIDE the glyphs
	//                   (paint-order: stroke fill), the die-cut sticker
	//                   look; both must be set together.
	//   TextShadow    — one drop/glow shadow; the author stacks several
	//                   elements for richer treatments.
	//   Opacity       — 0..1 static opacity for ANY element. 0/absent means
	//                   the default 1.0 (the omitempty zero cannot express
	//                   "invisible"; use the time window or fade effects for
	//                   that — same caveat as the audio volume field).
	// Shape styling (shape elements; ignored elsewhere):
	//   Radius        — corner radius px; pointer-typed so radius:0 works
	//                   (nil = the v1 stylesheet default of 8px).
	//   Gradient      — a CSS gradient fill that supersedes Color (see the
	//                   Gradient struct and the color whitelist).
	FontFamily    string      `json:"fontFamily,omitempty"`
	FontWeight    float64     `json:"fontWeight,omitempty"`
	LetterSpacing float64     `json:"letterSpacing,omitempty"`
	LineHeight    float64     `json:"lineHeight,omitempty"`
	TextAlign     string      `json:"textAlign,omitempty"`
	StrokeColor   string      `json:"strokeColor,omitempty"`
	StrokeWidth   float64     `json:"strokeWidth,omitempty"`
	TextShadow    *TextShadow `json:"textShadow,omitempty"`
	// TextGradient（2026-11-18，设计批 2）：渐变文字填充——background-clip:
	// text 把渐变当字形填充，比纯色高级得多。**与 strokeColor 互斥**（浏览器
	// 实测：background-clip:text 的填充层在描边之下，描边会把字形内部吃掉，
	// 得到空心轮廓——写时直接拒绝，不留"渲染成功但难看"的缝）。
	TextGradient *Gradient `json:"textGradient,omitempty"`
	// TextReveal（2026-11-18，设计批 2）：逐词成句动效。builder 把 text 按
	// 空白切成 inline-block 词 span，每个词依次 rise（上浮+淡入）或 pop
	// （缩放+淡入）。为什么不是"多个 text 元素"：词距/换行/对齐由浏览器排，
	// 作者只写一句话；为什么不是逐字：中文标题逐字会碎，逐词是排版单元。
	TextReveal *TextReveal `json:"textReveal,omitempty"`
	Opacity    float64     `json:"opacity,omitempty"`
	Radius     *float64    `json:"radius,omitempty"`
	Gradient   *Gradient   `json:"gradient,omitempty"`

	Animations []ElementAnimation `json:"animations,omitempty"`
}

// TextShadow is one text-shadow declaration. Colors go through
// validCSSColorRe at write time (the builder concatenates the values into a
// style declaration).
//
//	text-shadow: Xpx Ypx BlurPx Color
//
// With X=Y=0 and a wide blur the same shape expresses a neon glow; the
// author adds a second, offset element for a hard drop shadow.
type TextShadow struct {
	Color string  `json:"color,omitempty"`
	X     float64 `json:"x,omitempty"`
	Y     float64 `json:"y,omitempty"`
	Blur  float64 `json:"blur,omitempty"`
}

// TextReveal is the word-level entrance choreography for a text element
// (2026-11-18, design batch 2). The builder splits the element's Text on
// whitespace into inline-block spans and plays one tween per word with a
// fixed stagger — the "sentence builds itself" look that used to require one
// text element per word (which loses natural wrapping and alignment).
//
// Styles:
//
//	rise — top: Distance → 0 (relative offset, NO transform) + opacity 0 → 1
//	       — the premium default and the only style that composes with
//	       textGradient (span transforms break background-clip:text)
//	pop  — scale: 0.62 → 1 (about the word's center) + opacity 0 → 1
//
// Determinism: every word gets a zero-duration set at t=0 carrying the start
// state, so a backwards seek before a word's tween re-applies exactly the
// hidden state (the same mechanism the element visibility windows use).
type TextReveal struct {
	Style string `json:"style"` // rise|pop
	// Split selects the reveal unit (2026-11-18, design batch 3):
	//   ""/words — one unit per whitespace-separated word (default)
	//   chars    — one unit per character, grouped inside word wrappers so
	//              natural wrapping still works. Latin display type only:
	//              CJK titles read as confetti per character.
	Split          string  `json:"split,omitempty"`
	AtFrame        *int    `json:"atFrame,omitempty"`        // default 0
	DurationFrames int     `json:"durationFrames,omitempty"` // per word, default 12
	StaggerFrames  int     `json:"staggerFrames,omitempty"`  // delay between words, default 3
	Easing         string  `json:"easing,omitempty"`         // default power3.out
	Distance       float64 `json:"distance,omitempty"`       // rise offset px, default 44
}

// Gradient is a CSS gradient fill for shape elements. Type selects the
// primitive:
//
//	linear — Angle in CSS degrees (0 = to top, 90 = to right, 180 = to bottom)
//	radial — centered at (AtX%, AtY%) of the element box, default 50/50
//
// Stops are offset (0..1) + color, at most MaxGradientStops entries, with
// non-decreasing offsets. Every color passes validCSSColorRe because the
// builder splices them into a style declaration.
type Gradient struct {
	Type  string         `json:"type"`            // linear|radial
	Angle float64        `json:"angle,omitempty"` // linear only
	AtX   float64        `json:"atX,omitempty"`   // radial only, percent (default 50)
	AtY   float64        `json:"atY,omitempty"`   // radial only, percent (default 50)
	Stops []GradientStop `json:"stops"`
}

// GradientStop is one color stop of a Gradient.
type GradientStop struct {
	Offset float64 `json:"offset"` // 0..1
	Color  string  `json:"color"`
}

// BeatGrid is the composition's musical grid (2026-11-18, hypit-inspired
// temporal model). BPM + a downbeat phase define the beat map; Bars bounds the
// legal bar range; Moments name semantic points (the hypit `@claim!` idea):
// layers attach by name so "the title lands on the title-hit" survives a BPM or
// tempo change without touching any frame number.
//
// Frame math (single source): beatFrame = PhaseFrame + round((bar*4 + beat) *
// 60/BPM * fps). The projector resolves every BeatRef through this formula;
// audio tooling reads the same block from the IR.
type BeatGrid struct {
	BPM        float64      `json:"bpm"`
	PhaseFrame int          `json:"phaseFrame,omitempty"` // downbeat offset (frames)
	Bars       int          `json:"bars,omitempty"`       // composition length in bars
	Moments    []BeatMoment `json:"moments,omitempty"`
}

// BeatMoment is one named semantic point on the grid. Two addressing modes
// (exactly one):
//
//	bar+beat — musical position (fractional beats allowed: 3.5 = the "and" of 3)
//	word     — a narration word anchor (text + occurrence). This is hypit's
//	           "anchored to words instead of seconds": the moment follows the
//	           spoken word, so re-voicing the script moves every layer attached
//	           to it. Resolution reads ir.Words' start times.
type BeatMoment struct {
	ID   string  `json:"id"`
	Bar  int     `json:"bar,omitempty"`
	Beat float64 `json:"beat,omitempty"`
	Word *Anchor `json:"word,omitempty"`
}

// BeatRef anchors an animation/effect on the musical grid instead of a frame
// number. Exactly one addressing mode: a named Moment, or an explicit
// (bar, beat). OffsetFrames nudges off the grid (e.g. an 8th-note tail that
// rounds to +7 frames). Resolution writes AtFrame so the projected document
// stays a flat frame timeline (the builder needs no beat awareness).
type BeatRef struct {
	Moment       string   `json:"moment,omitempty"`
	Bar          *int     `json:"bar,omitempty"`
	Beat         *float64 `json:"beat,omitempty"`
	OffsetFrames int      `json:"offsetFrames,omitempty"`
}

// BeatFrame resolves one BeatRef to an absolute frame. The formula is the
// SINGLE source of beat math (projector resolution, validation agreement
// checks and external audio tooling all read beats the same way):
//
//	bar/beat moment or ref: frame = PhaseFrame + round((bar*4 + beat) * 60/BPM * fps) + OffsetFrames
//	word moment:            frame = round(word.start * fps) + OffsetFrames
func BeatFrame(ir *IR, ref *BeatRef) (int, error) {
	if ir == nil || ir.Beats == nil {
		return 0, fmt.Errorf("beat anchor used without a beats grid")
	}
	if ref == nil {
		return 0, fmt.Errorf("nil beat ref")
	}
	g := ir.Beats
	var frame int
	switch {
	case ref.Moment != "":
		if ref.Bar != nil || ref.Beat != nil {
			return 0, fmt.Errorf("beat ref must name a moment OR a (bar,beat), not both")
		}
		m := g.Moment(ref.Moment)
		if m == nil {
			return 0, fmt.Errorf("unknown beat moment %q", ref.Moment)
		}
		f, err := momentFrame(ir, m)
		if err != nil {
			return 0, err
		}
		frame = f
	case ref.Bar != nil && ref.Beat != nil:
		f, err := beatFrameAt(g, &ir.Meta, *ref.Bar, *ref.Beat)
		if err != nil {
			return 0, err
		}
		frame = f
	default:
		return 0, fmt.Errorf("beat ref needs a moment or both bar and beat")
	}
	frame += ref.OffsetFrames
	if frame < 0 {
		frame = 0
	}
	return frame, nil
}

// momentFrame resolves one moment (bar/beat or word anchor).
func momentFrame(ir *IR, m *BeatMoment) (int, error) {
	if m.Word != nil {
		w := findWord(ir.Words, m.Word)
		if w == nil {
			return 0, fmt.Errorf("moment %q: word %q not found in the script words", m.ID, m.Word.Text)
		}
		return int(math.Round(w.Start * float64(ir.Meta.FPS))), nil
	}
	return beatFrameAt(ir.Beats, &ir.Meta, m.Bar, m.Beat)
}

// beatFrameAt is the bar/beat leg of the formula.
func beatFrameAt(g *BeatGrid, meta *Meta, bar int, beat float64) (int, error) {
	if g == nil || g.BPM <= 0 {
		return 0, fmt.Errorf("beats.bpm must be > 0")
	}
	return g.PhaseFrame +
		int(math.Round((float64(bar)*4+beat)*(60.0/g.BPM)*float64(meta.FPS))), nil
}

// findWord locates the nth occurrence of an anchor's text (same matching rules
// as the word-anchor resolution: exact token, else contained).
func findWord(words []Word, a *Anchor) *Word {
	if a == nil || a.Text == "" {
		return nil
	}
	occ := 0
	for i := range words {
		if words[i].Text == a.Text {
			if occ == a.Occurrence {
				return &words[i]
			}
			occ++
		}
	}
	for i := range words {
		if strings.Contains(words[i].Text, a.Text) {
			if occ == a.Occurrence {
				return &words[i]
			}
			occ++
		}
	}
	return nil
}

// Moment returns the named moment or nil.
func (g *BeatGrid) Moment(id string) *BeatMoment {
	if g == nil {
		return nil
	}
	for i := range g.Moments {
		if g.Moments[i].ID == id {
			return &g.Moments[i]
		}
	}
	return nil
}

// ResolveBeats writes AtFrame for every AtBeat anchor (element animations and
// effects). Projection calls this before mapping elements, so the builder and
// every downstream consumer stay on flat frame numbers — beat awareness lives
// entirely on the authoring side. Idempotent; Validate enforces that a
// pre-existing AtFrame agrees with the grid (double-validate stays clean).
func ResolveBeats(ir *IR) error {
	if ir == nil || ir.Beats == nil {
		return nil
	}
	for i := range ir.Elements {
		animations := ir.Elements[i].Animations
		for j := range animations {
			an := &animations[j]
			if an.AtBeat == nil {
				continue
			}
			f, err := BeatFrame(ir, an.AtBeat)
			if err != nil {
				return fmt.Errorf("elements[%d].animations[%d].atBeat: %w", i, j, err)
			}
			frame := f
			an.AtFrame = &frame
		}
	}
	for i := range ir.Effects {
		fx := &ir.Effects[i]
		if fx.AtBeat == nil {
			continue
		}
		f, err := BeatFrame(ir, fx.AtBeat)
		if err != nil {
			return fmt.Errorf("effects[%d].atBeat: %w", i, err)
		}
		frame := f
		fx.AtFrame = &frame
	}
	return nil
}

// AudioTrack references one audio object in storagex by key.
//
// Volume semantics (2026-11-17 P1 fix): the field is `omitempty`, so JSON
// cannot distinguish "explicitly 0" from "absent" — and an absent field
// unmarshals to the Go zero value 0. Before the fix, the render pipeline
// assigned Voice.Volume unconditionally, so every track written without a
// volume (the TTS assembly path did exactly that) rendered at volume=0 —
// a silent track, silently. Resolution is centralized in
// ResolveAudioVolumes: 0 (absent) means "use the track default of 1.0";
// a genuine mute is not expressible in v1 and will be a v2 concern (v2
// makes volume required and explicit). AudioTrack.Volume is validated to
// the 0-1 range at write time, so 0 is the only ambiguous value.
type AudioTrack struct {
	Key         string  `json:"key,omitempty"`
	DurationSec float64 `json:"durationSec,omitempty"`
	Volume      float64 `json:"volume,omitempty"`
}

// Audio is the voice/bgm pair of the composition.
type Audio struct {
	Voice *AudioTrack `json:"voice,omitempty"`
	BGM   *AudioTrack `json:"bgm,omitempty"`
}

// ResolveAudioVolumes is the SINGLE source of the effective voice/bgm
// gain (mixer-side). A nil IR, nil track, or zero Volume resolves to the
// default 1.0 — see the AudioTrack volume-semantics comment for why zero
// cannot mean "muted" in v1. Callers must NOT read AudioTrack.Volume
// directly for mixing (the TTS-write path leaves it unset by design).
func ResolveAudioVolumes(ir *IR) (voice, bgm float64) {
	const def = 1.0
	voice, bgm = def, def
	if ir == nil || ir.Audio == nil {
		return voice, bgm
	}
	if ir.Audio.Voice != nil && ir.Audio.Voice.Volume > 0 {
		voice = ir.Audio.Voice.Volume
	}
	if ir.Audio.BGM != nil && ir.Audio.BGM.Volume > 0 {
		bgm = ir.Audio.BGM.Volume
	}
	return voice, bgm
}

// IRSchemaVersion is the contract version of the IR document itself
// (v2.0 §5.1 / delivery audit A-item): the row-level project version (the
// optimistic lock) lives in video_project.version and is NOT part of the
// document — the two numbers must never be conflated. Readers accept the
// current schema; documents persisted before the schemaVersion field
// existed (and legacy documents still embedding the row-level `version`)
// are stamped/stripped by normalizeSchema on read and on write.
const IRSchemaVersion = 1

// IR is the full intermediate representation persisted in video_project.ir.
// It deliberately has NO row-version field: before the cleanup, a stale
// embedded `version` coexisted with video_project.version (two truths that
// drift); normalizeSchema strips the legacy key from old documents.
type IR struct {
	SchemaVersion int       `json:"schemaVersion"`
	Meta          Meta      `json:"meta"`
	Script        string    `json:"script"`
	Words         []Word    `json:"words"`
	Effects       []Effect  `json:"effects"`
	Elements      []Element `json:"elements"`
	// FontAssets（2026-11-17，品牌字体进 IR）：omitempty 让存量文档零变化——
	// 无字体的 IR 序列化字节不变（回归硬规则）。Family 需在投影时唯一（校验
	// 拒绝重复），Key 走 validateAssetRefs 的登记检查（同 image src）。
	FontAssets []FontAsset `json:"fontAssets,omitempty"`
	// Beats（2026-11-18，hypit 时序模型借鉴）：音乐网格是**一等语义**——动画/
	// 特效用 atBeat 引用"第几小节第几拍"或命名 moment，投影时统一解析成帧。
	// IR 里存语义、不存绝对帧：换 BPM / 改段落长度只改这一处，画面与音轨
	// （读同一份 IR）天然不漂移。与 hypit 的 TemporalInstant 同构：ref + offset。
	Beats   *BeatGrid           `json:"beats,omitempty"`
	Audio   *Audio              `json:"audio,omitempty"`
	unknown map[string]struct{} // reserved: read-time tolerance marker
}

// normalizeSchema stamps the current schema version and removes the legacy
// row-level `version` key from documents persisted before the cleanup.
// Cheap enough to call on every read and before every persist, so any
// document becomes clean the next time it is written regardless of age.
func (ir *IR) normalizeSchema() {
	ir.SchemaVersion = IRSchemaVersion
	delete(ir.unknown, "version")
}

// Limits (docs plan §4.2.2).
const (
	MaxScriptChars = 5000
	MaxWords       = 2000
	MaxEffects     = 128
	// 200（2026-11-18 第二次上调，原 128←64）：gallery 展示片批（19 件作品）
	// 用满"贴纸+落点星芒+4 颗粒子"的全套落件反馈后需要 171 元素；真正的资源
	// 闸门仍是 IR 总量（256KiB，该片 132KiB）与单图尺寸，元素数只是粗代理。
	// 前两次上调的依据同此：v4-assembly 66 元素撞 64、本批 171 撞 128。
	MaxElements = 200
	// 32（2026-11-17 上调，原 16）：进度条类编排单元素 15 段 resize + 淡出即满 16
	// （versus 试点只能拆 30 个手算 shape 绕过）；与 MaxElements 同理，计数只是
	// 粗代理，真正的资源闸门是 IR 总量。
	MaxAnimationsPerElement = 32
	MaxIRBytes              = 256 << 10 // 256 KiB
	// MaxFontAssets（2026-11-17）：品牌字体条目上限。每条只是一对
	// key/family 字符串（字体字节本体在 storagex，不进 IR），上限防的是
	// 注册表膨胀，不是资源——与 MaxElements 同理的粗代理。
	MaxFontAssets = 16
	// MaxGradientStops（2026-11-18，设计批）：单渐变最多 8 个色标。CSS 本身
	// 不设限，8 是"够用且有界"的粗代理（典型 backdrop = 2-3 个）。
	MaxGradientStops = 8
)

// 18/20（2026-11-17 新增，11 片复刻摩擦）：原片素材大量来自 20fps 录制
// （speedrun/rain/disaster 三片全是），复刻被迫升 30fps 平白多付 50% 帧成本；
// 18fps 是逐帧手绘/低帧率动画常见档。两档都是 capx 渲染时钟可整除的档位。
var validFPS = map[int]bool{18: true, 20: true, 24: true, 25: true, 30: true, 50: true, 60: true}

var validEffects = map[string]bool{
	EffectPulse: true, EffectCounter: true, EffectHighlight: true,
	EffectShake: true, EffectFade: true, EffectGlow: true,
}

var validElementTypes = map[string]bool{ElementImage: true, ElementText: true, ElementShape: true}

var validAnimationTypes = map[string]bool{
	"move": true, "scaleIn": true, "rotate": true,
	"fadeIn": true, "fadeOut": true, // P0-2: element-level opacity animation
	// resize: width/height tween anchored top-left (progress-bar semantics:
	// width grows rightward, height grows downward) — versus-pilot horizontal
	// progress bars had to be hand-split into 30 static shapes without it.
	// From/To Points carry (w,h) px pairs; both required at write time.
	"resize": true,
	// groupScale (2026-11-18, design batch 2): scale about a shared CANVAS
	// pivot. Same (FromValue,ToValue) scale scalars as scaleIn; the pivot
	// field carries the canvas point. N elements with identical pivot+timing
	// = a group camera move without a scene graph.
	"groupScale": true,
	// tilt (2026-11-18, design batch 4): 3D rotationX/rotationY about a shared
	// canvas pivot. From/To Points carry (rotateXdeg, rotateYdeg) — the same
	// "two scalars in one Point" reuse groupScale's pivot semantics needs.
	// #canvas carries a CSS perspective, so N elements sharing pivot+angles
	// compose into ONE rigid 3D group rotation (every child is projected
	// through the same perspective matrix). ±1–2° reads as a breathing
	// diorama; anything past ~6° starts to shear visibly.
	"tilt": true,
}

var validEasings = map[string]bool{
	"linear": true, "power1.out": true, "power2.out": true, "power3.out": true,
	"back.out": true, "expo.out": true,
	// power2.inOut（2026-11-17 新增，11 片复刻摩擦）：builder 的 pulse 特效
	// 第二腿早已写死 'power2.inOut'（GSAP 原生缓动）——v1 隐性 bug：特效内部
	// 用的值本就不在校验白名单里，作者侧却无法显式选用同一族缓动。转正它。
	"power2.inOut": true,
}

var validWordSources = map[string]bool{
	WordSourceTTS: true, WordSourceAligner: true, WordSourceManual: true, WordSourceEstimated: true,
}

// validTextAligns（2026-11-18，设计批）：textAlign 白名单——builder 直接写
// node.style.textAlign，未知值是静默 no-op。
var validTextAligns = map[string]bool{"left": true, "center": true, "right": true}

// validGradientTypes（2026-11-18，设计批）：shape 渐变的两条 CSS 原语。
var validGradientTypes = map[string]bool{"linear": true, "radial": true}

// validCSSColorRe accepts exactly the color forms the styling layer documents:
// #rgb / #rrggbb / #rrggbbaa and rgb()/rgba() with numeric channels. Gradient
// stops, stroke colors and text-shadow colors are concatenated into a style
// declaration (unlike the legacy Color field, which is assigned through a
// single style property), so free text would be a CSS injection surface.
var validCSSColorRe = regexp.MustCompile(
	`^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(\s*[0-9]{1,3}\s*,\s*[0-9]{1,3}\s*,\s*[0-9]{1,3}\s*(?:,\s*(?:0|1|0?\.[0-9]+)\s*)?\))$`)

// ValidationError carries the offending field path so HTTP maps it to
// E_VIDEO_IR_INVALID + details.field and MCP surfaces the same detail.
type ValidationError struct {
	Field string
	Msg   string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Msg }

func ve(field, msg string) error { return &ValidationError{Field: field, Msg: msg} }

// Validate enforces every write-time rule of §4.2.2. Failures are hard 400s /
// MCP errors — write-time strict, read-time tolerant is the split.
func Validate(ir *IR) error {
	if ir == nil {
		return ve("", "ir is required")
	}
	if err := validateMeta(&ir.Meta); err != nil {
		return err
	}
	if utf8.RuneCountInString(ir.Script) > MaxScriptChars {
		return ve("script", fmt.Sprintf("script exceeds %d characters", MaxScriptChars))
	}
	if len(ir.Words) > MaxWords {
		return ve("words", fmt.Sprintf("words exceeds %d entries", MaxWords))
	}
	for i := range ir.Words {
		w := &ir.Words[i]
		if w.Start < 0 || w.End <= w.Start {
			return ve(fmt.Sprintf("words[%d]", i), "start must be >= 0 and end > start")
		}
		if !validWordSources[w.Source] {
			return ve(fmt.Sprintf("words[%d].source", i), "source must be tts|aligner|manual|estimated")
		}
		if i > 0 {
			prev := &ir.Words[i-1]
			if w.Start < prev.Start || (w.Start < prev.End && w.End > prev.Start) {
				return ve(fmt.Sprintf("words[%d]", i), "words must be monotonically increasing and non-overlapping")
			}
		}
	}
	if len(ir.Effects) > MaxEffects {
		return ve("effects", fmt.Sprintf("effects exceeds %d entries", MaxEffects))
	}
	for i := range ir.Effects {
		fx := &ir.Effects[i]
		if fx.ID == "" {
			return ve(fmt.Sprintf("effects[%d].id", i), "id is required")
		}
		if !validEffects[fx.Type] {
			return ve(fmt.Sprintf("effects[%d].type", i), "type must be one of the registered effects (pulse|counter|highlight|shake|fade|glow)")
		}
		// atFrame (effect-side twin of ElementAnimation.AtFrame, same rules):
		// mutually exclusive with the word anchor; the anchor-text requirement
		// only applies to word-anchored effects (an atFrame effect needs no
		// word, which is the point — speedrun's zero-word timer). Bounded by
		// DurationFrames with the window-style <= allowance (== F legal).
		if fx.AtFrame != nil {
			if fx.Anchor.Text != "" || fx.Anchor.Occurrence != 0 {
				return ve(fmt.Sprintf("effects[%d].atFrame", i), "atFrame and anchor are mutually exclusive")
			}
			if *fx.AtFrame < 0 {
				return ve(fmt.Sprintf("effects[%d].atFrame", i), "atFrame must be >= 0")
			}
			maxFrames := DurationFrames(ir, ir.Meta.FPS)
			if *fx.AtFrame > maxFrames {
				return ve(fmt.Sprintf("effects[%d].atFrame", i),
					fmt.Sprintf("atFrame must be <= durationFrames (%d)", maxFrames))
			}
		} else if fx.Anchor.Text == "" {
			return ve(fmt.Sprintf("effects[%d].anchor.text", i), "anchor text is required (or set atFrame for a wordless frame anchor)")
		} else if fx.Anchor.Occurrence < 0 {
			return ve(fmt.Sprintf("effects[%d].anchor.occurrence", i), "occurrence must be >= 0")
		}
		if fx.Type == EffectGlow && fx.TargetElementID == "" {
			return ve(fmt.Sprintf("effects[%d].targetElementId", i),
				"glow requires a targetElementId (it animates that element's text-shadow)")
		}
		if err := validateEffectParams(fx.Type, fx.Params); err != nil {
			return err
		}
	}
	if len(ir.Elements) > MaxElements {
		return ve("elements", fmt.Sprintf("elements exceeds %d entries", MaxElements))
	}
	// element ids are the reference target of effect.targetElementId — build
	// the set once, validate every effect reference against it (write-time:
	// a dangling reference is a hard 400 E_VIDEO_IR_INVALID).
	elementIDs := make(map[string]bool, len(ir.Elements))
	for i := range ir.Elements {
		elementIDs[ir.Elements[i].ID] = true
	}
	for i := range ir.Effects {
		if fx := &ir.Effects[i]; fx.TargetElementID != "" && !elementIDs[fx.TargetElementID] {
			return ve(fmt.Sprintf("effects[%d].targetElementId", i),
				"targetElementId must reference an existing element id ("+fx.TargetElementID+" not found)")
		}
	}
	for i := range ir.Elements {
		if err := validateElement(i, &ir.Elements[i], &ir.Meta, ir); err != nil {
			return err
		}
	}
	if err := validateBeats(ir); err != nil {
		return err
	}
	if err := validateAudio(ir.Audio); err != nil {
		return err
	}
	if err := validateFontAssets(ir.FontAssets); err != nil {
		return err
	}
	// voice duration must cover the last word (audit C5): word timestamps
	// running past the audio would truncate on render.
	if ir.Audio != nil && ir.Audio.Voice != nil && ir.Audio.Voice.DurationSec > 0 && len(ir.Words) > 0 {
		last := ir.Words[len(ir.Words)-1]
		if last.End > ir.Audio.Voice.DurationSec+1e-6 {
			return ve("audio.voice.durationSec",
				fmt.Sprintf("voice duration (%.2fs) is shorter than the last word end (%.2fs)", ir.Audio.Voice.DurationSec, last.End))
		}
	}
	b, err := json.Marshal(ir)
	if err != nil {
		return ve("", "ir is not marshalable: "+err.Error())
	}
	if len(b) > MaxIRBytes {
		return ve("", fmt.Sprintf("ir exceeds %d KiB", MaxIRBytes>>10))
	}
	return nil
}

func validateMeta(m *Meta) error {
	if m.FPS == 0 {
		m.FPS = 30 // default per §4.2.2
	}
	if !validFPS[m.FPS] {
		return ve("meta.fps", "fps must be one of 18|20|24|25|30|50|60")
	}
	if m.Width < 360 || m.Width > 2160 {
		return ve("meta.width", "width must be within 360-2160")
	}
	if m.Height < 360 || m.Height > 2160 {
		return ve("meta.height", "height must be within 360-2160")
	}
	if m.DurationSec <= 0 {
		return ve("meta.durationSec", "durationSec must be > 0")
	}
	// Upper bound: camera work, the snapshot walk and the render all scale
	// with this number, so an unbounded value let one write occupy the (single)
	// browser slot for an arbitrarily long time (delivery audit P2).
	if m.DurationSec > MaxRenderDurationSec {
		return ve("meta.durationSec",
			fmt.Sprintf("durationSec must be <= %d (10 minutes)", MaxRenderDurationSec))
	}
	return nil
}

func validateEffectParams(typ string, params json.RawMessage) error {
	if len(params) == 0 || string(params) == "null" {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(params, &m); err != nil {
		return ve("effects.params", "params must be a JSON object")
	}
	// params are type-validated: known keys only, numeric where the builder
	// expects numbers, string where it expects text. The builder falls back on
	// truthiness (`params.scale || 1.2`), so a wrong type used to pass the
	// write gate and then be silently ignored at render time — the agent got a
	// 200 and a film that disagreed with its intent (delivery audit P2).
	allowed := map[string]string{} // key → "number" | "string"
	switch typ {
	case EffectPulse:
		allowed["scale"] = "number"
	case EffectCounter:
		allowed["from"] = "number"
		allowed["to"] = "number"
		allowed["suffix"] = "string"
		allowed["color"] = "string"
		// format/decimals（2026-11-17，11 片复刻摩擦）：speedrun 的毫秒计时器
		// "0:23.87" 在整数 tween + suffix 下不可表达——只能烘 11 张 0.5s 步进
		// 窗口 PNG 近似（4.2s 时点 PSNR 差的主因）。format 是数字格式模板，
		// "{v}" 占位符替换为 toFixed(decimals) 后的值（如 "0:{v}" → "0:23.87"，
		// 字面文本允许）；decimals 是 toFixed 小数位（0 = 整数，兼容旧行为）。
		allowed["format"] = "string"
		allowed["decimals"] = "number"
		// durationFrames（2026-11-18，studio 活计数摩擦）：连续段（from≠to）的
		// 显式时长（帧）。默认启发式 min(1.2, max(0.3, durationSec−at)) 在密集
		// 链上造成段重叠（speedrun 超前显示）且段末 set 落点漂移（studio 滞后
		// 36 帧）——显式时长把控制权交还作者；离散段（from==to）不走 tween，
		// 该参数无意义但容忍传入。
		allowed["durationFrames"] = "number"
	case EffectHighlight:
		allowed["color"] = "string"
	case EffectShake:
		allowed["intensity"] = "number"
	case EffectFade:
		allowed["opacity"] = "number"
	case EffectGlow:
		// 呼吸辉光：blur 在 blurMin..blurMax 之间往复；color 单色（多影层
		// 用重叠元素表达）；periodFrames 一个完整呼吸周期（帧）。
		allowed["color"] = "string"
		allowed["blurMin"] = "number"
		allowed["blurMax"] = "number"
		allowed["periodFrames"] = "number"
	}
	for k, v := range m {
		want, ok := allowed[k]
		if !ok {
			return ve(fmt.Sprintf("effects.params.%s", k), "unknown param for effect type "+typ)
		}
		switch want {
		case "number":
			f, isNum := v.(float64)
			if !isNum || !isFinite(f) {
				return ve(fmt.Sprintf("effects.params.%s", k),
					"must be a finite number (quote-free; strings like \"1.2\" are rejected)")
			}
		case "string":
			if _, isStr := v.(string); !isStr {
				return ve(fmt.Sprintf("effects.params.%s", k), "must be a string")
			}
		}
	}
	return nil
}

func validateElement(i int, el *Element, meta *Meta, ir *IR) error {
	field := fmt.Sprintf("elements[%d]", i)
	if el.ID == "" {
		return ve(field+".id", "id is required")
	}
	if !validElementTypes[el.Type] {
		return ve(field+".type", "type must be image|text|shape")
	}
	if el.Type == ElementImage && el.Src == "" {
		return ve(field+".src", "src is required for image elements")
	}
	// src must be a local storagex key in this domain (SSRF surface narrowed);
	// any absolute URL is rejected at write time.
	if el.Src != "" {
		if strings.Contains(el.Src, "://") || strings.HasPrefix(el.Src, "data:") {
			return ve(field+".src", "src must be a video/<workspace>/ storage key; external URLs are rejected")
		}
		if !strings.HasPrefix(el.Src, "video/") {
			return ve(field+".src", "src must start with video/<workspace_id>/")
		}
	}
	if len(el.Animations) > MaxAnimationsPerElement {
		return ve(field+".animations", fmt.Sprintf("animations exceeds %d per element", MaxAnimationsPerElement))
	}
	for j := range el.Animations {
		an := &el.Animations[j]
		af := fmt.Sprintf("%s.animations[%d]", field, j)
		if an.ID == "" {
			return ve(af+".id", "id is required")
		}
		if !validAnimationTypes[an.Type] {
			return ve(af+".type", "type must be move|scaleIn|rotate|fadeIn|fadeOut|resize")
		}
		if an.DurationFrames <= 0 {
			return ve(af+".durationFrames", "durationFrames must be > 0")
		}
		if an.Easing != "" && !validEasings[an.Easing] {
			return ve(af+".easing", "easing must be one of linear|power1.out|power2.out|power3.out|back.out|expo.out|power2.inOut")
		}
		if an.StartAnchor != nil {
			if an.StartAnchor.Text == "" {
				return ve(af+".startAnchor.text", "anchor text is required")
			}
			if an.StartAnchor.Occurrence < 0 {
				return ve(af+".startAnchor.occurrence", "occurrence must be >= 0")
			}
		}
		// atFrame: explicit frame anchor on the global timeline — the flat v1
		// bridge to the v2 `at:{frame}` object (spec §2.8.1). Mutually
		// exclusive with startAnchor (both set = 400); bounded by the same
		// DurationFrames rule as the element window (== F is legal, mirroring
		// the window's endFrame == F allowance — same clock, same boundary).
		// The ir == nil seam mirrors the window check below (direct unit
		// calls only; Validate always passes a real ir).
		if an.AtFrame != nil {
			if an.StartAnchor != nil {
				return ve(af+".atFrame", "atFrame and startAnchor are mutually exclusive")
			}
			if *an.AtFrame < 0 {
				return ve(af+".atFrame", "atFrame must be >= 0")
			}
			if ir != nil {
				maxFrames := DurationFrames(ir, meta.FPS)
				if *an.AtFrame > maxFrames {
					return ve(af+".atFrame",
						fmt.Sprintf("atFrame must be <= durationFrames (%d)", maxFrames))
				}
			}
		}
		// resize requires BOTH endpoints: From/To Points carry (w,h) px pairs
		// (width or height may stay constant across the tween, but both Points
		// must be present — a half-specified resize is a write-time error, not
		// a silent default). Numeric finiteness is the shared Point check
		// below. Semantics: top-left anchored w/h tween — width grows
		// rightward, height grows downward (progress-bar semantics); unlike
		// move (whose Points are absolute top-left positions in v1), these
		// Points are dimensions. The v2 schema descriptions unify the wording.
		if an.Type == "resize" && (an.From == nil || an.To == nil) {
			return ve(af, "resize requires both from and to (width/height px pairs)")
		}
		// groupScale: scale endpoints are mandatory and the pivot must be a
		// real canvas point — a missing pivot would silently fall back to the
		// element's own center and turn a camera push into N independent
		// zooms (each element drifting its own way).
		if an.Type == "groupScale" {
			if an.FromValue == nil || an.ToValue == nil {
				return ve(af, "groupScale requires fromValue and toValue (scale scalars)")
			}
			if an.Pivot == nil {
				return ve(af+".pivot", "groupScale requires a canvas pivot {x,y}")
			}
			if !isFinite(an.Pivot.X) || !isFinite(an.Pivot.Y) {
				return ve(af+".pivot", "pivot must be finite canvas coordinates")
			}
		}
		// tilt: From/To carry (rotateX°, rotateY°) in the Point fields. The
		// pivot is optional (default 50% 50%); supplying the shared canvas
		// pivot is what turns N elements into one rigid group rotation.
		if an.Type == "tilt" {
			if an.From == nil || an.To == nil {
				return ve(af, "tilt requires from and to points carrying (rotateXdeg, rotateYdeg)")
			}
			if an.Pivot != nil && (!isFinite(an.Pivot.X) || !isFinite(an.Pivot.Y)) {
				return ve(af+".pivot", "pivot must be finite canvas coordinates")
			}
		}
		// NO coordinate clamping exists anywhere (an earlier revision of this
		// comment claimed a projection-time clamp — it never did): out-of-
		// canvas coordinates render as-is and the out-of-canvas part is
		// visually clipped by #stage's overflow:hidden (projector). Here we
		// only reject obviously broken values (NaN/Inf).
		for _, p := range []*Point{an.From, an.To} {
			if p != nil && (!isFinite(p.X) || !isFinite(p.Y)) {
				return ve(af, "animation coordinates must be finite numbers")
			}
		}
	}
	if !isFinite(el.X) || !isFinite(el.Y) || !isFinite(el.W) || !isFinite(el.H) {
		return ve(field, "element geometry must be finite numbers")
	}
	if el.W < 0 || el.H < 0 {
		return ve(field, "element w/h must be >= 0")
	}
	// Element time window (P0-1, case library §5.16 / T-09): non-negative,
	// start ≤ end, bounded by the GLOBAL frame count. The bound uses
	// DurationFrames — the single-source formula (ceil(max(meta, voice) ×
	// fps)) — so a voice-extended timeline extends the legal window too, and
	// frames stay on the same clock as word anchors (§7.0). maxFrames == 0
	// means the caller had no ir to derive it from (never happens from
	// Validate; the seam exists for direct unit calls).
	if el.StartFrame != nil && *el.StartFrame < 0 {
		return ve(field+".startFrame", "startFrame must be >= 0")
	}
	if el.EndFrame != nil && *el.EndFrame < 0 {
		return ve(field+".endFrame", "endFrame must be >= 0")
	}
	if el.StartFrame != nil && el.EndFrame != nil && *el.StartFrame > *el.EndFrame {
		return ve(field, "startFrame must be <= endFrame")
	}
	if ir != nil && (el.StartFrame != nil || el.EndFrame != nil) {
		maxFrames := DurationFrames(ir, meta.FPS)
		// Bound is <= DurationFrames (not < ): valid frames are [0, F-1] and
		// the window is INCLUSIVE of endFrame ([StartFrame+1, EndFrame] — see
		// the Element doc above; the builder's hide set lands at
		// tEnd + 1/(2·fps)), so endFrame == F expresses "visible to the
		// end" and is legal; anything beyond it references a frame past the
		// timeline.
		if el.StartFrame != nil && *el.StartFrame > maxFrames {
			return ve(field+".startFrame",
				fmt.Sprintf("startFrame must be <= durationFrames (%d)", maxFrames))
		}
		if el.EndFrame != nil && *el.EndFrame > maxFrames {
			return ve(field+".endFrame",
				fmt.Sprintf("endFrame must be <= durationFrames (%d)", maxFrames))
		}
	}
	// transformOrigin: keyword/percentage/px CSS values only (the projector
	// splices it into node.style.transformOrigin, so free text is an
	// injection surface AND a silent no-op — the regex accepts exactly the
	// documented forms; anything else names its mistake with examples).
	if el.TransformOrigin != "" && !transformOriginRe.MatchString(el.TransformOrigin) {
		return ve(field+".transformOrigin",
			`must be a CSS transform-origin like "top left", "top center", "50% 0" or "center"`)
	}
	// clip: finite canvas-geometry numbers, positive extents, radius within
	// the round-rect physical bound (a radius past min(W,H)/2 is not a
	// round-rect — the browser would clamp it, so the write gate rejects it
	// instead of silently rendering a different shape than authored).
	if el.Clip != nil {
		cf := field + ".clip"
		c := el.Clip
		if !isFinite(c.X) || !isFinite(c.Y) || !isFinite(c.W) || !isFinite(c.H) || !isFinite(c.Radius) {
			return ve(cf, "clip geometry must be finite numbers")
		}
		if c.W <= 0 || c.H <= 0 {
			return ve(cf+".w", "clip w and h must be > 0")
		}
		if c.Radius < 0 || c.Radius > math.Min(c.W, c.H)/2 {
			return ve(cf+".radius",
				fmt.Sprintf("clip radius must be within 0-%.2f (min(w,h)/2)", math.Min(c.W, c.H)/2))
		}
	}
	// mixBlendMode: whitelist only (the builder splices it into
	// node.style.mixBlendMode; unknown values are a silent CSS no-op).
	if el.MixBlendMode != "" && !validMixBlendModes[el.MixBlendMode] {
		return ve(field+".mixBlendMode",
			"must be one of multiply|screen|overlay|soft-light|hard-light|color-dodge|color-burn|darken|lighten|difference|exclusion|hue|saturation|color|luminosity")
	}
	// ---- Visual styling layer (2026-11-18) ----
	// Text styling: numeric ranges are advisory-CSS, but a silent CSS no-op
	// (negative font size, unregistered family) costs a whole render to find
	// — reject at write time instead.
	if el.FontWeight != 0 && (el.FontWeight < 100 || el.FontWeight > 900) {
		return ve(field+".fontWeight", "must be within 100-900")
	}
	if el.FontSize < 0 {
		return ve(field+".fontSize", "must be >= 0")
	}
	if el.LineHeight != 0 && el.LineHeight <= 0 {
		return ve(field+".lineHeight", "must be > 0 (unitless multiplier, e.g. 1.05)")
	}
	if el.TextAlign != "" && !validTextAligns[el.TextAlign] {
		return ve(field+".textAlign", "must be one of left|center|right")
	}
	// FontFamily must be resolvable: the builtin vendored subset or a family
	// registered in ir.fontAssets. An unregistered family silently falls back
	// to Noto — the exact "looks wrong but renders fine" class of bug the
	// write gate exists to kill (ir may be nil only in direct unit calls).
	if el.FontFamily != "" && ir != nil {
		ok := el.FontFamily == "Noto Sans SC Sub" || el.FontFamily == "Noto Sans SC"
		if !ok {
			for _, fa := range ir.FontAssets {
				if fa.Family == el.FontFamily {
					ok = true
					break
				}
			}
		}
		if !ok {
			return ve(field+".fontFamily",
				"must be a family registered in fontAssets (or \"Noto Sans SC Sub\" for the vendored subset)")
		}
	}
	// Stroke: the two halves are meaningless alone (a color without width
	// paints nothing; a width without color is invalid CSS) — require both
	// or neither.
	if (el.StrokeColor == "") != (el.StrokeWidth == 0) {
		return ve(field+".strokeColor", "strokeColor and strokeWidth must be set together")
	}
	if el.StrokeWidth < 0 {
		return ve(field+".strokeWidth", "must be >= 0")
	}
	if el.StrokeColor != "" && !validCSSColorRe.MatchString(el.StrokeColor) {
		return ve(field+".strokeColor", `must be #rgb/#rrggbb/#rrggbbaa or rgb()/rgba() with numeric channels`)
	}
	if el.TextShadow != nil {
		ts := el.TextShadow
		if !isFinite(ts.X) || !isFinite(ts.Y) || !isFinite(ts.Blur) {
			return ve(field+".textShadow", "x/y/blur must be finite numbers")
		}
		if ts.Blur < 0 {
			return ve(field+".textShadow.blur", "must be >= 0")
		}
		if ts.Color != "" && !validCSSColorRe.MatchString(ts.Color) {
			return ve(field+".textShadow.color", `must be #rgb/#rrggbb/#rrggbbaa or rgb()/rgba() with numeric channels`)
		}
	}
	// Opacity: 0 and absent are both "default 1.0" (omitempty), so only the
	// (0,1] band is meaningful; >1 is a silent CSS clamp, reject it.
	if el.Opacity < 0 || el.Opacity > 1 {
		return ve(field+".opacity", "must be within 0..1 (0/absent = default 1.0)")
	}
	// Shape styling: radius is pointer-typed (radius:0 is legal and distinct
	// from the stylesheet's 8px default); negative/past-half is not a
	// round-rect (same reasoning as clip.radius).
	if el.Radius != nil {
		if !isFinite(*el.Radius) || *el.Radius < 0 {
			return ve(field+".radius", "must be a finite number >= 0")
		}
		if el.W > 0 && el.H > 0 && *el.Radius > math.Min(el.W, el.H)/2 {
			return ve(field+".radius",
				fmt.Sprintf("must be within 0-%.2f (min(w,h)/2)", math.Min(el.W, el.H)/2))
		}
	}
	// TextGradient: same color whitelist as shape gradients, plus the
	// browser-verified incompatibility with stroke (background-clip:text
	// paints the fill UNDER the centered stroke — the outline hollows the
	// glyphs out; see the probe in the design-batch notes).
	if el.TextGradient != nil {
		if el.Type != ElementText {
			return ve(field+".textGradient", "textGradient is only valid on text elements")
		}
		if el.StrokeColor != "" {
			return ve(field+".textGradient",
				"textGradient and strokeColor are mutually exclusive (the stroke paints over the clipped fill and hollows the glyphs)")
		}
		if err := validateGradientShape(el.TextGradient, field+".textGradient"); err != nil {
			return err
		}
	}
	// TextReveal: word/char-level entrance. Only on text, only the two styles,
	// bounded numbers (a negative stagger would run words backwards — legal
	// in GSAP but never intended; reject it).
	if el.TextReveal != nil {
		tr := el.TextReveal
		tf := field + ".textReveal"
		if el.Type != ElementText {
			return ve(tf, "textReveal is only valid on text elements")
		}
		if tr.Style != "rise" && tr.Style != "pop" {
			return ve(tf+".style", "must be rise|pop")
		}
		if tr.Split != "" && tr.Split != "words" && tr.Split != "chars" {
			return ve(tf+".split", "must be words|chars")
		}
		if tr.DurationFrames < 0 || tr.DurationFrames > 120 {
			return ve(tf+".durationFrames", "must be within 0-120")
		}
		if tr.StaggerFrames < 0 || tr.StaggerFrames > 60 {
			return ve(tf+".staggerFrames", "must be within 0-60")
		}
		if tr.Easing != "" && !validEasings[tr.Easing] {
			return ve(tf+".easing", "easing must be one of linear|power1.out|power2.out|power3.out|back.out|expo.out|power2.inOut")
		}
		if !isFinite(tr.Distance) || tr.Distance < 0 || tr.Distance > 400 {
			return ve(tf+".distance", "must be within 0-400 px")
		}
		if tr.AtFrame != nil {
			if *tr.AtFrame < 0 {
				return ve(tf+".atFrame", "atFrame must be >= 0")
			}
			if ir != nil {
				maxFrames := DurationFrames(ir, meta.FPS)
				if *tr.AtFrame > maxFrames {
					return ve(tf+".atFrame", fmt.Sprintf("atFrame must be <= durationFrames (%d)", maxFrames))
				}
			}
		}
	}
	// Gradient: CSS injection surface (stops are concatenated into a style
	// declaration), so every color is whitelist-checked; offsets must be
	// in-range and non-decreasing (CSS would silently reorder them).
	if el.Gradient != nil {
		if err := validateGradientShape(el.Gradient, field+".gradient"); err != nil {
			return err
		}
	}
	return nil
}

// validateGradientShape is the shared write gate for shape gradients and
// text-gradient fills (the only difference is which CSS property the builder
// paints them into).
func validateGradientShape(g *Gradient, gf string) error {
	if !validGradientTypes[g.Type] {
		return ve(gf+".type", "must be linear|radial")
	}
	if len(g.Stops) < 2 {
		return ve(gf+".stops", "a gradient needs at least 2 stops")
	}
	if len(g.Stops) > MaxGradientStops {
		return ve(gf+".stops", fmt.Sprintf("exceeds %d stops", MaxGradientStops))
	}
	prev := -1.0
	for i, st := range g.Stops {
		sf := fmt.Sprintf("%s.stops[%d]", gf, i)
		if !isFinite(st.Offset) || st.Offset < 0 || st.Offset > 1 {
			return ve(sf+".offset", "must be within 0..1")
		}
		if st.Offset < prev {
			return ve(sf+".offset", "stop offsets must be non-decreasing")
		}
		prev = st.Offset
		if !validCSSColorRe.MatchString(st.Color) {
			return ve(sf+".color", `must be #rgb/#rrggbb/#rrggbbaa or rgb()/rgba() with numeric channels`)
		}
	}
	if g.Type == "radial" {
		if !isFinite(g.AtX) || !isFinite(g.AtY) || g.AtX < 0 || g.AtX > 100 || g.AtY < 0 || g.AtY > 100 {
			return ve(gf, "radial atX/atY must be percentages within 0-100")
		}
	}
	if !isFinite(g.Angle) {
		return ve(gf+".angle", "must be a finite number")
	}
	return nil
}

// validateBeats enforces the musical grid shape and every beat anchor's
// agreement with it (2026-11-18, hypit-inspired temporal model).
func validateBeats(ir *IR) error {
	g := ir.Beats
	if g != nil {
		if !isFinite(g.BPM) || g.BPM < 20 || g.BPM > 400 {
			return ve("beats.bpm", "must be within 20-400")
		}
		if g.PhaseFrame < 0 {
			return ve("beats.phaseFrame", "must be >= 0")
		}
		if g.Bars < 0 {
			return ve("beats.bars", "must be >= 0")
		}
		seen := make(map[string]bool, len(g.Moments))
		for i := range g.Moments {
			m := &g.Moments[i]
			bf := fmt.Sprintf("beats.moments[%d]", i)
			if m.ID == "" {
				return ve(bf+".id", "id is required")
			}
			if seen[m.ID] {
				return ve(bf+".id", "duplicate moment id "+m.ID)
			}
			seen[m.ID] = true
			if m.Word != nil {
				if m.Word.Text == "" {
					return ve(bf+".word.text", "word anchor text is required")
				}
				if m.Word.Occurrence < 0 {
					return ve(bf+".word.occurrence", "must be >= 0")
				}
				if findWord(ir.Words, m.Word) == nil {
					return ve(bf+".word", fmt.Sprintf("word %q (occurrence %d) not found in words[]", m.Word.Text, m.Word.Occurrence))
				}
			} else {
				if m.Bar < 0 || (g.Bars > 0 && m.Bar >= g.Bars) {
					return ve(bf+".bar", fmt.Sprintf("bar must be within 0-%d", maxInt(g.Bars-1, 0)))
				}
				if !isFinite(m.Beat) || m.Beat < 0 || m.Beat >= 4 {
					return ve(bf+".beat", "beat must be within 0-4 (fractional allowed)")
				}
			}
		}
	}
	checkRef := func(field string, ref *BeatRef, atFrame *int, anchorSet bool) error {
		if ref == nil {
			return nil
		}
		if g == nil {
			return ve(field, "atBeat requires a beats grid on the IR")
		}
		if anchorSet {
			return ve(field, "atBeat and startAnchor/anchor are mutually exclusive")
		}
		if ref.OffsetFrames < -300 || ref.OffsetFrames > 300 {
			return ve(field+".offsetFrames", "must be within -300..300")
		}
		if ref.Moment == "" && (ref.Bar == nil || ref.Beat == nil) {
			return ve(field, "needs a moment or both bar and beat")
		}
		if ref.Moment != "" && (ref.Bar != nil || ref.Beat != nil) {
			return ve(field, "moment and bar/beat are mutually exclusive")
		}
		if ref.Bar != nil {
			if g.Bars > 0 && (*ref.Bar < 0 || *ref.Bar >= g.Bars) {
				return ve(field+".bar", fmt.Sprintf("bar must be within 0-%d", maxInt(g.Bars-1, 0)))
			}
			if *ref.Bar < 0 {
				return ve(field+".bar", "must be >= 0")
			}
		}
		if ref.Beat != nil && (!isFinite(*ref.Beat) || *ref.Beat < 0 || *ref.Beat >= 4) {
			return ve(field+".beat", "beat must be within 0-4 (fractional allowed)")
		}
		// Always resolve: this is also what proves a named moment exists.
		resolved, err := BeatFrame(ir, ref)
		if err != nil {
			return ve(field, err.Error())
		}
		if atFrame != nil && *atFrame != resolved {
			return ve(field, fmt.Sprintf("atFrame %d disagrees with the beat grid frame %d", *atFrame, resolved))
		}
		return nil
	}
	for i := range ir.Elements {
		els := ir.Elements[i]
		for j := range els.Animations {
			an := &els.Animations[j]
			if an.AtBeat == nil {
				continue
			}
			if err := checkRef(fmt.Sprintf("elements[%d].animations[%d].atBeat", i, j),
				an.AtBeat, an.AtFrame, an.StartAnchor != nil); err != nil {
				return err
			}
		}
	}
	for i := range ir.Effects {
		fx := &ir.Effects[i]
		if fx.AtBeat == nil {
			continue
		}
		anchorSet := fx.Anchor.Text != "" || fx.Anchor.Occurrence != 0
		if err := checkRef(fmt.Sprintf("effects[%d].atBeat", i), fx.AtBeat, fx.AtFrame, anchorSet); err != nil {
			return err
		}
	}
	return nil
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func validateAudio(a *Audio) error {
	if a == nil {
		return nil
	}
	for _, name := range []string{"audio.voice", "audio.bgm"} {
		t := a.Voice
		if name == "audio.bgm" {
			t = a.BGM
		}
		if t == nil {
			continue
		}
		if t.Key == "" {
			return ve(name+".key", "key is required when the track is present")
		}
		if strings.Contains(t.Key, "://") || !strings.HasPrefix(t.Key, "video/") {
			return ve(name+".key", "key must be a video/<workspace_id>/ storage key")
		}
		if t.Volume < 0 || t.Volume > 1 {
			return ve(name+".volume", "volume must be within 0-1")
		}
	}
	return nil
}

// validateFontAssets enforces the write-time shape of the brand-font
// registry: key follows the same storagex video/ prefix rule as image src
// (fonts upload through the same lane); family is required, charset-limited
// (CSS metacharacters would be an injection vector in the projected
// @font-face) and unique (a duplicate family is ambiguous CSS); weight is
// optional but charset-checked for the same reason. The KEY's existence is
// not checked here — it rides validateAssetRefs (registry-or-storage probe,
// same contract as image src / audio keys).
func validateFontAssets(assets []FontAsset) error {
	if len(assets) > MaxFontAssets {
		return ve("fontAssets", fmt.Sprintf("fontAssets exceeds %d entries", MaxFontAssets))
	}
	families := make(map[string]bool, len(assets))
	for i := range assets {
		fa := &assets[i]
		field := fmt.Sprintf("fontAssets[%d]", i)
		if fa.Family == "" {
			return ve(field+".family", "family is required")
		}
		if !validFontFamilyRe.MatchString(fa.Family) {
			return ve(field+".family", "family must match ^[A-Za-z0-9 _-]+$ (no quotes/semicolons — it is spliced into the projected @font-face)")
		}
		if families[fa.Family] {
			return ve(field+".family", "duplicate family "+fa.Family+" (a family may only be registered once)")
		}
		families[fa.Family] = true
		if fa.Key == "" {
			return ve(field+".key", "key is required")
		}
		if strings.Contains(fa.Key, "://") || strings.HasPrefix(fa.Key, "data:") {
			return ve(field+".key", "key must be a video/<workspace_id>/ storage key; external URLs are rejected")
		}
		if !strings.HasPrefix(fa.Key, "video/") {
			return ve(field+".key", "key must start with video/<workspace_id>/")
		}
		if fa.Weight != "" && !validFontFamilyRe.MatchString(fa.Weight) {
			// weight shares the family charset with digits added by the same
			// class — "800" and "400 900" both fit; the check exists to keep
			// CSS metacharacters out of the projected rule.
			return ve(field+".weight", `weight must look like "800" or "400 900" (digits and spaces only)`)
		}
	}
	return nil
}

func isFinite(f float64) bool {
	return !math.IsNaN(f) && !math.IsInf(f, 0)
}

// AnchorResolution is one anchor's outcome of a ResolveAnchors pass, returned
// to callers (agents) so drift is visible immediately after SetScript.
type AnchorResolution struct {
	OwnerID    string `json:"owner_id"` // effect id or elementAnimation id
	Owner      string `json:"owner"`    // "effect" | "animation"
	AnchorText string `json:"anchor_text"`
	WordIndex  int    `json:"word_index"`
	Reason     string `json:"reason"`
}

// anchorCandidates collects every candidate position for an anchor, in
// document order. Type A: a run of consecutive words whose concatenation
// equals the anchor text (multi-token anchors — the normal case with real
// word-level timestamps). Type B: a single word whose text contains the
// anchor (CJK segmentation granularity: estimated chunks are phrase-sized,
// and short anchors like "三倍" live inside one chunk, whose start/end fully
// cover the anchor's time span). A position may qualify both ways; recorded
// once, type A first (finer time span wins).
func anchorCandidates(anchor Anchor, words []Word) []int {
	n := len(words)
	text := anchor.Text
	if text == "" {
		return nil
	}
	seen := map[int]bool{}
	var out []int
	add := func(i int) {
		if !seen[i] {
			seen[i] = true
			out = append(out, i)
		}
	}
	// Type A: concat-equality runs, bounded window (anchors are short).
	const maxRun = 8
	for i := 0; i < n; i++ {
		acc := ""
		for j := i; j < n && j-i < maxRun; j++ {
			acc += words[j].Text
			if acc == text {
				add(i)
				break
			}
			if len(acc) > len(text) {
				break
			}
		}
	}
	// Type B: single-word containment.
	for i := range words {
		if strings.Contains(words[i].Text, text) {
			add(i)
		}
	}
	return out
}

// ResolveAnchors implements the four-step algorithm of §4.2.4 for one anchor:
// exact (a candidate exists; occurrence selects in document order) →
// same_text (occurrence out of range, candidate nearest to prevWordIndex) →
// nearest (no candidate, globally nearest word) → missing (empty word table,
// unresolved). Candidates come from anchorCandidates (concat-equality run
// starts + single-word containment).
func ResolveAnchors(anchor Anchor, words []Word, prevWordIndex int) (wordIndex int, reason string, ok bool) {
	if len(words) == 0 {
		return -1, AnchorMissing, false
	}
	// normalize a possibly-stale prevWordIndex into the current table length
	if prevWordIndex < 0 || prevWordIndex >= len(words) {
		if prevWordIndex > 0 {
			prevWordIndex = prevWordIndex * len(words) / (prevWordIndex + 1)
		}
		if prevWordIndex < 0 {
			prevWordIndex = 0
		}
		if prevWordIndex >= len(words) {
			prevWordIndex = len(words) - 1
		}
	}
	cands := anchorCandidates(anchor, words)
	if len(cands) > 0 {
		if anchor.Occurrence < len(cands) {
			return cands[anchor.Occurrence], AnchorExact, true
		}
		// same_text: occurrence out of range → nearest candidate
		best := cands[0]
		bestDist := abs(best - prevWordIndex)
		for _, i := range cands[1:] {
			if d := abs(i - prevWordIndex); d < bestDist {
				best, bestDist = i, d
			}
		}
		return best, AnchorSameText, true
	}
	// nearest: no candidate → globally nearest word to prevWordIndex
	best, bestDist := 0, abs(0-prevWordIndex)
	for i := 1; i < len(words); i++ {
		if d := abs(i - prevWordIndex); d < bestDist {
			best, bestDist = i, d
		}
	}
	return best, AnchorNearest, true
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// ResolveAll walks every effect and element animation in the IR, resolves its
// anchor against words, writes resolvedFrom back, and returns the resolution
// list (for the caller's audit view). prevIndexes maps owner id → previously
// resolved word index (kept from the old IR so re-resolution after script
// edits measures drift against the old position).
func ResolveAll(ir *IR, prevIndexes map[string]int) []AnchorResolution {
	var out []AnchorResolution
	resolve := func(owner, ownerID string, a Anchor, rf *ResolvedFrom) {
		prev, ok := prevIndexes[ownerID]
		if !ok {
			prev = -1
		}
		idx, reason, ok2 := ResolveAnchors(a, ir.Words, prev)
		if !ok2 {
			*rf = ResolvedFrom{WordIndex: -1, Reason: AnchorMissing}
		} else {
			*rf = ResolvedFrom{WordIndex: idx, Reason: reason}
		}
		out = append(out, AnchorResolution{
			OwnerID: ownerID, Owner: owner, AnchorText: a.Text,
			WordIndex: idx, Reason: reason,
		})
	}
	for i := range ir.Effects {
		fx := &ir.Effects[i]
		// atFrame-anchored effects skip word resolution entirely (the anchor
		// is an explicit frame, not a word — writing a ResolvedFrom would be
		// a fabricated audit trail; the builder keys off atFrame alone).
		if fx.AtFrame != nil {
			continue
		}
		if fx.ResolvedFrom == nil {
			rf := ResolvedFrom{}
			fx.ResolvedFrom = &rf
		}
		resolve("effect", fx.ID, fx.Anchor, fx.ResolvedFrom)
	}
	for i := range ir.Elements {
		el := &ir.Elements[i]
		for j := range el.Animations {
			an := &el.Animations[j]
			if an.StartAnchor == nil {
				continue
			}
			if an.ResolvedFrom == nil {
				rf := ResolvedFrom{}
				an.ResolvedFrom = &rf
			}
			resolve("animation", an.ID, *an.StartAnchor, an.ResolvedFrom)
		}
	}
	return out
}

// PrevWordIndexes extracts the currently-resolved word index per owner id
// (feeds ResolveAll on the next mutation).
func PrevWordIndexes(ir *IR) map[string]int {
	out := map[string]int{}
	for i := range ir.Effects {
		if fx := &ir.Effects[i]; fx.ResolvedFrom != nil {
			out[fx.ID] = fx.ResolvedFrom.WordIndex
		}
	}
	for i := range ir.Elements {
		for j := range ir.Elements[i].Animations {
			an := &ir.Elements[i].Animations[j]
			if an.StartAnchor != nil && an.ResolvedFrom != nil {
				out[an.ID] = an.ResolvedFrom.WordIndex
			}
		}
	}
	return out
}

// EstimateWords splits the script into words and distributes durationSec
// evenly by character count (source=estimated). Punctuation-adjacent runs
// collapse into one word so estimated cues stay readable. Pure function; the
// degrade path when neither TTS nor Aligner is configured.
func EstimateWords(script string, durationSec float64) []Word {
	fields := strings.Fields(script)
	if len(fields) == 0 || durationSec <= 0 {
		return nil
	}
	weights := make([]int, len(fields))
	total := 0
	for i, f := range fields {
		n := utf8.RuneCountInString(f)
		if n == 0 {
			n = 1
		}
		weights[i] = n
		total += n
	}
	out := make([]Word, 0, len(fields))
	cursor := 0.0
	idx := 0
	for i, f := range fields {
		d := durationSec * float64(weights[i]) / float64(total)
		end := cursor + d
		if i == len(fields)-1 {
			end = durationSec // last word closes the duration exactly
		}
		out = append(out, Word{
			Index: idx, Text: f,
			Start: round3(cursor), End: round3(end),
			Source: WordSourceEstimated,
		})
		cursor = end
		idx++
	}
	return out
}

func round3(f float64) float64 {
	return math.Round(f*1000) / 1000
}

// SortWordsByStart orders a word slice by start time (stable), used by
// SetWords ingestion when an agent supplies unordered timestamps.
func SortWordsByStart(words []Word) {
	sort.SliceStable(words, func(i, j int) bool { return words[i].Start < words[j].Start })
}
