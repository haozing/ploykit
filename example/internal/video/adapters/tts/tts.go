// Package tts adapts an external text-to-speech HTTP vendor to the video
// domain's Synthesizer port (§4.10.1). Contract (VIDEO_TTS_URL):
//
//	POST { "text": "...", "voice": "...", "speed": 1.0 }
//	→   { "audio_base64": "...", "duration_sec": 12.4,
//	      "words": [ { "text": "发布", "start": 1.80, "end": 2.10 }, ... ] }
//
// Words may be absent (audio-only vendors): the service then falls back to
// the estimator over DurationSec. Credentials ride an optional Authorization
// header from VIDEO_TTS_KEY (env-only, never stored — no sealx surface).
// The caller owns the ctx deadline (the domain passes its own 60s budget);
// this adapter adds none.
package tts

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	videoapp "myproduct/internal/video/app"
)

// Synthesizer is the HTTP vendor adapter implementing videoapp.Synthesizer.
type Synthesizer struct {
	BaseURL string // VIDEO_TTS_URL (no trailing slash required)
	APIKey  string // VIDEO_TTS_KEY (optional)
	Voice   string // VIDEO_TTS_VOICE default voice (request may override)
	Client  *http.Client
}

func New(baseURL, apiKey, defaultVoice string) *Synthesizer {
	return &Synthesizer{BaseURL: baseURL, APIKey: apiKey, Voice: defaultVoice, Client: http.DefaultClient}
}

type synthesizeRequest struct {
	Text  string  `json:"text"`
	Voice string  `json:"voice"`
	Speed float64 `json:"speed"`
}

type synthesizeResponse struct {
	AudioBase64 string           `json:"audio_base64"`
	DurationSec float64          `json:"duration_sec"`
	Words       []vendorWord     `json:"words"`
}

type vendorWord struct {
	Text  string  `json:"text"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// Synthesize implements videoapp.Synthesizer verbatim.
func (s *Synthesizer) Synthesize(ctx context.Context, text, voice string, speed float64) (videoapp.VoiceResult, error) {
	if s.BaseURL == "" {
		return videoapp.VoiceResult{}, fmt.Errorf("tts: VIDEO_TTS_URL not configured")
	}
	if voice == "" {
		voice = s.Voice
	}
	if speed <= 0 {
		speed = 1.0
	}
	body, err := json.Marshal(synthesizeRequest{Text: text, Voice: voice, Speed: speed})
	if err != nil {
		return videoapp.VoiceResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.BaseURL, "/")+"/synthesize", bytes.NewReader(body))
	if err != nil {
		return videoapp.VoiceResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if s.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+s.APIKey)
	}
	resp, err := s.Client.Do(req)
	if err != nil {
		return videoapp.VoiceResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return videoapp.VoiceResult{}, fmt.Errorf("tts: vendor status %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var out synthesizeResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(&out); err != nil {
		return videoapp.VoiceResult{}, fmt.Errorf("tts: vendor body: %w", err)
	}
	result := videoapp.VoiceResult{DurationSec: out.DurationSec}
	if out.AudioBase64 != "" {
		data, derr := base64.StdEncoding.DecodeString(out.AudioBase64)
		if derr != nil {
			return videoapp.VoiceResult{}, fmt.Errorf("tts: audio_base64: %w", derr)
		}
		result.AudioData = data // service persists via Store and fills AudioKey
	}
	for _, w := range out.Words {
		result.Words = append(result.Words, videoapp.Word{Text: w.Text, Start: w.Start, End: w.End})
	}
	return result, nil
}
