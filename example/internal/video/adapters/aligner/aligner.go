// Package aligner adapts a WhisperX sidecar HTTP service to the video
// domain's Aligner port (§4.10.1) — forced alignment for an already-uploaded
// audio track. Contract (VIDEO_ALIGNER_URL):
//
//	POST { "audio_key": "video/<ws>/assets/...", "script": "..." }
//	→   { "words": [ { "text": "发布", "start": 1.80, "end": 2.10 }, ... ] }
//
// The sidecar reads the audio from the same storagex backend (deployment:
// docs/dev-environment.md). The caller owns the ctx deadline; this adapter
// adds none. Absent VIDEO_ALIGNER_URL = the wiring layer simply does not
// register an Aligner (degrade matrix §4.10.2).
package aligner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	videoapp "myproduct/internal/video/app"
)

// Aligner is the WhisperX sidecar adapter implementing videoapp.Aligner.
type Aligner struct {
	BaseURL string // VIDEO_ALIGNER_URL
	Client  *http.Client
}

func New(baseURL string) *Aligner {
	return &Aligner{BaseURL: baseURL, Client: http.DefaultClient}
}

type alignRequest struct {
	AudioKey string `json:"audio_key"`
	Script   string `json:"script"`
}

type alignResponse struct {
	Words []sidecarWord `json:"words"`
}

type sidecarWord struct {
	Text  string  `json:"text"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// Align implements videoapp.Aligner verbatim.
func (a *Aligner) Align(ctx context.Context, audioKey, script string) ([]videoapp.Word, error) {
	if a.BaseURL == "" {
		return nil, fmt.Errorf("aligner: VIDEO_ALIGNER_URL not configured")
	}
	body, err := json.Marshal(alignRequest{AudioKey: audioKey, Script: script})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.BaseURL, "/")+"/align", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return nil, fmt.Errorf("aligner: sidecar status %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var out alignResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&out); err != nil {
		return nil, fmt.Errorf("aligner: sidecar body: %w", err)
	}
	words := make([]videoapp.Word, 0, len(out.Words))
	for _, w := range out.Words {
		words = append(words, videoapp.Word{Text: w.Text, Start: w.Start, End: w.End})
	}
	return words, nil
}
