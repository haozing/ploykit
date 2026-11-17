package videoapp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/quota"
)

// --- fake ports (full set) ---

type fakeMembership struct{ allow bool }

func (f fakeMembership) IsMember(_ context.Context, _, _ string) (bool, error) { return f.allow, nil }

func (f fakeMembership) RoleOf(_ context.Context, _, _ string) (string, bool, error) {
	if !f.allow {
		return "", false, nil
	}
	return "admin", true, nil
}

type fakeSynth struct {
	result VoiceResult
	err    error
	calls  int
}

func (f *fakeSynth) Synthesize(_ context.Context, text, _ string, _ float64) (VoiceResult, error) {
	f.calls++
	return f.result, f.err
}

type fakeAligner struct {
	words []Word
	err   error
	calls int
}

func (f *fakeAligner) Align(_ context.Context, _, _ string) ([]Word, error) {
	f.calls++
	return f.words, f.err
}

type fakeQuota struct {
	consumed []string
	released []string
	failKey  string
	replay   bool // when set, ConsumeWithTx reports ErrIdemReplay
}

func (f *fakeQuota) ConsumeWithTx(_ context.Context, _ pgx.Tx, _, key string, _ int64, _ time.Time, idemKey string) error {
	if f.replay {
		return quota.ErrIdemReplay
	}
	if key == f.failKey {
		return webx.NewQuotaExceeded("monthly render quota exhausted")
	}
	f.consumed = append(f.consumed, key+"/"+idemKey)
	return nil
}

func (f *fakeQuota) ReleaseTx(_ context.Context, _ pgx.Tx, _, key string, _ int64, _ string) error {
	f.released = append(f.released, key)
	return nil
}

func (f *fakeQuota) Release(_ context.Context, _, key string, _ int64, _ time.Time) error {
	f.released = append(f.released, key)
	return nil
}

type fakeAudit struct{ txActions, actions []string }

func (f *fakeAudit) RecordTx(_ context.Context, _ pgx.Tx, _ *string, _ string, action, _, _ string, _ map[string]any) error {
	f.txActions = append(f.txActions, action)
	return nil
}

func (f *fakeAudit) Record(_ context.Context, _ *string, _ string, action, _, _ string, _ map[string]any) {
	f.actions = append(f.actions, action)
}

type fakePublish struct{ events []string }

func (f *fakePublish) BroadcastEvent(_ context.Context, event string, _ []byte, _ string) error {
	f.events = append(f.events, event)
	return nil
}

type fakeEnqueuer struct{ kinds []string }

func (f *fakeEnqueuer) InsertTx(_ context.Context, _ pgx.Tx, args any, _ *struct{}) error {
	if ra, ok := args.(RenderArgs); ok {
		f.kinds = append(f.kinds, ra.RenderID)
	}
	return nil
}

type fakeCap struct{ available bool }

func (f fakeCap) CapAvailable() bool { return f.available }

// newFakeService builds a service against a real pgxpool (DB-gated) or a nil
// pool with the pure-call paths only. The DB-dependent tests live in
// service_db_test.go; this file covers port-composition logic with fakes.
func newFakePorts() Ports {
	return Ports{
		Membership: fakeMembership{allow: true},
		Quota:      &fakeQuota{},
		Audit:      &fakeAudit{},
		Publish:    &fakePublish{},
		Cap:        fakeCap{available: true},
	}
}

func principal() *webx.Principal {
	return &webx.Principal{UserID: "u1", WorkspaceID: "ws1", Source: webx.SourceSession}
}

func TestDegradeMatrix_SetScriptSources(t *testing.T) {
	// The matrix (§4.10.2) is exercised through deriveWords, which SetScript
	// calls inside Mutate's fn — run it against synthetic IRs here.
	svc := &ProjectService{log: testLogger()}

	t.Run("no tts no aligner → estimated", func(t *testing.T) {
		ir := &IR{Meta: Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 8}}
		dw, src, err := svc.deriveWordsUnlocked(context.Background(), ir, "你好 世界")
		words := dw.words
		require.NoError(t, err)
		assert.Equal(t, WordSourceEstimated, src)
		require.Len(t, words, 2)
		for _, w := range words {
			assert.Equal(t, WordSourceEstimated, w.Source)
		}
	})

	t.Run("tts with word timestamps → tts direct", func(t *testing.T) {
		s := &ProjectService{
			log: testLogger(),
			ports: Ports{Synth: &fakeSynth{result: VoiceResult{
				DurationSec: 4,
				Words: []Word{
					{Text: "你", Start: 0, End: 1},
					{Text: "好", Start: 1, End: 2},
				},
			}}},
		}
		ir := &IR{Meta: Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 8}}
		dw, src, err := s.deriveWordsUnlocked(context.Background(), ir, "你好")
		words := dw.words
		require.NoError(t, err)
		assert.Equal(t, WordSourceTTS, src)
		require.Len(t, words, 2)
		assert.Equal(t, 0, words[0].Index, "words renumbered")
		assert.Equal(t, WordSourceTTS, words[0].Source)
	})

	t.Run("tts audio only → estimated over vendor duration", func(t *testing.T) {
		s := &ProjectService{
			log:   testLogger(),
			ports: Ports{Synth: &fakeSynth{result: VoiceResult{DurationSec: 5}}},
		}
		ir := &IR{Meta: Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 8}}
		dw, src, err := s.deriveWordsUnlocked(context.Background(), ir, "你好 世界")
		words := dw.words
		require.NoError(t, err)
		assert.Equal(t, WordSourceTTS, src)
		require.Len(t, words, 2)
		assert.InDelta(t, 5.0, words[len(words)-1].End, 1e-9, "estimate spans vendor duration")
	})

	t.Run("tts fails → falls back to estimated", func(t *testing.T) {
		s := &ProjectService{
			log:   testLogger(),
			ports: Ports{Synth: &fakeSynth{err: context.DeadlineExceeded}},
		}
		ir := &IR{Meta: Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 8}}
		dw, src, err := s.deriveWordsUnlocked(context.Background(), ir, "你好")
		_ = dw
		require.NoError(t, err)
		assert.Equal(t, WordSourceEstimated, src)
	})

	t.Run("aligner path with existing voice", func(t *testing.T) {
		s := &ProjectService{
			log: testLogger(),
			ports: Ports{Aligner: &fakeAligner{words: []Word{
				{Text: "你", Start: 0, End: 1}, {Text: "好", Start: 1, End: 2},
			}}},
		}
		ir := &IR{
			Meta:  Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 8},
			Audio: &Audio{Voice: &AudioTrack{Key: "video/ws/v.mp3", DurationSec: 4}},
		}
		dw, src, err := s.deriveWordsUnlocked(context.Background(), ir, "你好")
		words := dw.words
		require.NoError(t, err)
		assert.Equal(t, WordSourceAligner, src)
		require.Len(t, words, 2)
	})
}

func TestMutate_PortsNotWired(t *testing.T) {
	// Mutate against a nil pool must fail cleanly (not panic) — membership is
	// consulted first. The id is well-formed so the uuid shape gate passes
	// and the membership port check is what fires.
	svc := &ProjectService{log: testLogger()}
	svc.ports = Ports{}
	_, _, err := svc.Mutate(context.Background(), principal(),
		"00000000-0000-0000-0000-000000000000", nil, func(_ *IR) error { return nil })
	require.Error(t, err)
	assert.Contains(t, err.Error(), "membership port not wired")
}

func TestQuotaKeyAndEvents(t *testing.T) {
	assert.Equal(t, "video_renders_monthly", QuotaKey)
	assert.Equal(t, "video.ir.updated", EventIRUpdated)
	assert.Equal(t, "video.render.updated", EventRenderUpdated)
}

func TestRenderParamsNormalize(t *testing.T) {
	ir := &IR{Meta: Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 10}}
	p := RenderParams{}
	p.normalize(ir)
	assert.Equal(t, 30, p.FPS)
	assert.Equal(t, 1080, p.Width)
	assert.Equal(t, 1920, p.Height)
	assert.Equal(t, "none", p.SubtitleMode)

	p2 := RenderParams{BurnSubtitles: true}
	p2.normalize(ir)
	assert.Equal(t, "burn", p2.SubtitleMode)

	p3 := RenderParams{SubtitleMode: "soft"}
	p3.normalize(ir)
	assert.Equal(t, "soft", p3.SubtitleMode)

	p4 := RenderParams{SubtitleMode: "nonsense"}
	p4.normalize(ir)
	assert.Equal(t, "none", p4.SubtitleMode, "invalid mode coerced to none")
}

func TestSubmitRender_GateOrder(t *testing.T) {
	// The order cap→quota→insert is enforced structurally; with a nil pool the
	// quota consume must NOT be reached when Cap is unavailable.
	quota := &fakeQuota{}
	svc := NewProjectService(nil, Ports{
		Membership: fakeMembership{allow: true},
		Quota:      quota,
		Cap:        fakeCap{available: false},
	}, testLogger())
	_, err := svc.SubmitRender(context.Background(), principal(), "p1", RenderParams{}, nil, "")
	require.Error(t, err)
	var we *webx.Error
	require.True(t, errorAs(err, &we))
	assert.Equal(t, "E_NOT_CONFIGURED", we.Code)
	assert.Empty(t, quota.consumed, "no quota spend when capability missing")

	// Membership denial happens before anything else.
	denied := NewProjectService(nil, Ports{
		Membership: fakeMembership{allow: false},
		Quota:      quota,
		Cap:        fakeCap{available: true},
	}, testLogger())
	_, err = denied.SubmitRender(context.Background(), principal(), "p1", RenderParams{}, nil, "")
	require.Error(t, err)
	require.True(t, errorAs(err, &we))
	assert.Equal(t, "E_FORBIDDEN", we.Code)
	assert.Empty(t, quota.consumed)
}

func TestUploadAsset_Validation(t *testing.T) {
	// Type, size and magic gates run before any store call.
	svc := NewProjectService(nil, Ports{Membership: fakeMembership{allow: true}}, testLogger())
	var we *webx.Error
	_, err := svc.UploadAsset(context.Background(), principal(), "p1", "x.exe", "application/exe", []byte("m"), UploadLimit)
	require.Error(t, err)
	require.True(t, errorAs(err, &we))
	assert.Equal(t, "E_VIDEO_ASSET_UNSUPPORTED", we.Code)
	assert.NotContains(t, we.Message, "does not match", "whitelist reject, not a magic mismatch")

	// Channel cap: the caller-supplied limit decides (MCP 700KB vs REST 50MB).
	_, err = svc.UploadAsset(context.Background(), principal(), "p1", "big.png", "image/png", make([]byte, UploadLimit+1), UploadLimit)
	require.Error(t, err)
	require.True(t, errorAs(err, &we))
	assert.Equal(t, "E_VIDEO_ASSET_TOO_LARGE", we.Code)

	// A 2MB+ real-header body still rejects at UploadLimitLarge (the large
	// cap is a real gate, not a no-op) — assertable on the nil pool because
	// the size gate runs before any storage/pool work.
	big := append(append([]byte{}, pngFixture...), make([]byte, UploadLimitLarge+1)...)
	_, err = svc.UploadAsset(context.Background(), principal(), "p1", "big.png", "image/png", big, UploadLimitLarge)
	require.Error(t, err)
	require.True(t, errorAs(err, &we))
	assert.Equal(t, "E_VIDEO_ASSET_TOO_LARGE", we.Code)

	// Magic mismatch (agent2 P2-5): "hello" posing as image/png is rejected
	// before any store/pool work. The project id is well-formed (zero uuid)
	// so the flow reaches the magic gate — the shape gate runs first.
	_, err = svc.UploadAsset(context.Background(), principal(), "00000000-0000-0000-0000-000000000000",
		"hello.png", "image/png", []byte("hello"), UploadLimit)
	require.Error(t, err)
	require.True(t, errorAs(err, &we))
	assert.Equal(t, "E_VIDEO_ASSET_UNSUPPORTED", we.Code)
	assert.Contains(t, we.Message, "does not match")
}

// pngFixture is a minimal real-header PNG body for the nil-pool unit tests
// (the integration suite's pngBytes lives in service_db_test.go).
var pngFixture = append([]byte{0x89, 'P', 'N', 'G'}, "\r\n\x1a\nfixture"...)

// TestRenderParamsValidate anchors e2e agent3 Bug-3 at the unit level: the
// render-parameter range gate (bgm_volume ∈ [0,1], fps whitelist) fails
// closed, and fps=0 stays the documented inherit-from-meta sentinel.
func TestRenderParamsValidate(t *testing.T) {
	var we *webx.Error
	err := (&RenderParams{FPS: 30, BGMVolume: 1.5}).validate()
	require.Error(t, err)
	require.True(t, errorAs(err, &we))
	assert.Equal(t, "E_VIDEO_RENDER_PARAMS_INVALID", we.Code)
	assert.Equal(t, 400, we.Status)
	assert.Contains(t, we.Message, "params.bgm_volume")

	err = (&RenderParams{FPS: 30, BGMVolume: -0.1}).validate()
	require.True(t, errorAs(err, &we))
	assert.Contains(t, we.Message, "params.bgm_volume")

	err = (&RenderParams{FPS: 23}).validate()
	require.True(t, errorAs(err, &we))
	assert.Equal(t, "E_VIDEO_RENDER_PARAMS_INVALID", we.Code)
	assert.Contains(t, we.Message, "params.fps")

	for _, fps := range []int{24, 25, 30, 50, 60} {
		require.NoError(t, (&RenderParams{FPS: fps}).validate(), "whitelisted fps")
	}
	require.NoError(t, (&RenderParams{FPS: 0}).validate(), "fps=0 = inherit meta (checked pre-normalize)")

	// Boundary values are legal.
	require.NoError(t, (&RenderParams{FPS: 30, BGMVolume: 0}).validate())
	require.NoError(t, (&RenderParams{FPS: 30, BGMVolume: 1}).validate())
}

// TestRenderParamsValidateThenNormalize pins the SubmitRender order: the
// range gate runs on the RAW params (fps=0 passes), normalize then maps 0 →
// the IR meta fps, and the normalized fps is whitelisted.
func TestRenderParamsValidateThenNormalize(t *testing.T) {
	ir := &IR{Meta: Meta{FPS: 25, Width: 1080, Height: 1920, DurationSec: 10}}
	p := RenderParams{BGMVolume: 0.8}
	require.NoError(t, p.validate())
	p.normalize(ir)
	assert.Equal(t, 25, p.FPS, "fps=0 inherited the meta fps")
	require.NoError(t, (&RenderParams{FPS: p.FPS, BGMVolume: p.BGMVolume}).validate(),
		"the normalized params re-validate clean")
}

// TestUUIDShapeGuard anchors the malformed-id entry points: a non-UUID id
// returns the same 404 a missing row would — never a SQL-cast 500 — and the
// shape check fires BEFORE membership/pool access (nil-pool-safe here).
func TestUUIDShapeGuard(t *testing.T) {
	ctx := context.Background()
	p := principal()
	svc := NewProjectService(nil, Ports{Membership: fakeMembership{allow: true}}, testLogger())

	_, err := svc.Get(ctx, p, "not-a-uuid")
	require.Error(t, err)
	var we *webx.Error
	require.True(t, errorAs(err, &we))
	assert.Equal(t, "E_VIDEO_PROJECT_NOT_FOUND", we.Code)
	assert.Equal(t, 404, we.Status)

	_, err = svc.GetRender(ctx, p, "not-a-uuid")
	require.True(t, errorAs(err, &we))
	assert.Equal(t, "E_VIDEO_RENDER_NOT_FOUND", we.Code)

	_, err = svc.ListRenders(ctx, p, "not-a-uuid")
	require.True(t, errorAs(err, &we))
	assert.Equal(t, "E_VIDEO_PROJECT_NOT_FOUND", we.Code)

	err = svc.Delete(ctx, p, "not-a-uuid")
	require.True(t, errorAs(err, &we))
	assert.Equal(t, "E_VIDEO_PROJECT_NOT_FOUND", we.Code)

	_, _, err = svc.Mutate(ctx, p, "not-a-uuid", nil, func(_ *IR) error { return nil })
	require.True(t, errorAs(err, &we))
	assert.Equal(t, "E_VIDEO_PROJECT_NOT_FOUND", we.Code)

	// A well-formed UUID passes the shape gate (then hits the nil pool — the
	// shape gate itself must not reject it).
	ok := uuidShape("00000000-0000-0000-0000-000000000000")
	assert.True(t, ok, "well-formed uuid passes the shape gate")
}

// TestMagicMatches is the table-driven magic-byte contract (agent2 P2-5):
// every whitelisted content type must match its real header and reject
// foreign/garbage bodies.
func TestMagicMatches(t *testing.T) {
	pngHdr := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
	jpgHdr := []byte{0xFF, 0xD8, 0xFF, 0xE0}
	cases := []struct {
		ct    string
		data  []byte
		match bool
	}{
		{"image/png", pngHdr, true},
		{"image/png", append(append([]byte{}, pngHdr...), bytes.Repeat([]byte{0}, 64)...), true},
		{"image/png", []byte("hello"), false},
		{"image/png", []byte{0x89}, false},
		{"image/png", nil, false},
		{"image/jpeg", jpgHdr, true},
		{"image/jpeg", []byte{0xFF, 0xD8}, false}, // too short for the marker
		{"image/jpeg", []byte("GIF89a"), false},
		{"image/gif", []byte("GIF89a..."), true},
		{"image/gif", []byte("GIF87a..."), true},
		{"image/gif", []byte("GIF80a..."), false},
		{"image/gif", pngHdr, false},
		{"image/webp", append([]byte("RIFF"), append(bytes.Repeat([]byte{0}, 4), []byte("WEBP")...)...), true},
		{"image/webp", []byte("RIFFxxxxWAVEfmt "), false},
		{"audio/mpeg", append([]byte("ID3"), []byte("0303...")...), true},
		{"audio/mpeg", []byte{0xFF, 0xFB, 0x90, 0x00}, true}, // bare frame sync
		{"audio/mpeg", []byte{0xFF, 0x00, 0x00}, false},
		{"audio/mpeg", []byte("ID"), false},
		{"audio/mp4", append([]byte{0x00, 0x00, 0x00, 0x20}, append([]byte("ftyp"), []byte("M4A ")...)...), true},
		{"audio/mp4", []byte("RIFFxxxxWEBP"), false},
		{"audio/wav", []byte("RIFFxxxxWAVE"), true},
		{"audio/x-wav", []byte("RIFFxxxxWAVE"), true},
		{"audio/wav", []byte("RIFFxxxxAVI "), false},
		{"application/exe", []byte("MZ"), false}, // non-whitelisted: no magic defined
	}
	for _, c := range cases {
		got := magicMatches(c.ct, c.data)
		assert.Equal(t, c.match, got, "%s %q", c.ct, c.data)
	}
}

func TestOriginContext(t *testing.T) {
	assert.Equal(t, "ui", originOf(context.Background()))
	assert.Equal(t, "mcp", originOf(WithOrigin(context.Background(), "mcp")))
}

func TestMustJSON(t *testing.T) {
	b := mustJSON(map[string]int{"a": 1})
	var m map[string]int
	require.NoError(t, json.Unmarshal(b, &m))
	assert.Equal(t, 1, m["a"])
}

func testLogger() *slog.Logger { return slog.New(slog.DiscardHandler) }

func errorAs(err error, target any) bool { return errors.As(err, target) }
