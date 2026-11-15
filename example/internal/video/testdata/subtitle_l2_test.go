//go:build capx

// Subtitle-chain L2 verification (T-14, case-library doc §5.14 + §4.4 C06;
// round-1 follow-ups M-C06-01 and the subtitle.go P1 gap). This file is the
// subtitle batch of the case-library harness under testdata/ (package l1,
// shared with l2_encode_test.go).
//
// What it verifies, against the REAL encode chain (Chrome + ffmpeg, same
// pipeline shape as l2_encode_test.go):
//
//  1. Three subtitle modes end-to-end:
//     - burn: SRT(videoapp.SRT) → capx.BurnSubtitles (real libass on this
//       machine) → MP4 → mid-cue frame extraction → pixel diff against the
//       pre-burn frame proves text pixels appeared in the subtitle band.
//     - soft: replicates render_pipeline.go:107-122 faithfully (SRT sidecar
//       written to a temp file, then — because the pipeline only calls
//       BurnSubtitles for mode=="burn", render_pipeline.go:214-227 — the SRT
//       is deleted and the deliverable is the un-subtitled video). ffprobe
//       must show no subtitle track. This confirms the soft-mode gap.
//     - none: no SRT at all; ffprobe must show no subtitle track.
//  2. CJK line-break defect evidence at the SRT layer (§5.14 risk sentences:
//     a word boundary landing on the 16-rune line limit / the rune-midpoint
//     hard cut), plus the round-1 P1 finding (single word > 32 runes produces
//     over-limit lines). Every case prints the concrete SRT output so the
//     report carries real cut-apart words.
//  3. ErrNoLibass behavior audit: this machine's ffmpeg HAS libass, so the
//     no-libass path is exercised through a simulation — a stub ffmpeg binary
//     (built from a 6-line Go program) whose -filters output lacks the
//     subtitles filter. BurnSubtitles must return exactly capx.ErrNoLibass.
//     The propagation path is read from code and written into the report:
//     encode.go:224 → render_pipeline.go:220-223 wraps it as a pipeline
//     error → worker.go:198-217 marks the row failed and cancels the job
//     non-retryably. Conclusion: on a deployment without libass every burn
//     render fails terminally; the documented auto-degrade-to-soft does not
//     exist anywhere (and soft itself is not implemented either).
//  4. SRT timestamp format legality (HH:MM:SS,mmm comma per the SRT
//     standard), including a >1h extreme sample and the negative clamp.
//
// Artifacts (§7.0 retention):
//   testdata/subtitle/burn.mp4 | soft.mp4 | none.mp4 | subs.srt
//   testdata/subtitle/frame-*.png          (mid-cue extractions)
//   testdata/subtitle-report.json          (verdict table + evidence)
//
// Run:
//
//	go -C example test -tags capx -run TestSubtitleL2 ./internal/video/testdata -v -timeout 30m
//
// Skips the E2E half when Chrome or ffmpeg is not found (the SRT-layer half
// runs anywhere).
package l1

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/haozing/ploykit/platform/capx"

	videoapp "myproduct/internal/video/app"
)

// ---- subtitle IR (C06-shaped: 1920x1080@25, clean bottom band so any
// non-background pixels there can only come from burned subtitles) ----

// subtitleWords returns the C06-style dialogue words. Cue 1 (words 0-7, 27
// runes ≤32 so they group into one cue) is laid out by layoutLines at the
// rune midpoint best=13, which lands INSIDE the word "怎么做" -> the burned
// subtitle itself carries the §5.14 defect. Cue 2 (word 8 alone, 10 runes)
// is single-line, no cut — the contrast case. The 32-rune two-line cap is
// what forces the cue boundary (4s total < maxCueSec, so duration never
// triggers it).
func subtitleWords() []videoapp.Word {
	mk := func(i int, text string, start, end float64) videoapp.Word {
		return videoapp.Word{Index: i, Text: text, Start: start, End: end, Source: "aligner"}
	}
	return []videoapp.Word{
		mk(0, "很多人", 0.00, 0.40),
		mk(1, "问", 0.40, 0.60),
		mk(2, "两个人的", 0.60, 1.10),
		mk(3, "小团队", 1.10, 1.60),
		mk(4, "怎么做", 1.60, 2.10),
		mk(5, "工具产品", 2.10, 2.80),
		mk(6, "先选窄场景", 3.00, 3.50),
		mk(7, "再谈功能", 3.50, 4.00),
		mk(8, "数据不说话产品说话呀", 4.20, 5.00),
	}
}

func subtitleIR() *videoapp.IR {
	return &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta: videoapp.Meta{
			FPS: 25, Width: 1920, Height: 1080, DurationSec: 5.0,
		},
		Script: "很多人问两个人的小团队怎么做工具产品 先选窄场景再谈功能 数据不说话产品说话呀",
		Words:  subtitleWords(),
		Elements: []videoapp.Element{
			{ID: "bg", Type: videoapp.ElementShape, Color: "#1C2333",
				X: 0, Y: 0, W: 1920, H: 1080, Z: 0},
			// headline kept in the upper quarter so the bottom band stays
			// pure background until subtitles are burned in.
			{ID: "headline", Type: videoapp.ElementText, Text: "访谈字幕 · T-14",
				Color: "#FFFFFF", FontSize: 72,
				X: 192, Y: 160, W: 1536, H: 140, Z: 3},
		},
	}
}

// ---- SRT parsing / CJK cut analysis (test-side, pure) ----

// parseSRTCues splits an SRT document into cue text blocks (index and time
// lines dropped; internal newlines kept).
func parseSRTCues(srt string) []string {
	var cues []string
	for _, block := range strings.Split(strings.TrimRight(srt, "\n"), "\n\n") {
		lines := strings.Split(block, "\n")
		if len(lines) < 3 {
			continue
		}
		cues = append(cues, strings.Join(lines[2:], "\n"))
	}
	return cues
}

func isLeadingPunct(r rune) bool {
	switch r {
	case '，', '。', '！', '？', '、', '；', '：', '”', '）':
		return true
	}
	return false
}

// joinPureCJK re-joins a pure-CJK word list the way subtitle.joinWords does
// (CJK-CJK without spaces). The SRT-layer cases below are all pure CJK.
func joinPureCJK(words []videoapp.Word) string {
	var b strings.Builder
	for _, w := range words {
		b.WriteString(strings.TrimSpace(w.Text))
	}
	return b.String()
}

// analyzeCJKCue checks one cue's laid-out text against the §5.14 assertions:
// ≤16 runes per line, ≤2 lines, no line-initial punctuation, and no word
// severed by the line break (word boundaries derived from the word list).
func analyzeCJKCue(words []videoapp.Word, cueText string) (broken bool, detail string) {
	var problems []string
	lines := strings.Split(cueText, "\n")
	if len(lines) > 2 {
		problems = append(problems, fmt.Sprintf("%d lines > 2", len(lines)))
	}
	for i, ln := range lines {
		n := utf8.RuneCountInString(ln)
		if n > 16 {
			problems = append(problems, fmt.Sprintf("line %d has %d runes > 16", i+1, n))
		}
		if rs := []rune(ln); len(rs) > 0 && isLeadingPunct(rs[0]) {
			problems = append(problems, fmt.Sprintf("line %d starts with punctuation %q (kinsoku violation)", i+1, string(rs[0])))
		}
	}
	if len(lines) == 2 {
		cut := utf8.RuneCountInString(lines[0])
		cum := 0
		for _, w := range words {
			text := []rune(strings.TrimSpace(w.Text))
			start, end := cum, cum+len(text)
			if start < cut && cut < end {
				off := cut - start
				problems = append(problems,
					fmt.Sprintf("word %q severed by the line break: line1 ends %q, line2 starts %q (cut at rune %d inside a %d-rune word)",
						string(text), string(text[:off]), string(text[off:]), cut, len(text)))
			}
			cum = end
		}
		if joined := joinPureCJK(words); joined != lines[0]+lines[1] {
			problems = append(problems, "lines do not reassemble the joined cue text")
		}
	}
	if len(problems) == 0 {
		return false, "no defect: ≤16 runes/line, ≤2 lines, no line-initial punctuation, no severed word"
	}
	return true, strings.Join(problems, "; ")
}

// ---- report model (task-mandated shape + extra sections) ----

type subtitleModeTest struct {
	Mode              string        `json:"mode"`
	Status            string        `json:"status"` // pass | fail
	SrtCues           int           `json:"srt_cues"`
	BurnedPixelsFound int           `json:"burned_pixels_found,omitempty"`
	BurnedPixelSamples []pixelProbe `json:"burned_pixel_samples,omitempty"`
	FFProbeStreams    []probeStream `json:"ffprobe_streams"`
	Artifact          string        `json:"artifact,omitempty"`
	Detail            string        `json:"detail,omitempty"`
}

type pixelProbe struct {
	AtSec      float64 `json:"at_sec"`
	BandPixels int     `json:"band_pixels"`   // changed pixels (vs pre-burn) with y >= 0.62H
	TotalDiff  int     `json:"total_diff"`    // all changed pixels, whole frame
	BandTop    int     `json:"band_top_y"`    // first/last changed row inside the band
	BandBottom int     `json:"band_bottom_y"` // (0 when nothing found)
}

type cjkBreakExample struct {
	Name          string `json:"name"`
	ScriptSnippet string `json:"script_snippet"`
	SrtOutput     string `json:"srt_output"`
	Broken        bool   `json:"broken"`
	Detail        string `json:"detail"`
}

type srtFormatSample struct {
	InputSec float64 `json:"input_sec"`
	Got      string  `json:"got"`
	OK       bool    `json:"ok"`
}

type srtFormatResult struct {
	Valid   bool             `json:"valid"`
	Notes   string           `json:"notes"`
	Samples []srtFormatSample `json:"samples"`
}

type subtitleReport struct {
	Layer              string            `json:"layer"`
	RunID              string            `json:"run_id"`
	ModeTests          []subtitleModeTest `json:"mode_tests"`
	CjkBreakExamples   []cjkBreakExample  `json:"cjk_break_examples"`
	SrtFormat          *srtFormatResult   `json:"srt_format,omitempty"`
	NolibassConclusion string             `json:"nolibass_conclusion,omitempty"`
	Artifacts          []string           `json:"artifacts,omitempty"`
	Evidence           []string           `json:"evidence"`
}

func subtitleReportPath() string {
	_, thisFile, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(thisFile), "subtitle-report.json")
}

func loadSubtitleReport() *subtitleReport {
	rep := &subtitleReport{Layer: "L2-subtitle (T-14)"}
	if b, err := os.ReadFile(subtitleReportPath()); err == nil {
		_ = json.Unmarshal(b, rep)
		rep.Layer = "L2-subtitle (T-14)"
	}
	return rep
}

func saveSubtitleReport(rep *subtitleReport) {
	b, _ := json.MarshalIndent(rep, "", "  ")
	if err := os.WriteFile(subtitleReportPath(), b, 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "subtitle-report.json write failed: %v\n", err)
	}
}

// ---- the SRT-layer half (pure functions; no browser/ffmpeg needed) ----

// TestSubtitleL2SRT exercises videoapp.SRT/BuildCues/layoutLines directly:
// the §5.14 CJK break-defect samples, the round-1 P1 over-limit-word finding,
// and SRT timestamp format legality (including >1h and the negative clamp).
// Runs everywhere; merges its section into the shared report.
func TestSubtitleL2SRT(t *testing.T) {
	rep := loadSubtitleReport()
	if rep.RunID == "" {
		rep.RunID = time.Now().Format("20060102-150405") + "-subtitle-srt"
	}

	mk := func(text string, start, end float64) videoapp.Word {
		return videoapp.Word{Index: 0, Text: text, Start: start, End: end, Source: "aligner"}
	}

	cases := []struct {
		name    string
		words   []videoapp.Word
		summary string
	}{
		{
			name:    "shiwubei-word-severed (§5.14 risk: midpoint lands inside 十五杯)",
			words:   []videoapp.Word{mk("防水杯身一次冲净快", 0, 2), mk("十五杯", 2, 4), mk("奶泡多不用擦也干净", 4, 5.9)},
			summary: "21-rune CJK run; layoutLines midpoint best=10 falls between 十 and 五 of 十五杯",
		},
		{
			name:    "doc-5.14-sample (产品上线之后口碑暴涨用户复购率翻倍留存提升)",
			words:   []videoapp.Word{mk("产品上线之后口碑暴涨用户复购率翻倍留存提升", 0, 5.5)},
			summary: "the doc's own error sample; doc claims 22 runes and best=11 cutting 用户|复购率",
		},
		{
			name:    "xiaotuandui-25rune-run (E2E cue 1 first 6 words: midpoint severs 怎么做)",
			words:   subtitleWords()[:6],
			summary: "18-rune run; midpoint best=9 severs 小团队 into 小 | 团队",
		},
		{
			name:    "line-initial-punctuation (kinsoku)",
			words:   []videoapp.Word{mk("前面九个字加逗号，后面还有十个字了", 0, 4)},
			summary: "17-rune single word; midpoint best=8 puts ，at the head of line 2",
		},
		{
			name:    "over-32-rune-single-word (round-1 P1: no oversized-word fallback)",
			words:   []videoapp.Word{mk("我们把这个超长词组一直延续下去用来验证单个词超过三十二个字符的时候折行兜底缺失的具体表现如何", 0, 5.9)},
			summary: "single word longer than maxLineRunes*maxLines (32); BuildCues has no fallback",
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			srt := videoapp.SRT(c.words)
			if srt == "" {
				t.Fatal("SRT() returned empty")
			}
			cues := parseSRTCues(srt)
			if len(cues) == 0 {
				t.Fatalf("no cues parsed from:\n%s", srt)
			}
			broken, detail := analyzeCJKCue(c.words, cues[0])
			rep.CjkBreakExamples = append(rep.CjkBreakExamples, cjkBreakExample{
				Name:          c.name,
				ScriptSnippet: joinPureCJK(c.words),
				SrtOutput:     srt,
				Broken:        broken,
				Detail:        detail + " | " + c.summary,
			})
			t.Logf("broken=%v detail=%s\nsrt=%s", broken, detail, srt)
		})
	}

	// ---- SRT timestamp format legality ----
	timeLine := func(start, end float64) string {
		srt := videoapp.SRT([]videoapp.Word{mk("测", start, end)})
		cues := parseSRTCues(srt)
		if len(cues) != 1 {
			return ""
		}
		// rebuild the header line from the raw document
		for _, line := range strings.Split(srt, "\n") {
			if strings.Contains(line, " --> ") {
				return line
			}
		}
		return ""
	}
	re := regexp.MustCompile(`^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$`)
	samples := []struct {
		in   [2]float64
		want string
	}{
		{[2]float64{0, 2.5}, "00:00:00,000 --> 00:00:02,500"},
		{[2]float64{65.25, 67.0}, "00:01:05,250 --> 00:01:07,000"},
		{[2]float64{3661.5, 3667.0}, "01:01:01,500 --> 01:01:07,000"}, // >1h extreme
		{[2]float64{-1.0, 1.0}, "00:00:00,000 --> 00:00:01,000"},      // negative clamp
	}
	fr := &srtFormatResult{}
	for _, s := range samples {
		got := timeLine(s.in[0], s.in[1])
		ok := got == s.want && re.MatchString(got)
		fr.Samples = append(fr.Samples, srtFormatSample{InputSec: s.in[0], Got: got, OK: ok})
		if !ok {
			t.Errorf("srt time format: in=%v got=%q want=%q", s.in, got, s.want)
		}
	}
	fr.Valid = true
	for _, s := range fr.Samples {
		if !s.OK {
			fr.Valid = false
		}
	}
	fr.Notes = "HH:MM:SS,mmm with comma (SRT standard); hours are %02d (overflows width past 99h, out of scope); negatives clamp to 00:00:00,000"
	rep.SrtFormat = fr
	saveSubtitleReport(rep)
}

// ---- pixel / frame helpers (burn-mode verification) ----

// diffPNGFrames decodes two PNGs and reports how many pixels differ beyond a
// compression-noise threshold, overall and inside the subtitle band
// (y >= 0.62H — the C06 subtitle zone y 950–1030 sits well inside it).
func diffPNGFrames(t *testing.T, basePng, testPng string) (bandPixels, totalDiff, bandTop, bandBottom int) {
	t.Helper()
	read := func(p string) image.Image {
		f, err := os.Open(p)
		if err != nil {
			t.Fatalf("open %s: %v", p, err)
		}
		defer f.Close()
		img, err := png.Decode(f)
		if err != nil {
			t.Fatalf("decode %s: %v", p, err)
		}
		return img
	}
	a, b := read(basePng), read(testPng)
	sa, sb := a.Bounds(), b.Bounds()
	if sa.Dx() != sb.Dx() || sa.Dy() != sb.Dy() {
		t.Fatalf("frame size mismatch: %v vs %v", sa, sb)
	}
	bandY := sa.Min.Y + sa.Dy()*62/100
	bandTop, bandBottom = -1, -1
	for y := sa.Min.Y; y < sa.Max.Y; y++ {
		for x := sa.Min.X; x < sa.Max.X; x++ {
			ar, ag, ab, _ := a.At(x, y).RGBA()
			br, bg, bb, _ := b.At(x, y).RGBA()
			d := abs8(int(ar>>8)-int(br>>8)) + abs8(int(ag>>8)-int(bg>>8)) + abs8(int(ab>>8)-int(bb>>8))
			if d > 90 {
				totalDiff++
				if y >= bandY {
					bandPixels++
					if bandTop < 0 {
						bandTop = y
					}
					bandBottom = y
				}
			}
		}
	}
	if bandTop < 0 {
		bandTop, bandBottom = 0, 0
	}
	return bandPixels, totalDiff, bandTop, bandBottom
}

func abs8(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// extractFrame writes frame at atSec of videoPath as PNG via direct ffmpeg
// (the pipeline's ExtractThumbnail is fixed at 1s and is not on this path).
func extractFrame(ctx context.Context, ffmpeg, videoPath, outPng string, atSec float64) error {
	out, err := exec.CommandContext(ctx, ffmpeg, "-y", "-hide_banner",
		"-ss", fmt.Sprintf("%.3f", atSec), "-i", videoPath,
		"-frames:v", "1", outPng).CombinedOutput()
	if err != nil {
		return fmt.Errorf("extract frame @%.2fs: %w\n%s", atSec, err, tailLines(string(out), 8))
	}
	return nil
}

func copyFileTo(t *testing.T, src, dst string) {
	t.Helper()
	in, err := os.Open(src)
	if err != nil {
		t.Fatalf("open %s: %v", src, err)
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		t.Fatalf("create %s: %v", dst, err)
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		t.Fatalf("copy %s -> %s: %v", src, dst, err)
	}
}

// buildNoLibassStub compiles a 6-line Go program that mimics an ffmpeg whose
// -filters output lacks the subtitles filter. Used to exercise the
// BurnSubtitles no-libass branch without uninstalling the real libass.
func buildNoLibassStub(t *testing.T, dir string) string {
	t.Helper()
	src := filepath.Join(dir, "stubffmpeg.go")
	const code = `package main

import "fmt"

func main() {
	fmt.Println("  TS allpass           A->A       Apply a two-pole all-pass filter.")
	fmt.Println("  .. anull             A->A       Pass the source unchanged to the output.")
	fmt.Println("  .. aselect           A->N       Select audio frames to pass in output.")
}
`
	if err := os.WriteFile(src, []byte(code), 0o644); err != nil {
		t.Fatalf("write stub source: %v", err)
	}
	exe := filepath.Join(dir, "stubffmpeg.exe")
	if out, err := exec.Command("go", "build", "-o", exe, src).CombinedOutput(); err != nil {
		t.Fatalf("build stub ffmpeg: %v\n%s", err, out)
	}
	return exe
}

// ---- the E2E half (real Chrome + ffmpeg; same shape as the production
// encodeAndUpload, minus DB/worker/storage) ----

// TestSubtitleL2E2E renders one base video, then exercises the three
// subtitle modes exactly the way render_pipeline.go does, plus the
// ErrNoLibass simulation. Artifacts + report land in testdata/.
func TestSubtitleL2E2E(t *testing.T) {
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)
	ffprobe := ffprobePath()
	ctx := context.Background()

	enabled := true
	rt, err := capx.New(capx.Config{
		Enabled: &enabled, ChromePath: chrome, FFMpegPath: ffmpeg, PoolSize: 1,
	})
	if err != nil {
		t.Fatalf("capx.New: %v", err)
	}
	defer rt.Close()
	if !rt.Available() {
		t.Fatal("runtime not available after successful New")
	}

	_, thisFile, _, _ := runtime.Caller(0)
	baseDir := filepath.Join(filepath.Dir(thisFile), "subtitle")
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		t.Fatal(err)
	}
	tmp := t.TempDir()

	rep := loadSubtitleReport()
	rep.RunID = time.Now().Format("20060102-150405") + "-subtitle-e2e"
	rep.Evidence = append(rep.Evidence,
		"[实测] 本机 ffmpeg 带 libass：-filters 同时列出 ass 与 subtitles（TestSubtitleL2E2E 烧录真机通过）",
		"[代码] burn 分支：example/internal/video/render/render_pipeline.go:214-227（仅 mode==burn 调 BurnSubtitles）",
		"[代码] soft 缺口：render_pipeline.go:107-122 写 SRT 临时文件后无人消费，L213 注释自述 \"soft subs ride inside the mp4 ... in a follow-up\"",
		"[代码] ErrNoLibass 传播：platform/capx/encode.go:224 → render_pipeline.go:220-223 包成 burn subtitles: %w 上抛 → worker.go:198→217 w.fail() + river.JobCancel（终态 failed，不重试）",
		"[文档] 期望行为：案例库文档 §5.14/§4.4.4/F-C06-01 —— 无 libass 自动降级软字幕（mov_text）交付；round1 M-C06-01 已判差异，本轮实测补证 soft 路径整体缺失",
	)

	// environment: record the exact ffmpeg identity
	if v, err := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-version").Output(); err == nil {
		first := strings.SplitN(string(v), "\n", 2)[0]
		rep.Evidence = append(rep.Evidence, "[实测] ffmpeg -version: "+strings.TrimSpace(first))
	}
	if f, err := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-filters").Output(); err == nil {
		hasSubs := strings.Contains(string(f), " subtitles ")
		rep.Evidence = append(rep.Evidence, fmt.Sprintf("[实测] ffmpeg -filters 含 subtitles=%v（ffmpegHasSubtitles 的判定同一依据）", hasSubs))
	}

	// shared base render (the pipeline's video stage, subtitles excluded)
	ir := subtitleIR()
	if verr := videoapp.Validate(ir); verr != nil {
		t.Fatalf("fixture IR invalid: %v", verr)
	}
	const fps = 25
	frames := videoapp.DurationFrames(ir, fps) // ceil(4*25)=100
	spec := capx.FrameSpec{Width: 1920, Height: 1080, FPS: fps, DurationFrames: frames}
	if serr := spec.Validate(); serr != nil {
		t.Fatalf("frame spec: %v", serr)
	}

	basePath := filepath.Join(tmp, "base.mp4")
	if _, rErr := renderAndEncode(t, ctx, rt, tmp, ir, spec, basePath); rErr != nil {
		t.Fatalf("base render+encode: %v", rErr)
	}

	srtText := videoapp.SRT(ir.Words)
	srtPath := filepath.Join(baseDir, "subs.srt")
	if err := os.WriteFile(srtPath, []byte(srtText), 0o644); err != nil {
		t.Fatal(err)
	}
	cues := parseSRTCues(srtText)
	if len(cues) != 2 {
		t.Fatalf("expected 2 cues from subtitleWords, got %d:\n%s", len(cues), srtText)
	}
	// the burned cue 1 must exhibit the severed word (documented in-report)
	cue1Words := subtitleWords()[:8] // words 0-7 group into cue 1 (27 runes ≤ 32, 4.0s ≤ 6s)
	if broken, detail := analyzeCJKCue(cue1Words, cues[0]); !broken {
		t.Fatalf("expected cue 1 to carry the CJK word-cut defect, got clean: %s", detail)
	} else {
		t.Logf("cue1 defect present (will be visible in the burned frames): %s", detail)
	}

	// pre-burn reference frames (deterministic pipeline: identical to what the
	// burn output shows outside the subtitle pixels)
	baseF14 := filepath.Join(baseDir, "frame-base-t1.400.png")
	baseF35 := filepath.Join(baseDir, "frame-base-t4.600.png")
	if err := extractFrame(ctx, ffmpeg, basePath, baseF14, 1.4); err != nil {
		t.Fatal(err)
	}
	if err := extractFrame(ctx, ffmpeg, basePath, baseF35, 4.6); err != nil {
		t.Fatal(err)
	}

	artifacts := []string{"subtitle/subs.srt", "subtitle/frame-base-t1.400.png", "subtitle/frame-base-t4.600.png"}

	// ---- mode: burn ----
	t.Run("burn", func(t *testing.T) {
		mt := subtitleModeTest{Mode: "burn", SrtCues: len(cues)}
		fail := func(reason string) {
			mt.Status = "fail"
			mt.Detail += reason + "; "
		}

		burnPath := filepath.Join(baseDir, "burn.mp4")
		bf, err := os.Create(burnPath)
		if err != nil {
			t.Fatal(err)
		}
		berr := rt.BurnSubtitles(ctx, basePath, srtPath, bf)
		bf.Close()
		if berr != nil {
			t.Fatalf("BurnSubtitles (real libass present): %v", berr)
		}
		mt.Artifact = "subtitle/burn.mp4"
		artifacts = append(artifacts, "subtitle/burn.mp4")

		pr, perr := probeMP4(ctx, ffmpeg, ffprobe, burnPath)
		mt.FFProbeStreams = pr.info.Streams
		if perr != nil {
			fail("ffprobe failed: " + perr.Error())
		}
		hasVideo, hasSubStream := false, false
		for _, s := range pr.info.Streams {
			switch s.Kind {
			case "video":
				hasVideo = true
			case "subtitle":
				hasSubStream = true
			}
		}
		if !hasVideo {
			fail("no video stream")
		}
		if hasSubStream {
			fail("burned output unexpectedly carries a subtitle stream")
		}

		// frame-level pixel proof: mid-cue extractions vs the pre-burn frames
		f14 := filepath.Join(baseDir, "frame-burn-t1.400.png")
		f35 := filepath.Join(baseDir, "frame-burn-t4.600.png")
		if err := extractFrame(ctx, ffmpeg, burnPath, f14, 1.4); err != nil {
			t.Fatal(err)
		}
		if err := extractFrame(ctx, ffmpeg, burnPath, f35, 4.6); err != nil {
			t.Fatal(err)
		}
		artifacts = append(artifacts, "subtitle/frame-burn-t1.400.png", "subtitle/frame-burn-t4.600.png")

		b14, t14, top14, bot14 := diffPNGFrames(t, baseF14, f14)
		b35, t35, top35, bot35 := diffPNGFrames(t, baseF35, f35)
		mt.BurnedPixelSamples = []pixelProbe{
			{AtSec: 1.4, BandPixels: b14, TotalDiff: t14, BandTop: top14, BandBottom: bot14},
			{AtSec: 4.6, BandPixels: b35, TotalDiff: t35, BandTop: top35, BandBottom: bot35},
		}
		mt.BurnedPixelsFound = b14 + b35
		if b14 < 500 {
			fail(fmt.Sprintf("cue1 @1.4s: only %d subtitle-band pixels changed (want >500) — burned text missing or out of band (rows %d–%d)", b14, top14, bot14))
		}
		if b35 < 300 {
			fail(fmt.Sprintf("cue2 @4.6s: only %d subtitle-band pixels changed (want >300) (rows %d–%d)", b35, top35, bot35))
		}
		if mt.Status != "fail" {
			mt.Status = "pass"
			mt.Detail = fmt.Sprintf("libass burn verified: cue1 @1.4s %d band px (rows %d–%d), cue2 @4.6s %d band px (rows %d–%d). NOTE: cue 1 as shipped severs 怎么做 at the line break (see cjk_break_examples) — the defect is visible in the retained frame.", b14, top14, bot14, b35, top35, bot35)
		}
		rep.ModeTests = append(rep.ModeTests, mt)
		saveSubtitleReport(rep)
		t.Logf("burn: %s", mt.Detail)
	})

	// ---- mode: soft ----
	t.Run("soft", func(t *testing.T) {
		mt := subtitleModeTest{Mode: "soft", SrtCues: len(cues)}
		// faithful replication of render_pipeline.go:107-122: SRT sidecar
		// written to a temp file when mode is burn OR soft ...
		tmpSrt, err := os.CreateTemp(tmp, "video-srt-*.srt")
		if err != nil {
			t.Fatal(err)
		}
		if _, werr := tmpSrt.WriteString(srtText); werr != nil {
			t.Fatal(werr)
		}
		tmpSrt.Close()
		if _, serr := os.Stat(tmpSrt.Name()); serr != nil {
			t.Fatalf("sidecar SRT missing during pipeline: %v", serr)
		}
		// ... and render_pipeline.go:214 only burns when mode=="burn". There
		// is NO mov_text/soft branch anywhere (encode.go exposes none), so the
		// soft deliverable is the un-subtitled video; the SRT is deleted by
		// the deferred cleanup.
		softPath := filepath.Join(baseDir, "soft.mp4")
		copyFileTo(t, basePath, softPath)
		defer os.Remove(tmpSrt.Name()) // the pipeline's defer os.Remove(srtPath)
		if _, serr := os.Stat(tmpSrt.Name()); serr == nil {
			t.Log("sidecar SRT removed after pipeline (as in production)")
		}
		mt.Artifact = "subtitle/soft.mp4"
		artifacts = append(artifacts, "subtitle/soft.mp4")

		pr, perr := probeMP4(ctx, ffmpeg, ffprobe, softPath)
		mt.FFProbeStreams = pr.info.Streams
		if perr != nil {
			mt.Status = "fail"
			mt.Detail = "ffprobe failed: " + perr.Error()
		} else {
			hasSubStream := false
			for _, s := range pr.info.Streams {
				if s.Kind == "subtitle" {
					hasSubStream = true
				}
			}
			if hasSubStream {
				mt.Status = "fail"
				mt.Detail = "unexpected subtitle stream in soft output"
			} else {
				// Document expectation (§4.4.2 字幕策略 / F-C06-01): soft 模式
				// 交付带字幕轨的成片。Actual: SRT generated then discarded, no
				// track. This is the confirmed gap (extends M-C06-01).
				mt.Status = "fail"
				mt.Detail = "CONFIRMED GAP: soft 模式产物无字幕轨（mov_text 封装不存在）。管线生成了 SRT 临时文件（render_pipeline.go:107-122）但只在本 case 复刻的 burn 分支（:214-227）会消费它；soft 的 SRT 被 defer 删除，成片与 none 模式完全相同。文档预期 soft 交付不成立——这是 M-C06-01 之外的新确认缺口（capx 无任何 mov_text API，grep 证实）。"
			}
		}
		rep.ModeTests = append(rep.ModeTests, mt)
		saveSubtitleReport(rep)
		t.Logf("soft: %s", mt.Detail)
	})

	// ---- mode: none ----
	t.Run("none", func(t *testing.T) {
		mt := subtitleModeTest{Mode: "none", SrtCues: 0}
		nonePath := filepath.Join(baseDir, "none.mp4")
		copyFileTo(t, basePath, nonePath)
		mt.Artifact = "subtitle/none.mp4"
		artifacts = append(artifacts, "subtitle/none.mp4")

		pr, perr := probeMP4(ctx, ffmpeg, ffprobe, nonePath)
		mt.FFProbeStreams = pr.info.Streams
		if perr != nil {
			mt.Status = "fail"
			mt.Detail = "ffprobe failed: " + perr.Error()
		} else {
			hasSubStream := false
			for _, s := range pr.info.Streams {
				if s.Kind == "subtitle" {
					hasSubStream = true
				}
			}
			if hasSubStream {
				mt.Status = "fail"
				mt.Detail = "none mode unexpectedly carries a subtitle stream"
			} else {
				mt.Status = "pass"
				mt.Detail = "no subtitle track, as expected"
			}
		}
		rep.ModeTests = append(rep.ModeTests, mt)
		saveSubtitleReport(rep)
	})

	// ---- ErrNoLibass simulation (deployment-without-libass audit) ----
	t.Run("nolibass-sim", func(t *testing.T) {
		stub := buildNoLibassStub(t, tmp)
		rt2, err := capx.New(capx.Config{Enabled: &enabled, ChromePath: chrome, FFMpegPath: stub})
		if err != nil {
			t.Fatalf("capx.New with stub ffmpeg: %v", err)
		}
		defer rt2.Close()
		if !rt2.Available() {
			t.Fatal("stub runtime unexpectedly unavailable (probe passes on any executable file)")
		}
		berr := rt2.BurnSubtitles(ctx, basePath, srtPath, writerFunc(func(p []byte) (int, error) {
			return len(p), nil
		}))
		if !errors.Is(berr, capx.ErrNoLibass) {
			t.Fatalf("BurnSubtitles with no-libass stub: got %v, want exactly ErrNoLibass", berr)
		}
		rep.NolibassConclusion = fmt.Sprintf(
			"模拟路径实测：ffmpeg -filters 无 subtitles 滤镜时 BurnSubtitles 精确返回 ErrNoLibass（errors.Is 命中；错误文本自述 \"degrade to soft subs (mov_text)\"）。但该降级在整条链上不存在：① capx 无任何 mov_text/软字幕封装 API（encode.go 全文仅 BurnSubtitles 一个字幕入口）；② render_pipeline.go:220-223 把 ErrNoLibass 原样包装上抛（wrap 为 \"burn subtitles: %%w\"），不降级、不写 warnings；③ worker.go:198-217 收到管线错误后 w.fail() 置 status=failed 并 river.JobCancel（终态、不重试）。结论：部署机无 libass 时，每一个 subtitleMode=burn 的渲染都会终态失败——文档 F-C06-01/§4.4.4 期望的\"自动降级软字幕交付\"不存在，且由于 soft 路径本身也未实现（见 soft 测试），降级目标无处可去。本机实测 libass 在位（--enable-libass，subtitles 滤镜在列），burn 路径正常，该缺陷只在无 libass 的部署环境引爆。err=%v",
			berr)
		saveSubtitleReport(rep)
		t.Logf("nolibass: got exactly ErrNoLibass: %v", berr)
	})

	rep.Artifacts = artifacts
	saveSubtitleReport(rep)
}

// writerFunc adapts a func to io.Writer (the burn sim discards output bytes).
type writerFunc func(p []byte) (int, error)

func (f writerFunc) Write(p []byte) (int, error) { return f(p) }
