package videoapp

// ResolveAudioVolumes is the single truth for effective mixer gain. Its
// regression target is the 2026-11-17 P1 fix: the TTS write path
// (service.go, SetScript phase 2) stores AudioTrack WITHOUT a Volume, so
// the field unmarshals to 0. The pre-fix render pipeline read that 0
// straight into ffmpeg's volume filter and shipped a silent track while
// reporting success. Zero must therefore mean "default 1.0", not "muted" —
// v1 cannot express a genuine mute (volume is `omitempty`), and write-time
// validation keeps the value inside 0-1 so 0 is the only ambiguous case.

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveAudioVolumes_NilIR(t *testing.T) {
	v, b := ResolveAudioVolumes(nil)
	assert.Equal(t, 1.0, v, "nil IR → voice default")
	assert.Equal(t, 1.0, b, "nil IR → bgm default")
}

func TestResolveAudioVolumes_NoAudioBlock(t *testing.T) {
	v, b := ResolveAudioVolumes(validIR())
	assert.Equal(t, 1.0, v)
	assert.Equal(t, 1.0, b)
}

func TestResolveAudioVolumes_ZeroVolumeMeansDefault(t *testing.T) {
	// The TTS write path produces exactly this shape: key + duration, no volume.
	ir := validIR()
	ir.Audio = &Audio{Voice: &AudioTrack{Key: "video/ws/a.mp3", DurationSec: 12.4}}
	v, b := ResolveAudioVolumes(ir)
	assert.Equal(t, 1.0, v, "unset voice volume must resolve to the 1.0 default, never 0 (silent-track regression)")
	assert.Equal(t, 1.0, b)
}

func TestResolveAudioVolumes_ExplicitVolumesHonored(t *testing.T) {
	ir := validIR()
	ir.Audio = &Audio{
		Voice: &AudioTrack{Key: "video/ws/a.mp3", Volume: 0.8},
		BGM:   &AudioTrack{Key: "video/ws/b.mp3", Volume: 0.3},
	}
	v, b := ResolveAudioVolumes(ir)
	assert.InDelta(t, 0.8, v, 1e-9)
	assert.InDelta(t, 0.3, b, 1e-9)
}

func TestResolveAudioVolumes_OneTrackMissing(t *testing.T) {
	ir := validIR()
	ir.Audio = &Audio{BGM: &AudioTrack{Key: "video/ws/b.mp3", Volume: 0.25}}
	v, b := ResolveAudioVolumes(ir)
	assert.Equal(t, 1.0, v, "voice absent → default (muxer never uses it without a path anyway)")
	assert.InDelta(t, 0.25, b, 1e-9)
}

// The JSON round-trip pins why zero cannot mean "muted": omitempty drops the
// field, so a decoded document cannot distinguish "0 written" from "absent".
func TestAudioVolume_OmitemptyRoundTrip(t *testing.T) {
	type doc struct {
		Audio *Audio `json:"audio,omitempty"`
	}
	in := doc{Audio: &Audio{Voice: &AudioTrack{Key: "video/ws/a.mp3", DurationSec: 3, Volume: 0}}}
	raw, err := json.Marshal(in)
	require.NoError(t, err)
	assert.NotContains(t, string(raw), "volume", "omitempty must drop a zero volume — this is the documented v1 limitation")

	var out doc
	require.NoError(t, json.Unmarshal(raw, &out))
	require.NotNil(t, out.Audio)
	require.NotNil(t, out.Audio.Voice)
	assert.Equal(t, 0.0, out.Audio.Voice.Volume, "decoded back as the Go zero value")
	if v, _ := ResolveAudioVolumes(&IR{Audio: out.Audio}); v != 1.0 {
		t.Fatalf("resolver must treat the round-tripped zero as the 1.0 default, got %v", v)
	}
}
