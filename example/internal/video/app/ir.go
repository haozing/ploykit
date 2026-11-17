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
type Effect struct {
	ID              string          `json:"id"`
	Anchor          Anchor          `json:"anchor"`
	Type            string          `json:"type"`
	Params          json.RawMessage `json:"params,omitempty"`
	TargetElementID string          `json:"targetElementId,omitempty"`
	ResolvedFrom    *ResolvedFrom   `json:"resolvedFrom,omitempty"`
}

// Point is a 2D canvas coordinate (also used for from/to animation endpoints).
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// ElementAnimation moves/scales/rotates/fades one element, anchored at a word.
type ElementAnimation struct {
	ID             string          `json:"id"`
	Type           string          `json:"type"` // move|scaleIn|rotate|fadeIn|fadeOut
	From           *Point          `json:"from,omitempty"`
	To             *Point          `json:"to,omitempty"`
	FromValue      *float64        `json:"fromValue,omitempty"` // scale/rotate scalar
	ToValue        *float64        `json:"toValue,omitempty"`
	StartAnchor    *Anchor         `json:"startAnchor,omitempty"`
	DurationFrames int             `json:"durationFrames"`
	Easing         string          `json:"easing,omitempty"`
	ResolvedFrom   *ResolvedFrom   `json:"resolvedFrom,omitempty"`
	Extra          json.RawMessage `json:"extra,omitempty"`
}

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

	Animations []ElementAnimation `json:"animations,omitempty"`
}

// AudioTrack references one audio object in storagex by key.
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
	SchemaVersion int                 `json:"schemaVersion"`
	Meta          Meta                `json:"meta"`
	Script        string              `json:"script"`
	Words         []Word              `json:"words"`
	Effects       []Effect            `json:"effects"`
	Elements      []Element           `json:"elements"`
	Audio         *Audio              `json:"audio,omitempty"`
	unknown       map[string]struct{} // reserved: read-time tolerance marker
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
	MaxScriptChars          = 5000
	MaxWords                = 2000
	MaxEffects              = 128
	MaxElements             = 64
	MaxAnimationsPerElement = 16
	MaxIRBytes              = 256 << 10 // 256 KiB
)

var validFPS = map[int]bool{24: true, 25: true, 30: true, 50: true, 60: true}

var validEffects = map[string]bool{
	EffectPulse: true, EffectCounter: true, EffectHighlight: true,
	EffectShake: true, EffectFade: true,
}

var validElementTypes = map[string]bool{ElementImage: true, ElementText: true, ElementShape: true}

var validAnimationTypes = map[string]bool{
	"move": true, "scaleIn": true, "rotate": true,
	"fadeIn": true, "fadeOut": true, // P0-2: element-level opacity animation
}

var validEasings = map[string]bool{
	"linear": true, "power1.out": true, "power2.out": true, "power3.out": true,
	"back.out": true, "expo.out": true,
}

var validWordSources = map[string]bool{
	WordSourceTTS: true, WordSourceAligner: true, WordSourceManual: true, WordSourceEstimated: true,
}

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
			return ve(fmt.Sprintf("effects[%d].type", i), "type must be one of the registered effects (pulse|counter|highlight|shake|fade)")
		}
		if fx.Anchor.Text == "" {
			return ve(fmt.Sprintf("effects[%d].anchor.text", i), "anchor text is required")
		}
		if fx.Anchor.Occurrence < 0 {
			return ve(fmt.Sprintf("effects[%d].anchor.occurrence", i), "occurrence must be >= 0")
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
	if err := validateAudio(ir.Audio); err != nil {
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
		return ve("meta.fps", "fps must be one of 24|25|30|50|60")
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
	case EffectHighlight:
		allowed["color"] = "string"
	case EffectShake:
		allowed["intensity"] = "number"
	case EffectFade:
		allowed["opacity"] = "number"
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
			return ve(af+".type", "type must be move|scaleIn|rotate|fadeIn|fadeOut")
		}
		if an.DurationFrames <= 0 {
			return ve(af+".durationFrames", "durationFrames must be > 0")
		}
		if an.Easing != "" && !validEasings[an.Easing] {
			return ve(af+".easing", "easing must be one of linear|power1.out|power2.out|power3.out|back.out|expo.out")
		}
		if an.StartAnchor != nil {
			if an.StartAnchor.Text == "" {
				return ve(af+".startAnchor.text", "anchor text is required")
			}
			if an.StartAnchor.Occurrence < 0 {
				return ve(af+".startAnchor.occurrence", "occurrence must be >= 0")
			}
		}
		// coordinates clamp to the canvas at projection time; here we only
		// reject obviously broken values (NaN/Inf, negative sizes).
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
		// the window is half-open [startFrame, endFrame) — the hide set lands
		// exactly at endFrame, so endFrame == F expresses "visible to the
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
	return nil
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
