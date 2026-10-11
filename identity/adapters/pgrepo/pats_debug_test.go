package pgrepo

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// F13: a PAT rejected on prefix mismatch must leave a debug record naming the
// expected prefix — the three-prefix misconfiguration (webx / TokenService /
// pgrepo Config) then diagnoses itself from the log instead of a blind 401.
// The prefix-mismatch path returns before any pool use, so no database needed.
func TestResolvePAT_PrefixMismatch_DebugLog(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(prev)

	r := &Repo{cfg: Config{PATPrefix: "xx_"}}
	p, err := r.ResolvePAT(context.Background(), "tk_0000000000000000000000000000000000000000", time.Now())
	require.NoError(t, err)
	require.Nil(t, p)

	out := buf.String()
	assert.Contains(t, out, "pat auth rejected")
	assert.Contains(t, out, "configured_prefix=xx_")
	assert.NotContains(t, out, "tk_0000", "token material must never be logged")
}

// Empty configured prefix logs the effective default (domain fallback).
func TestResolvePAT_PrefixMismatch_LogsEffectiveDefault(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(prev)

	r := &Repo{}
	p, err := r.ResolvePAT(context.Background(), "ork_0000000000000000000000000000000000000", time.Now())
	require.NoError(t, err)
	require.Nil(t, p)
	assert.Contains(t, buf.String(), "configured_prefix=tk_")
	assert.True(t, strings.HasPrefix(buf.String(), ""), "sanity")
}
